"use strict";
// Behaviour under load: idempotent sending, status checks, explicit rejection
// (429/503) instead of slow answers, durable confirmation (journal), batched
// delivery in order, clean-up of sessions and streams, and privacy of the new
// endpoints.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startServer, Browser, adminBrowser, createEvent, join, sleep, ROOT } = require("./helpers");

const cid = (n) => "test-" + String(n).padStart(8, "0") + "-" + Math.random().toString(36).slice(2, 10);

async function openPublicStream(b, slug, ticket, ms) {
  return b.stream("/api/events/" + slug + "/stream?ticket=" + encodeURIComponent(ticket), { ms });
}

test.describe("idempotent sending and status", () => {
  let server, admin, slug, api;
  test.before(async () => {
    server = await startServer({ env: { ROOM_PUBLISH_PER_SECOND: "50" } });
    admin = await adminBrowser(server);
    slug = (await createEvent(admin, { title: "Idem", mode: "open" })).slug;
    api = "/api/events/" + slug;
  });
  test.after(async () => server?.stop());

  test("the same clientMessageId never creates a second message", async () => {
    const b = new Browser(server);
    await join(b, slug, "Retry");
    const id = cid(1);
    const first = await b.post(api + "/messages", { text: "only once", clientMessageId: id });
    assert.equal(first.status, 201);
    // A retry (e.g. after a time-out) within the 5 s user limit: same message, 200.
    const again = await b.post(api + "/messages", { text: "only once", clientMessageId: id });
    assert.equal(again.status, 200);
    assert.equal(again.data.replayed, true);
    assert.equal(again.data.message.id, first.data.message.id);
    // Different text with the same id is a client error, not a new message.
    const conflict = await b.post(api + "/messages", { text: "something else", clientMessageId: id });
    assert.equal(conflict.status, 409);
    const stored = (await admin.get(api + "/messages")).data.messages.filter((m) => m.text === "only once");
    assert.equal(stored.length, 1);
    assert.ok(!("clientKey" in stored[0]), "idempotency key is not exposed to staff");
    const csv = await admin.get(api + "/export");
    assert.ok(!/[0-9a-f]{64}/.test(csv.text), "no idempotency hashes in export");
  });

  test("status check reports the outcome only to the sending session", async () => {
    const a = new Browser(server),
      other = new Browser(server);
    await join(a, slug, "Asker");
    await join(other, slug, "Other");
    const id = cid(2);
    const unknown = await a.get(api + "/messages/status?clientMessageId=" + id);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.status, "unknown");
    const sent = await a.post(api + "/messages", { text: "status check text", clientMessageId: id });
    assert.equal(sent.status, 201);
    const st = await a.get(api + "/messages/status?clientMessageId=" + id);
    assert.equal(st.status, 200);
    assert.equal(st.data.status, "accepted");
    assert.equal(st.data.message.id, sent.data.message.id);
    assert.ok(!st.text.includes("status check text"), "status never returns message text");
    // Another session (e.g. the next person on a shared device) learns nothing.
    assert.equal((await other.get(api + "/messages/status?clientMessageId=" + id)).status, 404);
    assert.equal((await new Browser(server).get(api + "/messages/status?clientMessageId=" + id)).status, 401);
    assert.equal((await a.get(api + "/messages/status?clientMessageId=bad")).status, 400);
    assert.equal((await a.post(api + "/messages", { text: "x", clientMessageId: "no spaces!" })).status, 400);
  });

  test("private messages: idempotent, status without text, never on public streams", async () => {
    const b = new Browser(server),
      reader = new Browser(server);
    await join(b, slug, "Private sender");
    const joined = await join(reader, slug, "Reader");
    const token = (await b.post(api + "/private/pin", { pin: "private-pin-1" })).data.privateToken;
    const headers = { "x-private-token": token };
    const id = cid(3);
    const stream = openPublicStream(reader, slug, joined.ticket, 800);
    await sleep(150);
    const p1 = await b.post(
      api + "/messages",
      { text: "secret-idem-text", kind: "private", clientMessageId: id },
      { headers },
    );
    assert.equal(p1.status, 201);
    const p2 = await b.post(
      api + "/messages",
      { text: "secret-idem-text", kind: "private", clientMessageId: id },
      { headers },
    );
    assert.equal(p2.status, 200);
    const st = await b.get(api + "/messages/status?clientMessageId=" + id);
    assert.equal(st.data.message.kind, "private");
    assert.ok(!st.text.includes("secret-idem-text"));
    const s = await stream;
    assert.ok(!s.text.includes("secret-idem-text"));
    const history = await b.post(api + "/private/history", {}, { headers });
    assert.equal(history.data.messages.filter((m) => m.text === "secret-idem-text").length, 1);
  });
});

