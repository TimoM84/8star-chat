"use strict";
// Origin/CSRF checks, PIN brute-force limits, security headers and the
// staff flows that were changed along the way.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  startServer,
  Browser,
  adminBrowser,
  createEvent,
  join,
  ticket,
  sleep,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} = require("./helpers");

let server, admin, slug, api;
test.before(async () => {
  server = await startServer({ env: { PIN_LOCK_SECONDS: "2" } });
  admin = await adminBrowser(server);
  slug = (await createEvent(admin, { title: "Security test", mode: "open" })).slug;
  api = "/api/events/" + slug;
});
test.after(async () => server?.stop());

test("mutating requests without a same-origin Origin are blocked", async () => {
  const b = new Browser(server);
  assert.equal((await b.post(api + "/join", { name: "x" }, { origin: "" })).status, 403);
  assert.equal((await b.post(api + "/join", { name: "x" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(
    (await b.post(api + "/join", { name: "x" }, { headers: { "sec-fetch-site": "cross-site" } })).status,
    403,
  );
  assert.equal(
    (
      await b.post(
        "/api/login",
        { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  // Referer is accepted when Origin is absent.
  const viaReferer = await b.post(
    api + "/join",
    { name: "x" },
    { origin: "", headers: { referer: server.base + "/e/" + slug } },
  );
  assert.equal(viaReferer.status, 200);
});

test("ALLOWED_ORIGINS is not needed for the chat's own origin", async () => {
  const b = new Browser(server);
  assert.equal((await b.post(api + "/join", { name: "Same origin" })).status, 200);
});

test("attendee requests need the session CSRF token", async () => {
  const b = new Browser(server);
  await join(b, slug, "Csrf");
  const good = b.csrf;
  b.csrf = "";
  assert.equal((await b.post(api + "/messages", { text: "no token" })).status, 401);
  b.csrf = "wrong-token";
  assert.equal((await b.post(api + "/messages", { text: "wrong token" })).status, 401);
  assert.equal((await b.post(api + "/stream-ticket", { scope: "public" })).status, 401);
  b.csrf = good;
  assert.equal((await b.post(api + "/messages", { text: "with token" })).status, 201);
});

test("staff requests need the session CSRF token", async () => {
  const b = await adminBrowser(server);
  const good = b.csrf;
  b.csrf = "";
  assert.equal((await b.post("/api/events", { title: "No csrf" })).status, 403);
  assert.equal((await b.patch(api + "/settings", { title: "Hijacked" })).status, 401);
  b.csrf = good;
  assert.equal((await b.patch(api + "/settings", { title: "Security test" })).status, 200);
  // GET requests do not need it.
  b.csrf = "";
  assert.equal((await b.get(api + "/messages")).status, 200);
});

test("staff session cookie is HttpOnly and SameSite=Strict", async () => {
  const b = new Browser(server);
  await b.post("/api/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const sid = [...b.cookies.values()].find((c) => c.name === "sid");
  assert.match(sid.raw, /HttpOnly/);
  assert.match(sid.raw, /SameSite=Strict/);
  assert.doesNotMatch(sid.raw, /Secure/); // plain HTTP test server
});

test("cookies are Secure (and the guest cookie partitioned) behind an HTTPS proxy", async () => {
  const s2 = await startServer({ env: { TRUST_PROXY: "true" } });
  try {
    const a = new Browser(s2);
    a.extraHeaders = { "x-forwarded-proto": "https" };
    const login = await a.post("/api/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    a.csrf = login.data.csrf;
    const sid = [...a.cookies.values()].find((c) => c.name === "sid");
    assert.match(sid.raw, /; Secure/);
    const ev = (await a.post("/api/events", { title: "Https" })).data.event;
    const g = new Browser(s2);
    g.extraHeaders = { "x-forwarded-proto": "https" };
    await g.post("/api/events/" + ev.slug + "/join", { name: "Guest" });
    const cookie = [...g.cookies.values()].find((c) => c.name === "g8s");
    assert.match(cookie.raw, /SameSite=None/);
    assert.match(cookie.raw, /Secure/);
    assert.match(cookie.raw, /Partitioned/);
  } finally {
    await s2.stop();
  }
});

test("PIN rules: minimum length, lockout after repeated failures", async () => {
  const b = new Browser(server);
  await join(b, slug, "Pin");
  assert.equal((await b.post(api + "/private/pin", { pin: "12345" })).status, 400);
  assert.equal((await b.post(api + "/private/unlock", { pin: "123456" })).status, 409); // no PIN yet
  assert.equal((await b.post(api + "/private/pin", { pin: "123456" })).status, 200);
  for (let i = 0; i < 5; i++)
    assert.equal((await b.post(api + "/private/unlock", { pin: "000000" })).status, 401);
  // Locked: even the right PIN is refused for now, without revealing whether it is correct.
  const locked = await b.post(api + "/private/unlock", { pin: "123456" });
  assert.equal(locked.status, 429);
  assert.ok(locked.headers.get("retry-after"));
  await sleep(2100);
  assert.equal((await b.post(api + "/private/unlock", { pin: "123456" })).status, 200);
});

test("PIN access is disabled permanently after 20 failures", async () => {
  const b = new Browser(server);
  await join(b, slug, "Brute");
  await b.post(api + "/private/pin", { pin: "correct-pin" });
  let last;
  for (let i = 0; i < 20; i++) {
    last = await b.post(api + "/private/unlock", { pin: "wrong-" + i });
    if (last.status === 429) {
      await sleep(2100);
      i--;
    }
  }
  assert.equal(last.status, 423);
  assert.equal((await b.post(api + "/private/unlock", { pin: "correct-pin" })).status, 423);
  assert.equal((await b.get(api + "/session")).data.pinDisabled, true);
});

test("staff login is rate limited", async () => {
  const s2 = await startServer();
  try {
    const b = new Browser(s2);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await b.post("/api/login", { email: ADMIN_EMAIL, password: "wrong-password-" + i })).status,
        401,
      );
    assert.equal((await b.post("/api/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status, 429);
  } finally {
    await s2.stop();
  }
});

test("error messages do not reveal whether an account exists", async () => {
  const b = new Browser(server);
  const unknown = await b.post("/api/login", { email: "nobody@example.com", password: "x" });
  const wrong = await b.post("/api/login", { email: ADMIN_EMAIL, password: "x" });
  assert.equal(unknown.status, wrong.status);
  assert.deepEqual(unknown.data, wrong.data);
});

test("no wildcard CORS and hardened headers", async () => {
  const r = await fetch(server.base + api + "/join", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const page = await fetch(server.base + "/e/" + slug);
  const csp = page.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  const traversal = await fetch(server.base + "/..%2fserver.js");
  assert.notEqual(traversal.status, 200);
});

test("invalid JSON and oversized bodies get a generic error", async () => {
  const b = new Browser(server);
  const bad = await b.request("POST", api + "/join", { body: "{not json" });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "Invalid request.");
  const big = await b.post(api + "/join", { name: "x".repeat(40000) });
  assert.equal(big.status, 400);
});

test("announcements do not expose moderator e-mail addresses publicly", async () => {
  const r = await admin.post(api + "/announcements", { text: "Welcome everyone" });
  assert.equal(r.status, 201);
  const pub = await new Browser(server).get(api);
  assert.ok(pub.text.includes("Welcome everyone"));
  assert.ok(!pub.text.includes(ADMIN_EMAIL));
  const b = new Browser(server);
  const joined = await join(b, slug, "Reader");
  assert.ok(!JSON.stringify(joined).includes(ADMIN_EMAIL));
});

test("open mode: public messages reach other attendees over SSE", async () => {
  const reader = new Browser(server),
    writer = new Browser(server);
  await join(reader, slug, "Reader");
  await join(writer, slug, "Writer");
  const t = await ticket(reader, slug);
  const s = reader.stream(api + "/stream?ticket=" + encodeURIComponent(t.data.ticket), { ms: 800 });
  await sleep(200);
  assert.equal((await writer.post(api + "/messages", { text: "hello everyone" })).status, 201);
  const result = await s;
  const pub = result.events.find((e) => e.event === "public" && e.data.text === "hello everyone");
  assert.ok(pub);
  assert.equal(pub.data.author, "Writer");
  assert.ok(!("participantId" in pub.data));
  assert.ok(!("ipHash" in pub.data));
});

test("moderated mode: moderator publishes and stage flow still works", async () => {
  const ev = await createEvent(admin, { title: "Moderated flow", mode: "moderated" });
  const a = "/api/events/" + ev.slug;
  const guest = new Browser(server);
  await join(guest, ev.slug, "Asker");
  assert.equal((await guest.post(a + "/messages", { text: "What about Q3?" })).data.status, "pending");
  const q = (await admin.get(a + "/messages")).data.messages.find((m) => m.text === "What about Q3?");
  assert.equal((await admin.post(a + "/messages/" + q.id + "/publish", {})).status, 200);
  assert.equal((await admin.post(a + "/messages/" + q.id + "/stage", {})).status, 200);
  const link = await admin.post(a + "/stage-access", {});
  const access = new URL(link.data.url, server.base).searchParams.get("access");
  const stage = new Browser(server);
  const s = await stage.stream(a + "/stream?access=" + encodeURIComponent(access), { ms: 300 });
  assert.ok(s.events.find((e) => e.event === "ready").data.stage.queue.some((m) => m.id === q.id));
  assert.equal((await stage.post(a + "/messages/" + q.id + "/stage-read", { access })).status, 200);
  assert.equal((await stage.post(a + "/messages/" + q.id + "/stage-read", { access: "wrong" })).status, 401);
});
