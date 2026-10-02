"use strict";
// Search in the public chat: only published public messages, never private,
// pending, rejected or withdrawn ones; needs an attendee session; limited per
// session; case- and accent-insensitive with every word required.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, Browser, adminBrowser, createEvent, join, sleep } = require("./helpers");

const cid = () => "search-" + Math.random().toString(36).slice(2, 12);

test.describe("public search", () => {
  let server, admin, slug, api;
  // A fresh attendee per search avoids the per-session limit between checks.
  const searcher = async () => {
    const b = new Browser(server);
    await join(b, slug, "Searcher " + Math.random().toString(36).slice(2, 6));
    return b;
  };
  const search = async (q) => (await searcher()).get(api + "/search?q=" + encodeURIComponent(q));

  test.before(async () => {
    server = await startServer({ env: { ROOM_PUBLISH_PER_SECOND: "50" } });
    admin = await adminBrowser(server);
    slug = (await createEvent(admin, { title: "Search", mode: "moderated" })).slug;
    api = "/api/events/" + slug;
    const send = async (name, text, extra = {}, headers = {}) => {
      const b = new Browser(server);
      await join(b, slug, name);
      const r = await b.post(
        api + "/messages",
        { text, clientMessageId: cid(), ...extra },
        { headers: { ...headers } },
      );
      assert.equal(r.status, 201);
      return { b, id: r.data.message.id };
    };
    const publish = (id) => admin.post(api + "/messages/" + id + "/publish", {});
    // Published (visible to everyone).
    const a = await send("Femke", "How will the storm surge barrier affect shipping?");
    assert.equal((await publish(a.id)).status, 200);
    const b = await send("Zoë Café", "Question about the café near the dike");
    assert.equal((await publish(b.id)).status, 200);
    // Published, then withdrawn.
    const w = await send("Withdrawn", "barrier question that was withdrawn later");
    assert.equal((await publish(w.id)).status, 200);
    assert.equal((await admin.post(api + "/messages/" + w.id + "/withdraw", {})).status, 200);
    // Pending (never published) and rejected.
    await send("Pending", "barrier question still waiting for moderation");
    const r = await send("Rejected", "barrier question that was rejected");
    assert.equal((await admin.post(api + "/messages/" + r.id + "/reject", {})).status, 200);
    // Private message.
    const p = new Browser(server);
    await join(p, slug, "Private person");
    const token = (await p.post(api + "/private/pin", { pin: "search-pin-1" })).data.privateToken;
    const pr = await p.post(
      api + "/messages",
      { text: "secret barrier detail for moderators only", kind: "private", clientMessageId: cid() },
      { headers: { "x-private-token": token } },
    );
    assert.equal(pr.status, 201);
    // Announcement (published public, shown as "Moderator").
    assert.equal(
      (await admin.post(api + "/announcements", { text: "Barrier tour starts at 15:00" })).status,
      201,
    );
  });
  test.after(async () => server?.stop());

  test("finds only published public messages, newest first", async () => {
    const r = await search("barrier");
    assert.equal(r.status, 200);
    const texts = r.data.results.map((m) => m.text);
    assert.deepEqual(texts, [
      "Barrier tour starts at 15:00",
      "How will the storm surge barrier affect shipping?",
    ]);
    assert.equal(r.data.total, 2);
    assert.equal(r.data.results[0].author, "Moderator", "announcements never show a staff e-mail address");
    for (const word of ["withdrawn", "waiting", "rejected", "secret"])
      assert.ok(!r.text.includes(word), word + " must not be found");
    // Only the fields the public chat already shows.
    assert.deepEqual(Object.keys(r.data.results[1]).sort(), ["author", "createdAt", "id", "text"]);
  });

  test("case- and accent-insensitive; every word must match; author names too", async () => {
    assert.equal((await search("CAFE")).data.total, 1);
    assert.equal((await search("zoe")).data.results[0].author, "Zoë Café");
    assert.equal((await search("storm shipping")).data.total, 1);
    assert.equal((await search("storm café")).data.total, 0);
  });

  test("needs a session, at least 2 characters, and is limited per session", async () => {
    assert.equal((await new Browser(server).get(api + "/search?q=barrier")).status, 401);
    assert.equal((await search("b")).status, 400);
    assert.equal((await search("x".repeat(101))).status, 400);
    const b = await searcher();
    assert.equal((await b.get(api + "/search?q=barrier")).status, 200);
    const fast = await b.get(api + "/search?q=storm");
    assert.equal(fast.status, 429);
    assert.ok(Number(fast.headers.get("retry-after")) >= 1);
    await sleep(750);
    assert.equal((await b.get(api + "/search?q=storm")).status, 200);
  });

  test("a blocked attendee cannot search", async () => {
    const b = new Browser(server);
    await join(b, slug, "Blocked searcher");
    const sent = await b.post(api + "/messages", {
      text: "blocked person's message",
      clientMessageId: cid(),
    });
    assert.equal((await admin.post(api + "/ban", { messageId: sent.data.message.id })).status, 200);
    assert.equal((await b.get(api + "/search?q=barrier")).status, 403);
  });
});