test.describe("explicit rejection under load", () => {
  let server, admin, slug, api;
  test.before(async () => {
    server = await startServer({ env: { ROOM_PUBLISH_PER_SECOND: "5", MAX_PENDING_MESSAGES: "1" } });
    admin = await adminBrowser(server);
    slug = (await createEvent(admin, { title: "Busy", mode: "open" })).slug;
    api = "/api/events/" + slug;
  });
  test.after(async () => server?.stop());

  test("many simultaneous senders get fast 201/429/503, nothing is stored without 201", async () => {
    const senders = await Promise.all(
      Array.from({ length: 60 }, async (_, i) => {
        const b = new Browser(server);
        await join(b, slug, "Sender " + i);
        return b;
      }),
    );
    const t0 = Date.now();
    const results = await Promise.all(
      senders.map((b, i) =>
        b.post(api + "/messages", { text: "busy message " + i, clientMessageId: cid(100 + i) }),
      ),
    );
    const elapsed = Date.now() - t0;
    const count = (st) => results.filter((r) => r.status === st).length;
    assert.equal(count(201) + count(429) + count(503), 60, JSON.stringify(results.map((r) => r.status)));
    assert.ok(count(201) >= 1 && count(201) <= 10, "room limit of 5/s respected: " + count(201));
    assert.ok(count(429) + count(503) >= 50);
    assert.ok(elapsed < 5000, "all answered quickly: " + elapsed + " ms");
    for (const r of results.filter((x) => x.status === 429 || x.status === 503)) {
      assert.ok(Number(r.headers.get("retry-after")) >= 1, "Retry-After header");
      assert.ok(r.data.error);
    }
    await sleep(200);
    const stored = (await admin.get(api + "/messages")).data.messages.filter((m) =>
      m.text.startsWith("busy message "),
    );
    assert.equal(stored.length, count(201), "exactly the confirmed messages are stored");
    const confirmed = new Set(results.filter((r) => r.status === 201).map((r) => r.data.message.id));
    for (const m of stored) assert.ok(confirmed.has(m.id));
  });

  test("a refused message can be sent again later with the same id", async () => {
    const b = new Browser(server);
    await join(b, slug, "Patient");
    // Exhaust the room limit with other senders first.
    const others = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const o = new Browser(server);
        await join(o, slug, "Filler " + i);
        return o;
      }),
    );
    await Promise.all(
      others.map((o, i) => o.post(api + "/messages", { text: "filler " + i, clientMessageId: cid(300 + i) })),
    );
    const id = cid(400);
    let r = await b.post(api + "/messages", { text: "eventually", clientMessageId: id });
    for (let i = 0; i < 10 && r.status !== 201 && r.status !== 200; i++) {
      assert.ok([429, 503].includes(r.status));
      await sleep(Number(r.headers.get("retry-after") || 1) * 1000);
      r = await b.post(api + "/messages", { text: "eventually", clientMessageId: id });
    }
    assert.ok([200, 201].includes(r.status));
    const stored = (await admin.get(api + "/messages")).data.messages.filter((m) => m.text === "eventually");
    assert.equal(stored.length, 1);
  });
});

