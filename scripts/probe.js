"use strict";
// Measurement probe, loaded with `node -r ./scripts/probe.js server.js`.
// Works with any server version (no code changes needed) and prints one JSON
// line per interval to stderr, prefixed with "PROBE ":
//   lag      event-loop delay p50/p99/max in ms (monitorEventLoopDelay)
//   elu      event-loop utilisation 0..1 (1 = the loop never idles)
//   cpu      process CPU % of one core (user+system)
//   rssMB    resident memory
//   sockets  open TCP connections accepted by the HTTP server
//   inflight HTTP requests received but not yet answered
//   acceptToRequestMs  p50/p99/max time between accepting a connection and
//            receiving its first request (connection handling delay)
//   reqToResMs p50/p99/max time from 'request' event to response finished,
//            for non-streaming requests
//   listenOverflows/listenDrops  kernel counters (TcpExt) since start: SYNs or
//            completed connections dropped because the accept queue was full
// Interval: PROBE_INTERVAL_MS (default 1000).
const http = require("node:http");
const fs = require("node:fs");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

const INTERVAL = Number(process.env.PROBE_INTERVAL_MS || 1000);
const lag = monitorEventLoopDelay({ resolution: 5 });
lag.enable();
let lastElu = performance.eventLoopUtilization();
let lastCpu = process.cpuUsage();
let lastTime = performance.now();
let sockets = 0,
  inflight = 0;
const acceptToRequest = [],
  reqToRes = [];

const netstat = () => {
  try {
    const lines = fs.readFileSync("/proc/net/netstat", "utf8").split("\n");
    const i = lines.findIndex((l) => l.startsWith("TcpExt:"));
    const keys = lines[i].split(/\s+/),
      vals = lines[i + 1].split(/\s+/);
    const get = (k) => Number(vals[keys.indexOf(k)]);
    return { overflows: get("ListenOverflows"), drops: get("ListenDrops") };
  } catch {
    return { overflows: NaN, drops: NaN };
  }
};
const base = netstat();

const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (name, arg1, arg2) {
  if (name === "connection") {
    sockets++;
    arg1.__acceptedAt = performance.now();
    arg1.once("close", () => sockets--);
  } else if (name === "request") {
    const req = arg1,
      res = arg2,
      start = performance.now(),
      sock = req.socket;
    if (sock.__acceptedAt) {
      acceptToRequest.push(start - sock.__acceptedAt);
      sock.__acceptedAt = 0; // only the first request of a connection
    }
    inflight++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inflight--;
      if (!String(res.getHeader("content-type") || "").includes("event-stream"))
        reqToRes.push(performance.now() - start);
    };
    res.once("finish", finish);
    res.once("close", finish);
  }
  return origEmit.apply(this, arguments);
};

const q = (arr) => {
  if (!arr.length) return null;
  const s = arr.sort((a, b) => a - b);
  const at = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
  return { n: s.length, p50: at(0.5), p99: at(0.99), max: +s[s.length - 1].toFixed(1) };
};
const timer = setInterval(() => {
  const now = performance.now(),
    elu = performance.eventLoopUtilization(lastElu),
    cpu = process.cpuUsage(lastCpu),
    ns = netstat();
  const out = {
    t: Date.now(),
    lag: {
      p50: +(lag.percentile(50) / 1e6).toFixed(1),
      p99: +(lag.percentile(99) / 1e6).toFixed(1),
      max: +(lag.max / 1e6).toFixed(1),
    },
    elu: +elu.utilization.toFixed(3),
    cpu: Math.round(((cpu.user + cpu.system) / 1000 / (now - lastTime)) * 100),
    rssMB: Math.round(process.memoryUsage.rss() / 1048576),
    sockets,
    inflight,
    acceptToRequestMs: q(acceptToRequest.splice(0)),
    reqToResMs: q(reqToRes.splice(0)),
    listenOverflows: ns.overflows - base.overflows,
    listenDrops: ns.drops - base.drops,
  };
  lag.reset();
  lastElu = performance.eventLoopUtilization();
  lastCpu = process.cpuUsage();
  lastTime = now;
  process.stderr.write("PROBE " + JSON.stringify(out) + "\n");
}, INTERVAL);
timer.unref();
