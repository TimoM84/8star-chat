"use strict";
// Privacy and session isolation. Arie and Willem use the SAME browser (one
// cookie jar) one after the other. Willem must never be able to read Arie's
// private messages or history: not via the API, SSE, old sessions or
// hand-crafted requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, Browser, adminBrowser, createEvent, join, ticket, sleep } = require("./helpers");

const ARIE_SECRET = "Arie-private-question-about-parking";
const ARIE_REPLY = "Moderator-reply-for-Arie-only";
const ARIE_PIN = "arie-pin-2468";

let server, admin, event, slug, api;
test.before(async () => {
  server = await startServer({ env: { PRIVATE_UNLOCK_IDLE_SECONDS: "2" } });
  admin = await adminBrowser(server);
  event = await createEvent(admin, { title: "Privacy test" });
  slug = event.slug;
  api = "/api/events/" + slug;
});
test.after(async () => server?.stop());

// Shared state across the scenario steps below.
const browser = () => shared.browser;
const shared = {};

test("Arie joins, sets a PIN and has a private conversation", async () => {
  shared.browser = new Browser(server);
  const joined = await join(browser(), slug, "Arie");
  assert.equal(joined.name, "Arie");
  assert.equal(joined.pinSet, false);
  assert.ok(!("participantId" in joined), "participant id is not exposed");
  assert.ok(!("privateHistory" in joined), "join never returns private history");
  const guestCookie = [...browser().cookies.values()].find((c) => c.name === "g8s");
  assert.ok(guestCookie, "session cookie set");
  assert.match(guestCookie.raw, /HttpOnly/);
  assert.match(guestCookie.raw, /SameSite=Lax/); // plain HTTP in tests; HTTPS uses SameSite=None; Secure; Partitioned
  assert.equal(guestCookie.path, api);
  shared.arieCookie = guestCookie.value;
  shared.arieCsrf = browser().csrf;

  // Private messages require an unlocked private conversation.
  const denied = await browser().post(api + "/messages", { text: ARIE_SECRET, kind: "private" });
  assert.equal(denied.status, 401);

  const pin = await browser().post(api + "/private/pin", { pin: ARIE_PIN });
  assert.equal(pin.status, 200);
  shared.ariePrivateToken = pin.data.privateToken;
  const headers = { "x-private-token": shared.ariePrivateToken };
  const sent = await browser().post(api + "/messages", { text: ARIE_SECRET, kind: "private" }, { headers });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.text, ARIE_SECRET);

  // Moderator answers privately.
  const inbox = await admin.get(api + "/messages");
  const arieMessage = inbox.data.messages.find((m) => m.text === ARIE_SECRET);
  assert.ok(arieMessage.participantId);
  shared.arieParticipantId = arieMessage.participantId;
  const reply = await admin.post(api + "/messages/private", {
    participantId: arieMessage.participantId,
    text: ARIE_REPLY,
  });
  assert.equal(reply.status, 201);

  const history = await browser().post(api + "/private/history", {}, { headers });
  assert.equal(history.status, 200);
  assert.deepEqual(
    history.data.messages.map((m) => m.text),
    [ARIE_SECRET, ARIE_REPLY],
  );
  assert.ok(
    !JSON.stringify(history.data).includes("admin@example.com"),
    "moderator e-mail is not shown to attendees",
  );
});

test("PIN is stored only as a salted hash", async () => {
  await sleep(1500); // debounced write of guest sessions
  const file = fs.readFileSync(path.join(server.dataDir, "guest-sessions.json"), "utf8");
  for (const name of ["guest-sessions.json", "state.json", "session-key", "ip-block-key"])
    assert.equal(fs.statSync(path.join(server.dataDir, name)).mode & 0o777, 0o600, name + " must be private");
  assert.ok(!file.includes(ARIE_PIN), "PIN not stored in plain text");
  assert.ok(!file.includes(shared.arieCookie), "raw session token not stored");
  const rec = JSON.parse(file).sessions.find((s) => s.name === "Arie");
  assert.match(rec.pin.salt, /^[0-9a-f]{32}$/);
  assert.match(rec.pin.hash, /^[0-9a-f]{128}$/);
});