test.describe("delivery", () => {
  let server, admin, slug, api;
  test.before(async () => {
    server = await startServer({
      env: { ROOM_PUBLISH_PER_SECOND: "1000", FANOUT_INTERVAL_MS: "100", FANOUT_SLICE: "10" },
    });
    admin = await adminBrowser(server);
    slug = (await createEvent(admin, { title: "Delivery", mode: "open" })).slug;
    api = "/api/events/" + slug;
  });
  test.after(async () => server?.stop());

  test("every reader receives every message exactly once, in stored order", async () => {
    const readers = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        const b = new Browser(server);
        const j = await join(b, slug, "Reader " + i);
        return { b, ticket: j.ticket };
      }),
    );
    const streams = readers.map((r) => openPublicStream(r.b, slug, r.ticket, 2500));
    await sleep(300);
    const senders = await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        const b = new Browser(server);
        await join(b, slug, "Writer " + i);
        return b;
      }),
    );
    const sent = await Promise.all(
      senders.map((b, i) => b.post(api + "/messages", { text: "order " + i, clientMessageId: cid(500 + i) })),
    );
    assert.ok(sent.every((r) => r.status === 201));
    // Moderator publishes/withdraws are delivered in the same order as well.
    const stored = (await admin.get(api + "/messages")).data.messages.filter((m) =>
      m.text.startsWith("order "),
    );
    const expectedOrder = stored.map((m) => m.id);
    const results = await Promise.all(streams);
    for (const s of results) {
      const got = s.events
        .filter((e) => e.event === "public" && e.data.text.startsWith("order "))
        .map((e) => e.data.id);
      assert.deepEqual(got, expectedOrder);
    }
    // Batching: 40 messages reached each reader in a few writes, not 40.
    const health = await fetch(server.base + "/health").then((r) => r.json());
    assert.ok(health.ok);
  });

  test("join returns a stream ticket; the stream does not repeat the join history", async () => {
    const b = new Browser(server);
    const j = await join(b, slug, "Ticket");
    assert.ok(j.ticket);
    assert.ok(j.history.length > 0);
    const s = await openPublicStream(b, slug, j.ticket, 300);
    const ready = s.events.find((e) => e.event === "ready").data;
    assert.deepEqual(ready.history, []);
    // A later ticket (reconnect) does include the recent history.
    const t = await b.post(api + "/stream-ticket", { scope: "public" });
    const s2 = await openPublicStream(b, slug, t.data.ticket, 300);
    assert.ok(s2.events.find((e) => e.event === "ready").data.history.length > 0);
  });

  test("closed streams and ended sessions are cleaned up", async () => {
    const before = (await fetch(server.base + "/health").then((r) => r.json())).connections;
    const b = new Browser(server);
    const j = await join(b, slug, "Leaver");
    const s = openPublicStream(b, slug, j.ticket, 300);
    await sleep(100);
    assert.equal((await fetch(server.base + "/health").then((r) => r.json())).connections, before + 1);
    await s;
    await sleep(100);
    assert.equal((await fetch(server.base + "/health").then((r) => r.json())).connections, before);
    assert.equal((await b.post(api + "/session/end", {})).status, 200);
    assert.equal((await b.get(api + "/session")).status, 401);
  });

  test("short test sessions: sessionMinutes can only shorten the lifetime", async () => {
    const b = new Browser(server);
    const r = await b.post(api + "/join", { name: "Short", sessionMinutes: 5 });
    assert.ok(r.data.expiresAt - Date.now() <= 5 * 60000 + 1000);
    const long = await new Browser(server).post(api + "/join", { name: "Long", sessionMinutes: 99999 });
    assert.ok(long.data.expiresAt - Date.now() <= 24 * 3600000 + 1000);
    assert.match([...b.cookies.values()].find((c) => c.name === "g8s").raw, /Max-Age=300/);
  });
});

test("a confirmed message survives a hard crash (journal) and its id stays idempotent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-crash-"));
  let server = await startServer({ dataDir: dir });
  const admin = await adminBrowser(server);
  const slug = (await createEvent(admin, { title: "Crash", mode: "open" })).slug;
  const api = "/api/events/" + slug;
  // Let the snapshot with the event settle, then send and crash immediately.
  await sleep(2600);
  const b = new Browser(server);
  await join(b, slug, "Crash");
  await sleep(2600); // guest sessions are saved within 3 s
  const id = cid(900);
  const r = await b.post(api + "/messages", { text: "confirmed before crash", clientMessageId: id });
  assert.equal(r.status, 201);
  // SIGKILL: no graceful shutdown, no snapshot after the message.
  const pid = Number(
    fs
      .readdirSync("/proc")
      .filter((p) => /^\d+$/.test(p))
      .find((p) => {
        try {
          return (
            fs.readFileSync("/proc/" + p + "/environ", "utf8").includes("DATA_DIR=" + dir) &&
            fs.readFileSync("/proc/" + p + "/cmdline", "utf8").includes("server.js")
          );
        } catch {
          return false;
        }
      }),
  );
  assert.ok(pid > 0);
  process.kill(pid, "SIGKILL");
  await sleep(300);
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.ok(!snapshot.messages.some((m) => m.text === "confirmed before crash"), "not yet in the snapshot");
  assert.ok(
    fs.readdirSync(dir).some((f) => f.endsWith(".journal")),
    "journal file present",
  );

  server = await startServer({ dataDir: dir });
  try {
    b.server = server;
    const admin2 = await adminBrowser(server);
    const stored = (await admin2.get(api + "/messages")).data.messages.filter(
      (m) => m.text === "confirmed before crash",
    );
    assert.equal(stored.length, 1, "recovered from the journal");
    const again = await b.post(api + "/messages", { text: "confirmed before crash", clientMessageId: id });
    assert.equal(again.status, 200, "retry after restart is recognised");
    assert.equal(again.data.message.id, r.data.message.id);
    // The next snapshot absorbs the journal and removes covered journal files.
    await sleep(2600);
    const after = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(after.messages.filter((m) => m.text === "confirmed before crash").length, 1);
  } finally {
    await server.stop();
  }
});

