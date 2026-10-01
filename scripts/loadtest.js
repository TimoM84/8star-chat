#!/usr/bin/env node
"use strict";
// 8star Chat load test. No dependencies; works against a local server or the
// public URL (through the reverse proxy).
//
//   node scripts/loadtest.js --url https://chatonline.8star.nl --event testevent \
//        --attendees 5000 --scenario burst --workers 4
//
// Scenarios
//   join    only join + connect, then clean up
//   stream  --senders S attendees each send one message, spread evenly over
//           --duration seconds (normal traffic)
//   burst   every connected attendee sends one message at (nearly) the same
//           moment
//
// The event must exist and should be in "Open" mode, so accepted messages are
// published and can be counted on the live streams.
//
// What is reported (JSON on stdout, human summary on stderr):
//   join            time until all attendees joined and their stream was ready,
//                   per-attendee join latency, failures
//   posts           attempts, HTTP status counts, client time-outs and network
//                   errors, time to response p50/p95/max
//   placed          unique message ids actually published (seen on the live
//                   streams), placed messages whose sender got no success
//                   answer ("placedWithoutSuccess"), duplicates (same sender
//                   text published more than once)
//   verify          (when the server supports it) outcome of a status check
//                   for every request that timed out or failed
//   deliveries      expected vs received SSE deliveries, fan-out latency
//                   p50/p95/max (receive time - server createdAt; needs synced
//                   clocks when the client runs on another host)
//   disconnects     streams that closed without the test asking for it
//   client          per worker CPU and event-loop delay, to detect a client
//                   bottleneck
// At the end every attendee session is ended on the server (session/end).
const { fork } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = {
    url: "http://127.0.0.1:3000",
    event: "testevent",
    attendees: 1000,
    scenario: "burst",
    workers: 2,
    joinConcurrency: 200,
    senders: 50,
    duration: 4.5,
    timeout: 15000,
    settle: 10,
    insecure: false,
    retry: true,
    json: "",
    namePrefix: "Load",
    // browser: every attendee keeps its own keep-alive connection for requests
    //          (like a browser) plus one stream connection.
    // fresh:   every request opens a new connection (what a reverse proxy
    //          without upstream keep-alive does towards the app).
    connections: "browser",
    tlsResume: false,
    sessionMinutes: 30,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === "insecure") o.insecure = true;
    else if (key === "tlsResume") o.tlsResume = true;
    else if (key === "noRetry") o.retry = false;
    else {
      const v = argv[++i];
      o[key] = typeof o[key] === "number" ? Number(v) : v;
    }
  }
  o.url = o.url.replace(/\/+$/, "");
  return o;
}

// ---------------------------------------------------------------------------
// Histogram (1 ms buckets up to 120 s) so workers can be merged exactly
// ---------------------------------------------------------------------------
const HMAX = 120000;
const newHist = () => new Uint32Array(HMAX + 1);
const histAdd = (h, ms) => h[Math.max(0, Math.min(HMAX, Math.round(ms)))]++;
function histMerge(into, from) {
  for (let i = 0; i < from.length; i++) into[i] += from[i];
}
function histStats(h) {
  let n = 0;
  for (let i = 0; i < h.length; i++) n += h[i];
  if (!n) return { n: 0 };
  const at = (p) => {
    const target = Math.ceil(p * n);
    let c = 0;
    for (let i = 0; i < h.length; i++) if ((c += h[i]) >= target) return i;
    return HMAX;
  };
  let max = 0;
  for (let i = h.length - 1; i >= 0; i--)
    if (h[i]) {
      max = i;
      break;
    }
  return { n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max };
}
// Sparse transfer over IPC
const histPack = (h) => {
  const out = [];
  for (let i = 0; i < h.length; i++) if (h[i]) out.push(i, h[i]);
  return out;
};
const histUnpack = (arr) => {
  const h = newHist();
  for (let i = 0; i < arr.length; i += 2) h[arr[i]] += arr[i + 1];
  return h;
};

