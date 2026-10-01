#!/usr/bin/env node
"use strict";
// End-to-end burst test: N connected attendees each send one message at the
// same moment. Fails (exit 1) unless every request got a definite answer and
// the accounting is exact.
//
//   node scripts/e2e-burst.js                       # temporary local server, 5000 attendees
//   node scripts/e2e-burst.js --attendees 2000
//   node scripts/e2e-burst.js --url https://chat.example.com --event testevent [--workers 4]
//
// Without --url a temporary server is started with its own empty data
// directory (ROOM_PUBLISH_PER_SECOND=50), an Open event "testevent" is created,
// and everything is removed afterwards.
// Checks:
//   - every attendee joined and stayed connected
//   - every send got 201, 429 or 503 (no 5xx from a proxy, no time-outs)
//   - every send was answered within --max-seconds (default 15)
//   - published messages = senders with a success answer (none published
//     without a success answer, no duplicates)
//   - every connected attendee received every published message
//   - every test session was ended
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const attendees = Number(opt("attendees", 5000)),
  workers = Number(opt("workers", 2)),
  maxSeconds = Number(opt("max-seconds", 15)),
  event = opt("event", "testevent"),
  // Optional CPU pinning (Linux, needs `taskset`): keeps the load generator
  // from taking CPU time away from a local server under test.
  serverCpu = opt("server-cpu", ""),
  clientCpu = opt("client-cpu", "");
const pinned = (cpu, cmd, cmdArgs) => (cpu ? ["taskset", ["-c", cpu, cmd, ...cmdArgs]] : [cmd, cmdArgs]);
let url = opt("url", "");

async function startLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8star-e2e-"));
  const port = 39000 + Math.floor(Math.random() * 2000);
  const password = crypto.randomBytes(12).toString("hex");
  const [serverCmd, serverArgs] = pinned(serverCpu, process.execPath, [
    path.join(__dirname, "..", "server.js"),
  ]);
  const child = spawn(serverCmd, serverArgs, {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_PASSWORD: password,
      ROOM_PUBLISH_PER_SECOND: "50",
      METRICS_LOG_SECONDS: "5",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const h = { origin: base, "content-type": "application/json" };
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email: "admin@example.com", password }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { csrf } = await login.json();
  const created = await fetch(base + "/api/events", {
    method: "POST",
    headers: { ...h, cookie, "x-csrf-token": csrf },
    body: JSON.stringify({ title: "testevent", slug: event, mode: "open", capacity: 20000 }),
  });
  if (created.status !== 201) throw Error("could not create the test event");
  return {
    base,
    log: () => log,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

(async () => {
  const local = url ? null : await startLocal();
  if (local) url = local.base;
  const extra = args.filter(
    (a, i) =>
      ![
        "--url",
        "--event",
        "--attendees",
        "--workers",
        "--max-seconds",
        "--server-cpu",
        "--client-cpu",
      ].includes(a) &&
      ![
        "--url",
        "--event",
        "--attendees",
        "--workers",
        "--max-seconds",
        "--server-cpu",
        "--client-cpu",
      ].includes(args[i - 1]),
  );
  const report = await new Promise((resolve, reject) => {
    const [clientCmd, clientArgs] = pinned(clientCpu, process.execPath, [
      path.join(__dirname, "loadtest.js"),
      "--url",
      url,
      "--event",
      event,
      "--attendees",
      String(attendees),
      "--scenario",
      "burst",
      "--workers",
      String(workers),
      "--settle",
      "5",
      ...extra,
    ]);
    const p = spawn(clientCmd, clientArgs, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(Error("loadtest exited with " + code)),
    );
  });
  if (local) {
    const metrics = local
      .log()
      .split("\n")
      .filter((l) => l.startsWith('{"metrics"'))
      .map((l) => JSON.parse(l).metrics);
    report.server = {
      maxLoopDelayMs: Math.max(0, ...metrics.map((m) => m.loopDelayMs.max)),
      maxRssMB: Math.max(0, ...metrics.map((m) => m.rssMB)),
      slowClientsDropped: metrics.reduce((s, m) => s + m.fanout.slowClientsDropped, 0),
    };
    await local.stop();
  }
  const st = report.posts.statuses;
  const firstDefinite = report.placed.firstAnswerDefinite;
  const checks = [
    ["all attendees joined", report.join.joined === attendees],
    ["all attendees still connected", report.stillConnectedAtEnd === attendees && report.disconnects === 0],
    [
      "at least 99% of sends got a definite first answer (201/200/429/503)",
      firstDefinite >= attendees * 0.99,
    ],
    ["95% of sends answered within " + maxSeconds + " s", report.posts.responseMs.p95 <= maxSeconds * 1000],
    ["no proxy errors (502/504)", !st["502"] && !st["504"]],
    ["after recovery, every sender knows the outcome", report.placed.finalOutcomeUnknown === 0],
    ["no message published without the sender knowing", report.placed.placedWithoutSuccess === 0],
    ["no duplicates", report.placed.duplicates === 0],
    ["published = accepted by senders", report.placed.uniqueMessageIds === report.placed.acceptedBySender],
    ["every reader received every message", report.deliveries.received === report.deliveries.expected],
    ["all test sessions ended", report.cleanup.ended === attendees],
  ];
  console.log(JSON.stringify(report, null, 2));
  for (const [name, ok] of checks) console.error((ok ? "PASS " : "FAIL ") + name);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