test("Willem on the same browser cannot read Arie's private data without the PIN", async () => {
  // Willem opens the chat later in the same browser: he has Arie's cookie but
  // not the in-memory private token (new tab / reload).
  const b = browser();
  const session = await b.get(api + "/session");
  assert.equal(session.status, 200);
  assert.ok(!JSON.stringify(session.data).includes(ARIE_SECRET));
  assert.ok(!JSON.stringify(session.data).includes(ARIE_REPLY));

  const noToken = await b.post(api + "/private/history", {});
  assert.equal(noToken.status, 401);
  assert.ok(!noToken.text.includes(ARIE_SECRET));

  const privateTicket = await ticket(b, slug, "private");
  assert.equal(privateTicket.status, 401);

  const wrong = await b.post(api + "/private/unlock", { pin: "guess-000000" });
  assert.equal(wrong.status, 401);
  assert.ok(!wrong.text.includes(ARIE_SECRET));

  // Cannot overwrite Arie's PIN.
  const reset = await b.post(api + "/private/pin", { pin: "willem-new-pin" });
  assert.equal(reset.status, 409);

  // Cannot send private messages as Arie.
  const send = await b.post(api + "/messages", { text: "Willem as Arie", kind: "private" });
  assert.equal(send.status, 401);
});

test("public SSE stream and public API never contain private messages", async () => {
  const b = browser();
  const t = await ticket(b, slug, "public");
  assert.equal(t.status, 200);
  const streamPromise = b.stream(api + "/stream?ticket=" + encodeURIComponent(t.data.ticket), { ms: 900 });
  await sleep(200);
  // New private traffic while the public stream is open.
  await admin.post(api + "/messages/private", {
    participantId: shared.arieParticipantId,
    text: ARIE_REPLY + "-2",
  });
  const s = await streamPromise;
  assert.equal(s.status, 200);
  assert.ok(s.events.some((e) => e.event === "ready"));
  assert.ok(!s.text.includes(ARIE_SECRET), "no private question on public stream");
  assert.ok(!s.text.includes(ARIE_REPLY), "no private reply on public stream");
  assert.ok(!s.text.includes("privateHistory"));
  assert.ok(!s.text.includes(shared.arieParticipantId), "no participant ids on public stream");

  const publicEvent = await new Browser(server).get(api);
  assert.ok(!publicEvent.text.includes(ARIE_SECRET));
});

test("stream tickets are single use", async () => {
  const b = browser();
  const t = await ticket(b, slug, "public");
  const first = await b.stream(api + "/stream?ticket=" + encodeURIComponent(t.data.ticket), { ms: 200 });
  assert.equal(first.status, 200);
  const second = await b.stream(api + "/stream?ticket=" + encodeURIComponent(t.data.ticket), { ms: 200 });
  assert.equal(second.status, 401);
});

test("the legacy participantId/token scheme no longer grants access", async () => {
  const attacker = new Browser(server);
  // Hand-crafted join with Arie's participant id, as the old client did.
  const r = await attacker.post(api + "/join", { name: "Arie", participantId: shared.arieParticipantId });
  assert.equal(r.status, 200);
  attacker.csrf = r.data.csrf;
  assert.ok(!r.text.includes(ARIE_SECRET));
  assert.ok(!r.text.includes(ARIE_REPLY));
  // A new session is a new participant: it gets its own empty history once unlocked.
  const pin = await attacker.post(api + "/private/pin", { pin: "attacker-pin" });
  const history = await attacker.post(
    api + "/private/history",
    {},
    { headers: { "x-private-token": pin.data.privateToken } },
  );
  assert.deepEqual(history.data.messages, []);
  // Old style ?token= streams are rejected.
  const old = await attacker.stream(api + "/stream?token=anything", { ms: 200 });
  assert.equal(old.status, 401);
  // Arie's private token cannot be used with another session.
  const stolen = await attacker.post(
    api + "/private/history",
    {},
    { headers: { "x-private-token": shared.ariePrivateToken } },
  );
  assert.equal(stolen.status, 401);
  // Staff-only moderator endpoints are not reachable for attendees.
  const inbox = await attacker.get(api + "/messages");
  assert.equal(inbox.status, 401);
  // Private messages can never be published by the API.
  const privateMsg = (await admin.get(api + "/messages")).data.messages.find((m) => m.text === ARIE_SECRET);
  const publish = await admin.post(api + "/messages/" + privateMsg.id + "/publish", {});
  assert.equal(publish.status, 400);
});

