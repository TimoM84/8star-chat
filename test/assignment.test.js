"use strict";
// Assignment of questions and private conversations to moderators.
// Rule: a moderator only sees and handles what is explicitly assigned to their
// own user id; moderator rights alone never give access to anything that is
// unassigned or assigned to another moderator. The platform admin and the
// event owner see and handle everything, and (re)assign.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, Browser, adminBrowser, createEvent, join, sleep } = require("./helpers");

const PASSWORD = "moderator-pass-123";
const cid = () => "assign-" + Math.random().toString(36).slice(2, 12);

async function staffBrowser(server, email) {
  const b = new Browser(server);
  const r = await b.post("/api/login", { email, password: PASSWORD });
  assert.equal(r.status, 200, "login " + email);
  b.csrf = r.data.csrf;
  return b;
}

test.describe("assignment to moderators", () => {
  let server, admin, owner, modA, modB, stageUser, slug, api, ids, users;
  const texts = (r) => r.data.messages.map((m) => m.text);

  test.before(async () => {
    server = await startServer({ env: { ROOM_PUBLISH_PER_SECOND: "50" } });
    admin = await adminBrowser(server);
    slug = (await createEvent(admin, { title: "Assign", mode: "moderated" })).slug;
    api = "/api/events/" + slug;
    for (const [email, role] of [
      ["a@example.com", "moderator"],
      ["b@example.com", "moderator"],
      ["owner@example.com", "event-owner"],
      ["stage@example.com", "stage"],
    ])
      assert.equal((await admin.post(api + "/moderators", { email, password: PASSWORD, role })).status, 201);
    users = Object.fromEntries((await admin.get(api + "/moderators")).data.users.map((u) => [u.email, u.id]));
    modA = await staffBrowser(server, "a@example.com");
    modB = await staffBrowser(server, "b@example.com");
    owner = await staffBrowser(server, "owner@example.com");
    stageUser = await staffBrowser(server, "stage@example.com");
    // Two public questions and two private conversations from attendees.
    ids = {};
    for (const [key, text] of [
      ["q1", "question one for A"],
      ["q2", "question two for B"],
    ]) {
      const g = new Browser(server);
      await join(g, slug, "Asker " + key);
      ids[key] = (await g.post(api + "/messages", { text, clientMessageId: cid() })).data.message.id;
    }
    for (const key of ["p1", "p2"]) {
      const g = new Browser(server);
      const joined = await join(g, slug, "Private " + key);
      const token = (await g.post(api + "/private/pin", { pin: "pin-" + key + "-123" })).data.privateToken;
      const r = await g.post(
        api + "/messages",
        { text: "private " + key + " text", kind: "private", clientMessageId: cid() },
        { headers: { "x-private-token": token } },
      );
      assert.equal(r.status, 201);
      ids[key] = { participant: joined.participantId || null, browser: g, token };
    }
    // participant ids as seen by the admin
    const all = (await admin.get(api + "/messages")).data.messages;
    for (const key of ["p1", "p2"])
      ids[key].participant = all.find((m) => m.text === "private " + key + " text").participantId;
  });
  test.after(async () => server?.stop());

  test("before assignment a moderator sees nothing; owner and admin see everything", async () => {
    for (const mod of [modA, modB]) {
      const r = await mod.get(api + "/messages");
      assert.equal(r.status, 200);
      assert.deepEqual(
        texts(r).filter((t) => /question|private/.test(t)),
        [],
      );
      assert.deepEqual(r.data.privateThreads, {});
      assert.equal(r.data.manager, false);
    }
    for (const mgr of [admin, owner]) {
      const r = await mgr.get(api + "/messages");
      for (const t of ["question one for A", "question two for B", "private p1 text", "private p2 text"])
        assert.ok(texts(r).includes(t), t);
      assert.equal(r.data.manager, true);
    }
  });

  test("only the owner assigns, and only to active moderators of the event", async () => {
    assert.equal(
      (await modA.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["a@example.com"] }))
        .status,
      403,
    );
    assert.equal(
      (
        await modA.post(api + "/conversations/" + ids.p1.participant + "/assign", {
          assignedTo: users["a@example.com"],
        })
      ).status,
      404,
      "a moderator cannot even see an unassigned conversation",
    );
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["stage@example.com"] }))
        .status,
      400,
    );
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: "nobody" })).status,
      400,
    );
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["a@example.com"] }))
        .status,
      200,
    );
    assert.equal(
      (await admin.post(api + "/messages/" + ids.q2 + "/assign", { assignedTo: users["b@example.com"] }))
        .status,
      200,
    );
    assert.equal(
      (
        await owner.post(api + "/conversations/" + ids.p1.participant + "/assign", {
          assignedTo: users["a@example.com"],
        })
      ).status,
      200,
    );
  });

  test("each moderator sees only their own assignments", async () => {
    const a = await modA.get(api + "/messages"),
      b = await modB.get(api + "/messages");
    assert.deepEqual(
      texts(a)
        .filter((t) => /question|private/.test(t))
        .sort(),
      ["private p1 text", "question one for A"],
    );
    assert.deepEqual(Object.keys(a.data.privateThreads), [ids.p1.participant]);
    assert.deepEqual(
      texts(b).filter((t) => /question|private/.test(t)),
      ["question two for B"],
    );
    assert.deepEqual(b.data.privateThreads, {});
    // The owner sees who has what.
    const all = (await owner.get(api + "/messages")).data;
    assert.equal(all.messages.find((m) => m.id === ids.q1).assignedTo, users["a@example.com"]);
    assert.equal(all.privateThreads[ids.p1.participant].assignedTo, users["a@example.com"]);
  });

  test("a moderator cannot act on anything assigned to someone else", async () => {
    const q1 = api + "/messages/" + ids.q1;
    for (const act of ["publish", "reject", "withdraw", "stage", "delete"])
      assert.equal((await modB.post(q1 + "/" + act, {})).status, 404, act);
    assert.notEqual((await modB.post(api + "/ban", { messageId: ids.q1 })).status, 200);
    assert.notEqual((await modB.post(api + "/ban-ip", { messageId: ids.q1 })).status, 200);
    assert.equal(
      (await modB.post(api + "/messages/private", { participantId: ids.p1.participant, text: "intrude" }))
        .status,
      404,
    );
    assert.equal((await modB.post(api + "/conversations/" + ids.p1.participant + "/close", {})).status, 404);
    assert.equal((await modB.post(api + "/conversations/" + ids.p2.participant + "/close", {})).status, 404);
    // The assigned moderator can.
    assert.equal((await modA.post(q1 + "/publish", {})).status, 200);
    assert.equal((await modB.post(api + "/pins", { messageId: ids.q1 })).status, 400);
    assert.equal((await modB.del(api + "/pins/" + ids.q1)).status, 404);
    assert.equal((await modA.post(api + "/pins", { messageId: ids.q1 })).status, 200);
    assert.equal(
      (
        await modA.post(api + "/messages/private", {
          participantId: ids.p1.participant,
          text: "answer from A",
        })
      ).status,
      201,
    );
    assert.equal((await modA.post(api + "/conversations/" + ids.p1.participant + "/close", {})).status, 200);
    // Nothing of A's work became visible to B. (A pinned question is shown in
    // the public chat to everyone, so it may appear in the public pin list.)
    const b = await modB.get(api + "/messages");
    assert.ok(!texts(b).includes("question one for A"));
    assert.ok(!b.text.includes("answer from A"));
  });

  test("a new attendee message keeps the conversation's assignment", async () => {
    await sleep(5100); // per-attendee limit
    const r = await ids.p1.browser.post(
      api + "/messages",
      { text: "private p1 follow-up", kind: "private", clientMessageId: cid() },
      { headers: { "x-private-token": ids.p1.token } },
    );
    assert.equal(r.status, 201);
    const all = (await owner.get(api + "/messages")).data;
    assert.equal(all.privateThreads[ids.p1.participant].assignedTo, users["a@example.com"]);
    assert.equal(all.privateThreads[ids.p1.participant].status, "open");
    assert.ok(texts(await modA.get(api + "/messages")).includes("private p1 follow-up"));
    assert.ok(!texts(await modB.get(api + "/messages")).includes("private p1 follow-up"));
  });

  test("moderator live connections never carry message content", async () => {
    const stream = modB.stream(api + "/stream", { ms: 900 });
    await sleep(200);
    const g = new Browser(server);
    await join(g, slug, "Live asker");
    await g.post(api + "/messages", { text: "secret pending text", clientMessageId: cid() });
    await sleep(5100);
    const token = (await g.post(api + "/private/pin", { pin: "live-pin-1234" })).data.privateToken;
    await g.post(
      api + "/messages",
      { text: "secret private live text", kind: "private", clientMessageId: cid() },
      { headers: { "x-private-token": token } },
    );
    const s = await stream;
    assert.equal(s.status, 200);
    assert.ok(
      s.events.some((e) => e.event === "inbox"),
      "moderators are told that something changed",
    );
    assert.ok(!s.text.includes("secret pending text"));
    assert.ok(!s.text.includes("secret private live text"));
  });

  test("owner-only areas are closed to moderators", async () => {
    assert.equal((await modA.get(api + "/export")).status, 403);
    assert.equal((await modA.patch(api + "/settings", { mode: "open" })).status, 403);
    assert.equal((await modA.get(api + "/bans")).status, 403);
    assert.equal((await modA.get(api + "/moderators")).status, 403);
    assert.equal((await owner.get(api + "/export")).status, 200);
    const csv = (await owner.get(api + "/export")).text;
    assert.ok(csv.includes("a@example.com"), "export shows the assigned moderator's e-mail");
  });

  test("the stage screen is for stage accounts and the owner, not for moderators", async () => {
    assert.equal((await modA.stream(api + "/stream?screen=stage", { ms: 300 })).status, 403);
    assert.equal((await modA.post(api + "/stage-reply", { text: "hi" })).status, 401);
    const st = await stageUser.stream(api + "/stream?screen=stage", { ms: 300 });
    assert.equal(st.status, 200);
    assert.equal((await stageUser.post(api + "/stage-reply", { text: "from stage" })).status, 201);
    // Messages from the stage are a team message: every moderator sees them.
    assert.ok(texts(await modB.get(api + "/messages")).includes("from stage"));
  });

  test("reassign and remove an assignment", async () => {
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["b@example.com"] }))
        .status,
      200,
    );
    assert.ok(!texts(await modA.get(api + "/messages")).includes("question one for A"));
    assert.ok(texts(await modB.get(api + "/messages")).includes("question one for A"));
    assert.equal((await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: "" })).status, 200);
    assert.ok(!texts(await modB.get(api + "/messages")).includes("question one for A"));
    assert.ok(
      texts(await owner.get(api + "/messages")).includes("question one for A"),
      "owner still sees it",
    );
  });

  test("disabling or removing a moderator makes their items unassigned, never lost", async () => {
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["a@example.com"] }))
        .status,
      200,
    );
    // Disable A: q1 and conversation p1 become unassigned.
    assert.equal(
      (await admin.patch(api + "/moderators/" + users["a@example.com"], { active: false })).status,
      200,
    );
    let all = (await owner.get(api + "/messages")).data;
    assert.equal(all.messages.find((m) => m.id === ids.q1).assignedTo, "");
    assert.equal(all.privateThreads[ids.p1.participant].assignedTo, "");
    assert.ok(
      all.messages.some((m) => m.text === "private p1 text"),
      "the conversation is still there",
    );
    // An inactive moderator cannot be chosen.
    assert.equal(
      (await owner.post(api + "/messages/" + ids.q1 + "/assign", { assignedTo: users["a@example.com"] }))
        .status,
      400,
    );
    // Remove B from the event: q2 becomes unassigned.
    assert.equal((await owner.del(api + "/moderators", { userId: users["b@example.com"] })).status, 200);
    all = (await owner.get(api + "/messages")).data;
    assert.equal(all.messages.find((m) => m.id === ids.q2).assignedTo, "");
    // B has no access to the event any more at all.
    assert.equal((await modB.get(api + "/messages")).status, 401);
  });
});

