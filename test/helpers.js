"use strict";
// Test helpers: start the real server in a child process with its own data
// directory, and talk to it like a browser (cookie jar, Origin header, SSE).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin-password-for-tests";

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

async function startServer({ env = {}, dataDir } = {}) {
  const port = await freePort();
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "8star-test-"));
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      TRUST_PROXY: "false",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = "http://127.0.0.1:" + port;
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(base + "/health");
      if (r.ok) break;
    } catch {}
    if (child.exitCode !== null) throw Error("Server exited: " + output);
    if (Date.now() - started > 8000) throw Error("Server did not start: " + output);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    base,
    port,
    dataDir: dir,
    output: () => output,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await exited;
    },
  };
}

// A minimal browser: one cookie jar (honouring cookie paths), same-origin
// Origin header and the CSRF header once known.
class Browser {
  constructor(server) {
    this.server = server;
    this.cookies = new Map(); // "name|path" -> { name, value, path }
    this.csrf = "";
    this.extraHeaders = {};
  }
  cookieHeader(urlPath) {
    return [...this.cookies.values()]
      .filter(
        (c) =>
          urlPath === c.path ||
          urlPath.startsWith(c.path.endsWith("/") ? c.path : c.path + "/") ||
          c.path === "/",
      )
      .map((c) => c.name + "=" + c.value)
      .join("; ");
  }
  storeCookies(res) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = line.split(";").map((x) => x.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq),
        value = pair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const cookiePath = pathAttr ? pathAttr.slice(5) : "/";
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      const key = name + "|" + cookiePath;
      if (!value || (maxAge && Number(maxAge.slice(8)) <= 0)) this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path: cookiePath, raw: line });
    }
  }
  async request(method, urlPath, { body, headers = {}, origin = this.server.base, csrf = true } = {}) {
    const h = { ...this.extraHeaders, ...headers };
    const cookieHeader = this.cookieHeader(urlPath.split("?")[0]);
    if (cookieHeader) h.cookie = cookieHeader;
    if (origin) h.origin = origin;
    if (csrf && this.csrf) h["x-csrf-token"] = this.csrf;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(this.server.base + urlPath, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    this.storeCookies(res);
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, headers: res.headers, text };
  }
  get(p, o) {
    return this.request("GET", p, o);
  }
  post(p, body = {}, o = {}) {
    return this.request("POST", p, { ...o, body });
  }
  patch(p, body = {}, o = {}) {
    return this.request("PATCH", p, { ...o, body });
  }
  del(p, body, o = {}) {
    return this.request("DELETE", p, { ...o, body });
  }
  // Open an SSE stream and collect raw text for `ms` milliseconds.
  stream(urlPath, { ms = 600, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...headers };
      const cookieHeader = this.cookieHeader(urlPath.split("?")[0]);
      if (cookieHeader) h.cookie = cookieHeader;
      const req = http.get(this.server.base + urlPath, { headers: h }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        const done = () => resolve({ status: res.statusCode, text, events: parseEvents(text) });
        const timer = setTimeout(() => {
          req.destroy();
          done();
        }, ms);
        res.on("end", () => {
          clearTimeout(timer);
          done();
        });
      });
      req.on("error", (err) => (err.code === "ECONNRESET" ? null : reject(err)));
    });
  }
}

function parseEvents(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
      const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
      if (!event) return null;
      let parsed = data;
      try {
        parsed = JSON.parse(data);
      } catch {}
      return { event, data: parsed };
    })
    .filter(Boolean);
}

async function adminBrowser(server) {
  const b = new Browser(server);
  const r = await b.post("/api/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw Error("Admin login failed: " + JSON.stringify(r.data));
  b.csrf = r.data.csrf;
  return b;
}

async function createEvent(admin, fields = {}) {
  const r = await admin.post("/api/events", {
    title: "Test event",
    mode: "moderated",
    capacity: 100,
    ...fields,
  });
  if (r.status !== 201) throw Error("Create event failed: " + JSON.stringify(r.data));
  return r.data.event;
}

// Join the public chat as an attendee in this browser.
async function join(browser, slug, name) {
  const r = await browser.post("/api/events/" + slug + "/join", { name });
  if (r.status !== 200) throw Error("Join failed: " + JSON.stringify(r.data));
  browser.csrf = r.data.csrf;
  return r.data;
}

async function ticket(browser, slug, scope = "public", headers = {}) {
  const r = await browser.post("/api/events/" + slug + "/stream-ticket", { scope }, { headers });
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  startServer,
  Browser,
  adminBrowser,
  createEvent,
  join,
  ticket,
  sleep,
  parseEvents,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ROOT,
};