test("Willem leaves Arie's session, joins himself and sees none of Arie's data", async () => {
  const b = browser();
  const end = await b.post(api + "/session/end", {});
  assert.equal(end.status, 200);
  assert.ok(![...b.cookies.values()].some((c) => c.name === "g8s"), "cookie cleared");

  // Old session (e.g. a copy of the cookie) is revoked on the server.
  const replay = new Browser(server);
  replay.cookies.set("g8s|" + api, { name: "g8s", value: shared.arieCookie, path: api });
  replay.csrf = shared.arieCsrf;
  assert.equal((await replay.get(api + "/session")).status, 401);
  assert.equal((await replay.post(api + "/private/unlock", { pin: ARIE_PIN })).status, 401);
  assert.equal(
    (
      await replay.post(
        api + "/private/history",
        {},
        { headers: { "x-private-token": shared.ariePrivateToken } },
      )
    ).status,
    401,
  );

  const willem = await join(b, slug, "Willem");
  assert.equal(willem.name, "Willem");
  assert.equal(willem.pinSet, false);
  const pin = await b.post(api + "/private/pin", { pin: "willem-pin-1357" });
  assert.equal(pin.status, 200);
  const history = await b.post(
    api + "/private/history",
    {},
    { headers: { "x-private-token": pin.data.privateToken } },
  );
  assert.deepEqual(history.data.messages, []);
  const t = await ticket(b, slug, "private", { "x-private-token": pin.data.privateToken });
  const s = await b.stream(api + "/stream?ticket=" + encodeURIComponent(t.data.ticket), { ms: 300 });
  assert.equal(s.status, 200);
  assert.ok(!s.text.includes(ARIE_SECRET));
  assert.ok(!s.text.includes(ARIE_REPLY));
});

test("joining again in the same browser ends the previous session", async () => {
  const b = new Browser(server);
  await join(b, slug, "First");
  const firstCookie = [...b.cookies.values()].find((c) => c.name === "g8s").value;
  await join(b, slug, "Second");
  const old = new Browser(server);
  old.cookies.set("g8s|" + api, { name: "g8s", value: firstCookie, path: api });
  assert.equal((await old.get(api + "/session")).status, 401);
});

test("private streams receive only the owner's private messages", async () => {
  const a = new Browser(server),
    w = new Browser(server);
  await join(a, slug, "Anna");
  await join(w, slug, "Wim");
  const pa = (await a.post(api + "/private/pin", { pin: "anna-pin-11" })).data.privateToken;
  const pw = (await w.post(api + "/private/pin", { pin: "wim-pin-22" })).data.privateToken;
  const ta = await ticket(a, slug, "private", { "x-private-token": pa });
  const tw = await ticket(w, slug, "private", { "x-private-token": pw });
  const sa = a.stream(api + "/stream?ticket=" + encodeURIComponent(ta.data.ticket), { ms: 900 });
  const sw = w.stream(api + "/stream?ticket=" + encodeURIComponent(tw.data.ticket), { ms: 900 });
  await sleep(200);
  await a.post(
    api + "/messages",
    { text: "anna-only-text", kind: "private" },
    { headers: { "x-private-token": pa } },
  );
  const [ra, rw] = await Promise.all([sa, sw]);
  assert.ok(ra.text.includes("anna-only-text"));
  assert.ok(!rw.text.includes("anna-only-text"));
});

test("private access locks itself after the idle timeout", async () => {
  const b = new Browser(server);
  await join(b, slug, "Idle");
  const token = (await b.post(api + "/private/pin", { pin: "idle-pin-99" })).data.privateToken;
  const headers = { "x-private-token": token };
  assert.equal((await b.post(api + "/private/history", {}, { headers })).status, 200);
  await sleep(2300);
  assert.equal((await b.post(api + "/private/history", {}, { headers })).status, 401);
  // Manual lock also revokes.
  const token2 = (await b.post(api + "/private/unlock", { pin: "idle-pin-99" })).data.privateToken;
  assert.equal((await b.post(api + "/private/lock", {})).status, 200);
  assert.equal(
    (await b.post(api + "/private/history", {}, { headers: { "x-private-token": token2 } })).status,
    401,
  );
});

test("banned attendees lose public and private access", async () => {
  const b = new Browser(server);
  await join(b, slug, "Spammer");
  await b.post(api + "/messages", { text: "spam question" });
  const msg = (await admin.get(api + "/messages")).data.messages.find((m) => m.text === "spam question");
  assert.equal((await admin.post(api + "/ban", { messageId: msg.id })).status, 200);
  assert.equal((await ticket(b, slug, "public")).status, 403);
  assert.equal((await b.post(api + "/messages", { text: "again" })).status, 403);
});

test("cookieless fallback returns a token only on request", async () => {
  const b = new Browser(server);
  const normal = await b.post(api + "/join", { name: "Normal" });
  assert.ok(!("sessionToken" in normal.data));
  const fallback = new Browser(server);
  const r = await fallback.post(api + "/join", { name: "Safari", cookieless: true });
  assert.ok(r.data.sessionToken);
  // Header-based session works without cookies and still needs CSRF.
  const noCookie = new Browser(server);
  noCookie.extraHeaders = { "x-guest-session": r.data.sessionToken };
  assert.equal((await noCookie.get(api + "/session")).status, 200);
  assert.equal((await noCookie.post(api + "/messages", { text: "hello" })).status, 401);
  noCookie.csrf = r.data.csrf;
  assert.equal((await noCookie.post(api + "/messages", { text: "hello" })).status, 201);
});