// ---------------------------------------------------------------------------
// Worker: a share of the attendees
// ---------------------------------------------------------------------------
function runWorker() {
  let cleaning = null;
  let o,
    attendees = [],
    agent,
    freshAgent,
    sseAgent,
    lib,
    origin;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const cpuStart = process.cpuUsage(),
    tStart = performance.now();
  const joinHist = newHist(),
    postHist = newHist(),
    fanHist = newHist();
  const statuses = {},
    seen = new Map(), // message id -> text
    sendResults = new Map(); // sender text -> result
  let disconnects = 0,
    deliveries = 0,
    joinFailures = 0,
    joinErrors = {},
    verify = { checked: 0, accepted: 0, notFound: 0, retried: 0, retryAccepted: 0 };

  function request(method, path, { body, headers = {}, timeout = 0, a = null } = {}) {
    const agentFor = o.connections === "fresh" ? freshAgent : a?.agent || agent;
    return new Promise((resolve) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = lib.request(
        o.url + path,
        {
          method,
          agent: agentFor,
          headers: {
            origin,
            ...(data
              ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
              : {}),
            ...headers,
          },
          rejectUnauthorized: !o.insecure,
        },
        (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {}
            resolve({ status: res.statusCode, data: json, headers: res.headers });
          });
          res.on("error", (e) => resolve({ status: 0, error: e.code || "response-error" }));
        },
      );
      let timer;
      if (timeout)
        timer = setTimeout(() => {
          req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
        }, timeout);
      req.on("error", (e) => resolve({ status: 0, error: e.code || e.message }));
      req.on("close", () => clearTimeout(timer));
      req.setNoDelay?.(true);
      if (data) req.write(data);
      req.end();
    });
  }
  const cookieOf = (res) =>
    (Array.isArray(res.headers?.["set-cookie"]) ? res.headers["set-cookie"] : [])
      .map((c) => c.split(";")[0])
      .filter((c) => !c.endsWith("="))
      .join("; ");

  function openStream(a, ticket) {
    return new Promise((resolve) => {
      const req = lib.get(
        o.url + "/api/events/" + encodeURIComponent(o.event) + "/stream?ticket=" + encodeURIComponent(ticket),
        {
          agent: o.connections === "browser" ? a.agent : sseAgent,
          rejectUnauthorized: !o.insecure,
          headers: { accept: "text/event-stream" },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve({ ok: false, error: "stream-" + res.statusCode });
          }
          a.res = res;
          let buf = "";
          let ready = false;
          res.setEncoding("utf8");
          res.on("data", (d) => {
            buf += d;
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let ev = "",
                data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) ev = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
              }
              if (ev === "ready" && !ready) {
                ready = true;
                resolve({ ok: true });
              } else if (ev === "public" || ev === "public-batch") {
                const now = Date.now();
                const list = ev === "public" ? [JSON.parse(data)] : JSON.parse(data);
                for (const m of list) {
                  if (!a.connectedForCount || !m.text.startsWith(a.countPrefix)) continue;
                  deliveries++;
                  histAdd(fanHist, now - Date.parse(m.createdAt));
                  if (!seen.has(m.id)) seen.set(m.id, m.text);
                }
              }
            }
          });
          const lost = () => {
            if (!a.closing && a.res === res) {
              disconnects++;
              a.res = null;
            }
            if (!ready) resolve({ ok: false, error: "stream-closed" });
          };
          res.on("close", lost);
          res.on("error", lost);
        },
      );
      a.sseReq = req;
      req.on("error", (e) => resolve({ ok: false, error: e.code || "stream-error" }));
    });
  }

  async function join(a) {
    const t0 = performance.now();
    const j = await request("POST", "/api/events/" + encodeURIComponent(o.event) + "/join", {
      // Short-lived sessions: if the test is killed, they expire by themselves.
      body: { name: o.namePrefix + " " + a.index, sessionMinutes: o.sessionMinutes },
      timeout: 30000,
      a,
    });
    if (j.status !== 200) return { ok: false, error: "join-" + (j.status || j.error) };
    a.cookie = cookieOf(j);
    a.csrf = j.data.csrf;
    let ticket = j.data.ticket; // newer servers return the first ticket with the join
    if (!ticket) {
      const t = await request("POST", "/api/events/" + encodeURIComponent(o.event) + "/stream-ticket", {
        body: { scope: "public" },
        headers: { cookie: a.cookie, "x-csrf-token": a.csrf },
        timeout: 30000,
        a,
      });
      if (t.status !== 200) return { ok: false, error: "ticket-" + (t.status || t.error) };
      ticket = t.data.ticket;
    }
    const s = await openStream(a, ticket);
    if (!s.ok) return s;
    histAdd(joinHist, performance.now() - t0);
    return { ok: true };
  }

  async function pool(items, limit, fn) {
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) await fn(items[i++]);
      }),
    );
  }

  async function post(a, text) {
    const clientMessageId = crypto.randomUUID();
    const path = "/api/events/" + encodeURIComponent(o.event) + "/messages";
    const headers = { cookie: a.cookie, "x-csrf-token": a.csrf };
    const body = { text, kind: "public", clientMessageId };
    const t0 = performance.now();
    const r = await request("POST", path, { body, headers, timeout: o.timeout, a });
    const ms = performance.now() - t0;
    histAdd(postHist, ms);
    const key = r.status ? String(r.status) : r.error === "TIMEOUT" ? "timeout" : "error:" + r.error;
    statuses[key] = (statuses[key] || 0) + 1;
    const result = { status: r.status, key, clientMessageId, accepted: r.status === 201 || r.status === 200 };
    // Unknown outcome (time-out, network error, 5xx): behave like the browser
    // client — ask the server what happened, retry with the same
    // clientMessageId, up to 4 attempts with back-off.
    if (o.retry && (!r.status || r.status >= 500)) {
      verify.checked++;
      for (let attempt = 0; attempt < 4 && !result.accepted && !result.refused; attempt++) {
        if (r.status === 503 || (attempt > 0 && result.lastStatus === 503)) {
          // Refused before storing: safe to send again after the advised wait.
          await new Promise((res) => setTimeout(res, 2000));
        } else {
          const st = await request(
            "GET",
            path + "/status?clientMessageId=" + encodeURIComponent(clientMessageId),
            {
              headers,
              timeout: o.timeout,
              a,
            },
          );
          if (st.status === 200 && st.data?.status === "accepted") {
            verify.accepted++;
            result.accepted = true;
            result.resolved = "status";
            break;
          }
          if (st.status === 404) verify.notFound++;
          else verify.statusUnclear = (verify.statusUnclear || 0) + 1;
          await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
        }
        verify.retried++;
        const again = await request("POST", path, { body, headers, timeout: o.timeout, a });
        result.lastStatus = again.status;
        if (again.status === 200 || again.status === 201) {
          verify.retryAccepted++;
          result.accepted = true;
          result.resolved = "retry";
        } else if (again.status === 429) {
          // A definite refusal: the sender knows the message was not placed.
          result.refused = true;
          verify.retryRefused = (verify.retryRefused || 0) + 1;
        }
      }
      if (!result.accepted && !result.refused) verify.unresolved = (verify.unresolved || 0) + 1;
    } else if (r.status === 429) result.refused = true;
    sendResults.set(text, result);
  }

  process.on("message", async (msg) => {
    if (msg.cmd === "init") {
      o = msg.o;
      lib = o.url.startsWith("https:") ? https : http;
      origin = new URL(o.url).origin;
      agent = new lib.Agent({ keepAlive: true, maxSockets: Math.max(16, msg.joinConcurrency) });
      freshAgent = new lib.Agent({ keepAlive: false, maxSockets: Infinity });
      sseAgent = new lib.Agent({ keepAlive: false, maxSockets: Infinity, maxCachedSessions: 0 });
      attendees = msg.indexes.map((index) => ({
        index,
        // Like a browser over HTTP/1.1: one connection for requests, one for the
        // stream; the second TLS connection resumes the session of the first.
        agent:
          o.connections === "browser"
            ? new lib.Agent({ keepAlive: true, maxSockets: 2, maxCachedSessions: o.tlsResume ? 1 : 0 })
            : null,
      }));
      process.send({ cmd: "ok" });
    } else if (msg.cmd === "join") {
      await pool(attendees, msg.joinConcurrency, async (a) => {
        const r = await join(a);
        a.joined = r.ok;
        if (!r.ok) {
          joinFailures++;
          joinErrors[r.error] = (joinErrors[r.error] || 0) + 1;
        }
      });
      process.send({ cmd: "joined", joined: attendees.filter((a) => a.joined).length });
    } else if (msg.cmd === "arm") {
      for (const a of attendees) {
        a.connectedForCount = Boolean(a.joined && a.res);
        a.countPrefix = msg.prefix;
      }
      process.send({ cmd: "armed", connected: attendees.filter((a) => a.connectedForCount).length });
    } else if (msg.cmd === "burst") {
      const wait = Math.max(0, msg.at - Date.now());
      setTimeout(async () => {
        await Promise.all(
          attendees.filter((a) => a.joined).map((a) => post(a, "burst " + msg.run + " " + a.index)),
        );
        process.send({ cmd: "posted" });
      }, wait);
    } else if (msg.cmd === "stream") {
      await Promise.all(
        msg.plan.map(({ index, at }) =>
          new Promise((r) => setTimeout(r, Math.max(0, at - Date.now()))).then(() => {
            const a = attendees.find((x) => x.index === index);
            return a?.joined ? post(a, "stream " + msg.run + " " + a.index) : null;
          }),
        ),
      );
      process.send({ cmd: "posted" });
    } else if (msg.cmd === "report") {
      const cpu = process.cpuUsage(cpuStart);
      process.send({
        cmd: "report",
        joinHist: histPack(joinHist),
        postHist: histPack(postHist),
        fanHist: histPack(fanHist),
        statuses,
        seen: [...seen.entries()],
        sendResults: [...sendResults.entries()],
        disconnects,
        deliveries,
        joinFailures,
        joinErrors,
        verify,
        connected: attendees.filter((a) => a.connectedForCount && a.res).length,
        client: {
          cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / (performance.now() - tStart)) * 100),
          cpuSeconds: +((cpu.user + cpu.system) / 1e6).toFixed(1),
          lagP99Ms: +(lag.percentile(99) / 1e6).toFixed(1),
          lagMaxMs: +(lag.max / 1e6).toFixed(1),
        },
      });
    } else if (msg.cmd === "cleanup") {
      if (!cleaning) cleaning = cleanup();
      process.send({ cmd: "cleaned", ...(await cleaning) });
    }
  });
  // If the coordinator dies (test aborted), still end the sessions.
  process.on("disconnect", () => {
    if (!cleaning) cleaning = cleanup();
    cleaning.finally(() => process.exit(0));
  });
  async function cleanup() {
    {
      for (const a of attendees) {
        a.closing = true;
        a.sseReq?.destroy();
      }
      let ended = 0,
        failed = 0;
      await pool(
        attendees.filter((a) => a.cookie),
        50,
        async (a) => {
          const r = await request("POST", "/api/events/" + encodeURIComponent(o.event) + "/session/end", {
            body: {},
            headers: { cookie: a.cookie, "x-csrf-token": a.csrf },
            timeout: 30000,
            a,
          });
          if (r.status === 200) ended++;
          else failed++;
        },
      );
      agent.destroy();
      freshAgent.destroy();
      sseAgent.destroy();
      for (const a of attendees) a.agent?.destroy();
      return { ended, failed };
    }
  }
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------
async function runCoordinator() {
  const o = parseArgs(process.argv);
  const log = (...a) => console.error("[loadtest]", ...a);
  const run = crypto.randomBytes(3).toString("hex");
  // Check the event first.
  const lib = o.url.startsWith("https:") ? https : http;
  const info = await new Promise((resolve) => {
    lib
      .get(
        o.url + "/api/events/" + encodeURIComponent(o.event),
        { rejectUnauthorized: !o.insecure },
        (res) => {
          let t = "";
          res.on("data", (d) => (t += d));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, ...JSON.parse(t) });
            } catch {
              resolve({ status: res.statusCode });
            }
          });
        },
      )
      .on("error", (e) => resolve({ status: 0, error: e.message }));
  });
  if (info.status !== 200) {
    log("Event not reachable:", info.status, info.error || info.error);
    process.exit(2);
  }
  if (o.scenario !== "join" && info.event.mode !== "open")
    log(
      "WARNING: event mode is '" + info.event.mode + "'; published messages are only counted in Open mode.",
    );
  log(
    `run ${run}: ${o.attendees} attendees, scenario ${o.scenario}, ${o.workers} workers, ${o.connections} connections, url ${o.url}, event ${o.event} (mode ${info.event.mode}, capacity ${info.event.capacity})`,
  );

  const workers = [];
  const waitAll = (cmd) => Promise.all(workers.map((w) => new Promise((r) => w.waiters.set(cmd, r))));
  for (let w = 0; w < o.workers; w++) {
    const child = fork(__filename, ["--worker"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const wk = { child, waiters: new Map() };
    child.on("message", (m) => {
      const fn = wk.waiters.get(m.cmd);
      if (fn) {
        wk.waiters.delete(m.cmd);
        fn(m);
      }
    });
    workers.push(wk);
  }
  let aborting = false;
  const abort = async (signal) => {
    if (aborting) return;
    aborting = true;
    log("received " + signal + ": ending all test sessions before exit…");
    workers.forEach((w) => w.child.connected && w.child.send({ cmd: "cleanup" }));
    const done = await Promise.race([
      Promise.all(workers.map((w) => new Promise((r) => w.waiters.set("cleaned", r)))),
      new Promise((r) => setTimeout(() => r(null), 120000)),
    ]);
    if (done) log("ended sessions: " + done.reduce((s, c) => s + c.ended, 0));
    process.exit(130);
  };
  process.on("SIGINT", () => abort("SIGINT"));
  process.on("SIGTERM", () => abort("SIGTERM"));
  const indexes = Array.from({ length: o.attendees }, (_, i) => i);
  const perWorkerConcurrency = Math.max(1, Math.round(o.joinConcurrency / o.workers));
  workers.forEach((w, k) =>
    w.child.send({
      cmd: "init",
      o,
      indexes: indexes.filter((i) => i % o.workers === k),
      joinConcurrency: perWorkerConcurrency,
    }),
  );
  await waitAll("ok");

  // Join
  const tJoin = performance.now();
  workers.forEach((w) => w.child.send({ cmd: "join", joinConcurrency: perWorkerConcurrency }));
  const joinedRes = await waitAll("joined");
  const joinSeconds = (performance.now() - tJoin) / 1000;
  const joined = joinedRes.reduce((s, r) => s + r.joined, 0);
  log(`joined ${joined}/${o.attendees} in ${joinSeconds.toFixed(1)} s`);
  const prefix = (o.scenario === "burst" ? "burst " : "stream ") + run + " ";
  workers.forEach((w) => w.child.send({ cmd: "arm", prefix }));
  const armed = (await waitAll("armed")).reduce((s, r) => s + r.connected, 0);

  // Messages
  let postSeconds = 0;
  if (o.scenario === "burst" || o.scenario === "stream") {
    const at = Date.now() + 1000;
    const t0 = performance.now();
    if (o.scenario === "burst") workers.forEach((w) => w.child.send({ cmd: "burst", at, run }));
    else {
      const senders = Math.min(o.senders, o.attendees);
      const plan = Array.from({ length: senders }, (_, i) => ({
        index: Math.floor((i * o.attendees) / senders),
        at: at + Math.round((i * o.duration * 1000) / senders),
      }));
      workers.forEach((w, k) =>
        w.child.send({ cmd: "stream", run, plan: plan.filter((p) => p.index % o.workers === k) }),
      );
    }
    await waitAll("posted");
    postSeconds = (performance.now() - t0) / 1000 - 1;
    log(`all requests answered or timed out after ${postSeconds.toFixed(1)} s; settling ${o.settle} s`);
    await new Promise((r) => setTimeout(r, o.settle * 1000));
  }

  workers.forEach((w) => w.child.send({ cmd: "report" }));
  const reports = await waitAll("report");
  workers.forEach((w) => w.child.send({ cmd: "cleanup" }));
  const cleaned = await waitAll("cleaned");
  workers.forEach((w) => w.child.disconnect());

  // Aggregate
  const joinHist = newHist(),
    postHist = newHist(),
    fanHist = newHist();
  const statuses = {},
    joinErrors = {},
    seen = new Map(),
    sendResults = new Map(),
    verify = {};
  let disconnects = 0,
    deliveries = 0,
    stillConnected = 0;
  for (const r of reports) {
    histMerge(joinHist, histUnpack(r.joinHist));
    histMerge(postHist, histUnpack(r.postHist));
    histMerge(fanHist, histUnpack(r.fanHist));
    for (const [k, v] of Object.entries(r.statuses)) statuses[k] = (statuses[k] || 0) + v;
    for (const [k, v] of Object.entries(r.joinErrors)) joinErrors[k] = (joinErrors[k] || 0) + v;
    for (const [k, v] of Object.entries(r.verify)) verify[k] = (verify[k] || 0) + v;
    for (const [id, text] of r.seen) seen.set(id, text);
    for (const [t, res] of r.sendResults) sendResults.set(t, res);
    disconnects += r.disconnects;
    deliveries += r.deliveries;
    stillConnected += r.connected;
  }
  const ours = [...seen.entries()].filter(([, text]) => text.startsWith(prefix));
  const byText = new Map();
  for (const [id, text] of ours) byText.set(text, (byText.get(text) || 0) + 1);
  const duplicates = [...byText.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  let placedWithoutSuccess = 0,
    placedButFirstAnswerFailed = 0,
    acceptedNotPlaced = 0;
  for (const [text] of byText) {
    const r = sendResults.get(text);
    if (!r) continue;
    const firstOk = r.status === 200 || r.status === 201;
    if (!firstOk) placedButFirstAnswerFailed++;
    if (!r.accepted) placedWithoutSuccess++;
  }
  for (const [text, r] of sendResults) if (r.accepted && !byText.has(text)) acceptedNotPlaced++;
  const ourIds = ours.length;
  const report = {
    run,
    url: o.url,
    event: o.event,
    scenario: o.scenario,
    connections: o.connections,
    attendees: o.attendees,
    workers: o.workers,
    join: {
      seconds: +joinSeconds.toFixed(2),
      joined,
      failures: o.attendees - joined,
      errors: joinErrors,
      latencyMs: histStats(joinHist),
    },
    posts:
      o.scenario === "join"
        ? undefined
        : {
            attempts: sendResults.size,
            statuses,
            secondsUntilAllAnswered: +postSeconds.toFixed(2),
            responseMs: histStats(postHist),
          },
    placed:
      o.scenario === "join"
        ? undefined
        : {
            uniqueMessageIds: ourIds,
            acceptedBySender: [...sendResults.values()].filter((r) => r.accepted).length,
            firstAnswerDefinite: [...sendResults.values()].filter((r) =>
              [200, 201, 429, 503].includes(r.status),
            ).length,
            finalOutcomeUnknown: [...sendResults.values()].filter(
              (r) => !r.accepted && !r.refused && r.status !== 503 && r.status !== 429,
            ).length,
            rejected429: statuses["429"] || 0,
            placedButFirstAnswerFailed,
            placedWithoutSuccess,
            acceptedButNotSeen: acceptedNotPlaced,
            duplicates,
          },
    verify: o.scenario === "join" ? undefined : verify,
    deliveries:
      o.scenario === "join"
        ? undefined
        : {
            connectedAtStart: armed,
            expected: ourIds * armed,
            received: deliveries,
            missing: ourIds * armed - deliveries,
            fanoutMs: histStats(fanHist),
          },
    disconnects,
    stillConnectedAtEnd: stillConnected,
    cleanup: {
      ended: cleaned.reduce((s, c) => s + c.ended, 0),
      failed: cleaned.reduce((s, c) => s + c.failed, 0),
    },
    client: reports.map((r) => r.client),
  };
  if (o.json) require("node:fs").writeFileSync(o.json, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv.includes("--worker")) runWorker();
else
  runCoordinator().catch((e) => {
    console.error(e);
    process.exit(1);
  });
