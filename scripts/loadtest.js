#!/usr/bin/env node
"use strict";
// Local load test. Starts its own server with a temporary data directory,
// connects N attendees (join + stream ticket + SSE), then publishes messages
// and measures how long it takes until every attendee received each one.
//
//   node scripts/loadtest.js [attendees=2000] [messages=20]
//
// Client and server run on the same machine, so the numbers describe this
// machine only. They are not a capacity guarantee for production (reverse
// proxy, network, TLS and real browsers are not included).
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const N = Number(process.argv[2] || 2000),
  MESSAGES = Number(process.argv[3] || 10);
// LEGACY_SERVER=/path/to/old/server.js measures a pre-0.6 server (token API).
const SERVER = process.env.LEGACY_SERVER || path.join(__dirname, "..", "server.js"),
  LEGACY = Boolean(process.env.LEGACY_SERVER);
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const sseAgent = new http.Agent({ keepAlive: false, maxSockets: Infinity });

function request(port, method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: p,
        agent,
        headers: {
          origin: "http://127.0.0.1:" + port,
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          let json = text;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const cookieOf = (res) =>
  (res.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
const rss = (pid) => {
  const m = fs.readFileSync("/proc/" + pid + "/status", "utf8").match(/VmRSS:\s+(\d+)/);
  return m ? Math.round(Number(m[1]) / 1024) : NaN;
};
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

let child;
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-load-"));
  const port = 39000 + Math.floor(Math.random() * 1000);
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_PASSWORD: "load-test-password",
      ROOM_PUBLISH_PER_SECOND: "1000",
    },
    stdio: "inherit",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request(port, "GET", "/health")).status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const rssStart = rss(child.pid);
  const login = await request(port, "POST", "/api/login", {
    body: { email: "admin@example.com", password: "load-test-password" },
  });
  const staff = { cookie: cookieOf(login), ...(login.data.csrf ? { "x-csrf-token": login.data.csrf } : {}) };
  const ev = (
    await request(port, "POST", "/api/events", {
      body: { title: "Load", capacity: 20000, mode: "moderated" },
      headers: staff,
    })
  ).data.event;
  const api = "/api/events/" + ev.slug;

  // Join + connect attendees.
  const received = new Map(); // messageId -> [receive times]
  const streams = [];
  let joinFailures = 0;
  const tJoin = Date.now();
  const connectOne = async (i) => {
    const j = await request(port, "POST", api + "/join", { body: { name: "Guest " + i } });
    if (j.status !== 200) return joinFailures++;
    let streamPath;
    if (LEGACY) streamPath = api + "/stream?token=" + encodeURIComponent(j.data.token);
    else {
      const headers = { cookie: cookieOf(j), "x-csrf-token": j.data.csrf };
      const t = await request(port, "POST", api + "/stream-ticket", { body: { scope: "public" }, headers });
      if (t.status !== 200) return joinFailures++;
      streamPath = api + "/stream?ticket=" + encodeURIComponent(t.data.ticket);
    }
    await new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: streamPath, agent: sseAgent }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          buf += d;
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (block.includes("event: ready")) resolve();
            if (block.includes("event: public")) {
              const data = JSON.parse(block.split("\ndata: ")[1]);
              const list = received.get(data.id) || [];
              list.push(Date.now());
              received.set(data.id, list);
            }
          }
        });
      });
      req.on("error", () => {
        joinFailures++;
        resolve();
      });
      streams.push(req);
    });
  };
  const BATCH = 100;
  for (let i = 0; i < N; i += BATCH)
    await Promise.all(Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => connectOne(i + k)));
  const joinMs = Date.now() - tJoin;
  const rssConnected = rss(child.pid);

  // One attendee asks questions, the moderator publishes them.
  const asker = await request(port, "POST", api + "/join", { body: { name: "Asker" } });
  const askerHeaders = {
    cookie: cookieOf(asker),
    ...(asker.data.csrf ? { "x-csrf-token": asker.data.csrf } : {}),
  };
  const latencies = [];
  let incomplete = 0;
  for (let m = 0; m < MESSAGES; m++) {
    await request(port, "POST", api + "/messages", {
      body: { text: "Question " + m, ...(LEGACY ? { token: asker.data.token } : {}) },
      headers: askerHeaders,
    });
    const list = (await request(port, "GET", api + "/messages", { headers: staff })).data.messages;
    const q = list.find((x) => x.text === "Question " + m);
    const sent = Date.now();
    await request(port, "POST", api + "/messages/" + q.id + "/publish", { body: {}, headers: staff });
    const deadline = Date.now() + 10000;
    while ((received.get(q.id)?.length || 0) < N - joinFailures && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 5));
    const times = received.get(q.id) || [];
    if (times.length < N - joinFailures) incomplete++;
    latencies.push(Math.max(...times) - sent);
    // The per-attendee rate limit is 5 s; wait it out between questions.
    await new Promise((r) => setTimeout(r, 5050));
  }
  const rssEnd = rss(child.pid);
  const health = (await request(port, "GET", "/health")).data;
  const result = {
    server: LEGACY ? "legacy: " + SERVER : "current",
    node: process.version,
    cpus: os.cpus().length,
    attendees: N,
    connected: health.connections,
    joinFailures,
    joinAndConnectSeconds: +(joinMs / 1000).toFixed(1),
    joinsPerSecond: Math.round(N / (joinMs / 1000)),
    fanOutLastDeliveryMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: Math.max(...latencies) },
    messagesNotDeliveredToAll: incomplete,
    serverRssMB: { start: rssStart, connected: rssConnected, end: rssEnd },
    approxKBPerConnection: Math.round(((rssConnected - rssStart) * 1024) / N),
  };
  console.log(JSON.stringify(result, null, 2));
  streams.forEach((r) => r.destroy());
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  child?.kill("SIGKILL");
  process.exit(1);
});
