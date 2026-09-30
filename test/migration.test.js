"use strict";
// Existing data from v0.5.0 must keep working after the upgrade, and attendee
// sessions must survive a restart without weakening the PIN protection.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer, Browser, adminBrowser, join, sleep } = require("./helpers");

test("v0.5.0 data loads; legacy private threads stay visible to moderators only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-legacy-"));
  const now = new Date().toISOString();
  // Minimal v0.5.0 state: admin hash is created by the server on first start,
  // so only events/messages/bans are provided here plus an owner account.
  const legacy = {
    events: [
      {
        id: "ev1",
        slug: "legacy-event",
        title: "Legacy event",
        mode: "moderated",
        capacity: 100,
        active: true,
        chatEnabled: true,
        moderators: [],
        branding: { logo: "" },
        createdAt: now,
      },
    ],
    users: [],
    messages: [
      {
        id: "m1",
        slug: "legacy-event",
        text: "Old public",
        author: "Ann",
        participantId: "client-id-ann",
        ipHash: "abc",
        type: "question",
        visibility: "public",
        status: "published",
        createdAt: now,
      },
      {
        id: "m2",
        slug: "legacy-event",
        text: "Old private secret",
        author: "Ann",
        participantId: "client-id-ann",
        type: "private",
        visibility: "private",
        status: "private",
        createdAt: now,
      },
      {
        id: "m3",
        slug: "legacy-event",
        text: "Old reply",
        author: "mod@example.com",
        type: "private-reply",
        visibility: "private",
        status: "private",
        targetParticipantId: "client-id-ann",
        createdAt: now,
      },
      {
        id: "m4",
        slug: "legacy-event",
        text: "Old stage",
        author: "Bob",
        type: "question",
        status: "stage",
        createdAt: now,
      },
    ],
    bans: [
      { id: "b1", slug: "legacy-event", participantId: "client-id-bob", by: "mod@example.com", at: now },
    ],
    ipBlockKey: "legacy-ip-key",
  };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(legacy));
  const server = await startServer({ dataDir: dir });
  try {
    const admin = await adminBrowser(server);
    const api = "/api/events/legacy-event";
    const msgs = (await admin.get(api + "/messages")).data.messages;
    assert.ok(msgs.some((m) => m.text === "Old private secret"));
    assert.equal(msgs.find((m) => m.id === "m4").stageState, "queued"); // existing migration still runs
    assert.equal((await admin.get(api + "/bans")).data.bans.length, 1);
    // The legacy IP key moved to its own file, as before.
    assert.equal(fs.readFileSync(path.join(dir, "ip-block-key"), "utf8"), "legacy-ip-key");

    // An attendee claiming the old client id gets nothing.
    const b = new Browser(server);
    const joined = await b.post(api + "/join", { name: "Ann", participantId: "client-id-ann" });
    assert.ok(!joined.text.includes("Old private secret"));
    assert.ok(!joined.text.includes("client-id-ann"), "old participant ids are not exposed");
    assert.ok(!joined.text.includes('"ipHash"'));
    b.csrf = joined.data.csrf;
    const token = (await b.post(api + "/private/pin", { pin: "ann-new-pin" })).data.privateToken;
    const history = await b.post(api + "/private/history", {}, { headers: { "x-private-token": token } });
    assert.deepEqual(history.data.messages, []);
    // Public history is still shown.
    assert.ok(joined.data.history.some((m) => m.text === "Old public"));
  } finally {
    await server.stop();
  }
});

test("attendee sessions survive a restart; the PIN is still required afterwards", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-restart-"));
  let server = await startServer({ dataDir: dir });
  const admin = await adminBrowser(server);
  const slug = (await admin.post("/api/events", { title: "Restart" })).data.event.slug;
  const api = "/api/events/" + slug;
  const b = new Browser(server);
  await join(b, slug, "Persistent");
  const token = (await b.post(api + "/private/pin", { pin: "persist-pin" })).data.privateToken;
  await b.post(
    api + "/messages",
    { text: "before restart", kind: "private" },
    { headers: { "x-private-token": token } },
  );
  await sleep(300);
  await server.stop(); // SIGTERM flushes pending writes

  server = await startServer({ dataDir: dir, env: {} });
  try {
    // Same port is not guaranteed; point the browser at the new server.
    b.server = server;
    const session = await b.get(api + "/session");
    assert.equal(session.status, 200);
    assert.equal(session.data.name, "Persistent");
    assert.equal(session.data.pinSet, true);
    // The old in-memory unlock token is gone after the restart.
    assert.equal(
      (await b.post(api + "/private/history", {}, { headers: { "x-private-token": token } })).status,
      401,
    );
    const again = (await b.post(api + "/private/unlock", { pin: "persist-pin" })).data.privateToken;
    const history = await b.post(api + "/private/history", {}, { headers: { "x-private-token": again } });
    assert.deepEqual(
      history.data.messages.map((m) => m.text),
      ["before restart"],
    );
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.ok(state.messages.some((m) => m.text === "before restart"));
  } finally {
    await server.stop();
  }
});