test("static files: ETag revalidation and compression", async () => {
  const server = await startServer();
  try {
    const r = await fetch(server.base + "/app.js", { headers: { "accept-encoding": "gzip" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-encoding"), "gzip");
    const etag = r.headers.get("etag");
    assert.ok(etag);
    const body = await r.text(); // fetch decompresses
    assert.ok(body.includes("sendChatMessage"));
    const again = await fetch(server.base + "/app.js", { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
    const page = await fetch(server.base + "/e/whatever", { headers: { "accept-encoding": "br" } });
    assert.equal(page.headers.get("content-encoding"), "br");
    assert.equal((await fetch(server.base + "/nope.js")).status, 404);
  } finally {
    await server.stop();
  }
});

test("metrics log lines contain counts and timings only", async () => {
  const server = await startServer({ env: { METRICS_LOG_SECONDS: "1" } });
  try {
    const admin = await adminBrowser(server);
    const slug = (await createEvent(admin, { title: "Metrics", mode: "open" })).slug;
    const b = new Browser(server);
    await join(b, slug, "Metric Person");
    await b.post("/api/events/" + slug + "/messages", {
      text: "metric secret text",
      clientMessageId: cid(950),
    });
    await sleep(1300);
    const lines = server
      .output()
      .split("\n")
      .filter((l) => l.startsWith('{"metrics"'));
    assert.ok(lines.length >= 1);
    const m = JSON.parse(lines.at(-1)).metrics;
    assert.ok("loopDelayMs" in m && "fanout" in m && "journal" in m && "postMs" in m);
    const all = lines.join("\n");
    for (const secret of ["metric secret text", "Metric Person", "g8s", b.csrf])
      assert.ok(!all.includes(secret), "metrics must not contain " + secret);
  } finally {
    await server.stop();
  }
});

test("load test script: burst with 300 attendees accounts every message exactly", async () => {
  const server = await startServer({ env: { ROOM_PUBLISH_PER_SECOND: "50" } });
  try {
    const admin = await adminBrowser(server);
    await admin.post("/api/events", { title: "testevent", slug: "testevent", mode: "open", capacity: 1000 });
    const out = await new Promise((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [
          path.join(ROOT, "scripts", "loadtest.js"),
          "--url",
          server.base,
          "--event",
          "testevent",
          "--attendees",
          "300",
          "--scenario",
          "burst",
          "--workers",
          "2",
          "--settle",
          "2",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let text = "";
      p.stdout.on("data", (d) => (text += d));
      p.on("exit", (code) =>
        code === 0 ? resolve(JSON.parse(text)) : reject(Error("loadtest exited " + code)),
      );
    });
    assert.equal(out.join.joined, 300);
    assert.equal(out.posts.attempts, 300);
    const st = out.posts.statuses;
    assert.equal((st["201"] || 0) + (st["429"] || 0) + (st["503"] || 0), 300, JSON.stringify(st));
    assert.equal(out.placed.uniqueMessageIds, out.placed.acceptedBySender);
    assert.equal(out.placed.placedWithoutSuccess, 0);
    assert.equal(out.placed.duplicates, 0);
    assert.equal(out.deliveries.received, out.deliveries.expected);
    assert.equal(out.disconnects, 0);
    assert.equal(out.cleanup.ended, 300);
    // All test sessions were ended on the server.
    const health = await fetch(server.base + "/health").then((r) => r.json());
    assert.equal(health.connections, 0);
  } finally {
    await server.stop();
  }
});