test("on start-up, items assigned to someone who is no longer an active moderator become unassigned", async () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-assign-"));
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      events: [
        {
          id: "ev1",
          slug: "old-event",
          title: "Old event",
          mode: "moderated",
          capacity: 100,
          active: true,
          chatEnabled: true,
          moderators: ["u-active", "u-disabled"],
          privateThreads: { "p-1": { status: "open", updatedAt: now, assignedTo: "u-disabled" } },
          branding: { logo: "" },
          createdAt: now,
        },
      ],
      users: [
        { id: "u-active", email: "active@example.com", role: "moderator", active: true },
        { id: "u-disabled", email: "disabled@example.com", role: "moderator", active: false },
      ],
      messages: [
        {
          id: "m1",
          slug: "old-event",
          text: "kept",
          author: "A",
          type: "question",
          visibility: "private",
          status: "pending",
          assignedTo: "u-active",
          createdAt: now,
        },
        {
          id: "m2",
          slug: "old-event",
          text: "freed",
          author: "B",
          type: "question",
          visibility: "private",
          status: "pending",
          assignedTo: "u-disabled",
          createdAt: now,
        },
        {
          id: "m3",
          slug: "old-event",
          text: "gone user",
          author: "C",
          type: "question",
          visibility: "private",
          status: "pending",
          assignedTo: "u-deleted",
          createdAt: now,
        },
        {
          id: "m4",
          slug: "old-event",
          text: "private",
          author: "D",
          type: "private",
          visibility: "private",
          status: "private",
          participantId: "p-1",
          createdAt: now,
        },
      ],
      bans: [],
    }),
  );
  const server = await startServer({ dataDir: dir });
  try {
    const admin = await adminBrowser(server);
    const d = (await admin.get("/api/events/old-event/messages")).data;
    const by = Object.fromEntries(d.messages.map((m) => [m.id, m.assignedTo]));
    assert.equal(by.m1, "u-active");
    assert.equal(by.m2, "");
    assert.equal(by.m3, "");
    assert.equal(d.privateThreads["p-1"].assignedTo, "");
  } finally {
    await server.stop();
  }
});
