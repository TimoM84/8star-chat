"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  net = require("node:net"),
  zlib = require("node:zlib"),
  { monitorEventLoopDelay, performance } = require("node:perf_hooks"),
  QRCode = require("qrcode");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const envNumber = (name, fallback, min = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};
const PORT = Number(process.env.PORT || 3000),
  DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data"),
  DATA_FILE = path.join(DATA_DIR, "state.json"),
  GUEST_FILE = path.join(DATA_DIR, "guest-sessions.json"),
  PUBLIC_DIR = path.join(__dirname, "public");
const MAX_MESSAGE = envNumber("MAX_MESSAGE_LENGTH", 500, 1),
  DEFAULT_MAX = envNumber("DEFAULT_MAX_USERS", 10000, 1),
  ROOM_RATE = envNumber("ROOM_PUBLISH_PER_SECOND", 5, 1),
  TRUST_PROXY = String(process.env.TRUST_PROXY || "false").toLowerCase() === "true",
  COOKIE_SECURE = String(process.env.COOKIE_SECURE || "auto").toLowerCase(),
  ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
    .split(/[\s,]+/)
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  STAFF_SESSION_MS = 12 * 3600000,
  GUEST_SESSION_MS = envNumber("GUEST_SESSION_HOURS", 24, 1) * 3600000,
  PRIVATE_IDLE_MS = envNumber("PRIVATE_UNLOCK_IDLE_SECONDS", 15 * 60, 1) * 1000,
  PRIVATE_MAX_MS = 4 * 3600000,
  PIN_MIN = 6,
  PIN_MAX = 64,
  PIN_ATTEMPTS_BEFORE_LOCK = 5,
  PIN_LOCK_MS = envNumber("PIN_LOCK_SECONDS", 15 * 60, 1) * 1000,
  PIN_MAX_FAILURES = 20,
  TICKET_MS = 30000,
  HEARTBEAT_MS = envNumber("HEARTBEAT_SECONDS", 20, 1) * 1000,
  SWEEP_MS = 60000,
  SSE_MAX_BUFFER = envNumber("SSE_MAX_BUFFER_KB", 256, 16) * 1024,
  // Live updates for attendees are sent in batches: at most one write per
  // connection per FANOUT_INTERVAL_MS, spread over slices of FANOUT_SLICE
  // connections so other requests are served in between.
  FANOUT_INTERVAL_MS = envNumber("FANOUT_INTERVAL_MS", 100, 0),
  FANOUT_SLICE = envNumber("FANOUT_SLICE", 500, 10),
  // New messages are refused with 503 (instead of queueing) when the event loop
  // has been stalled this long or too many messages wait for storage.
  OVERLOAD_LAG_MS = envNumber("OVERLOAD_LAG_MS", 1000, 50),
  MAX_PENDING_MESSAGES = envNumber("MAX_PENDING_MESSAGES", 1000, 1),
  MAX_PENDING_EVENTS = envNumber("MAX_PENDING_EVENTS", 5000, 10),
  LISTEN_BACKLOG = envNumber("LISTEN_BACKLOG", 4096, 128),
  METRICS_LOG_SECONDS = envNumber("METRICS_LOG_SECONDS", 0, 0),
  IDEMPOTENCY_MS = 24 * 3600000,
  MAX_GUEST_SESSIONS = envNumber("MAX_GUEST_SESSIONS", 200000, 1),
  LOGIN_MAX_FAILURES = 10,
  LOGIN_WINDOW_MS = 15 * 60000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const GUEST_COOKIE = "g8s",
  STAFF_COOKIE = "sid";

// ---------------------------------------------------------------------------
// Metrics (no message content, names, cookies or tokens are recorded)
// ---------------------------------------------------------------------------
class Stat {
  constructor() {
    this.reset();
  }
  reset() {
    this.n = 0;
    this.max = 0;
    this.samples = [];
  }
  add(v) {
    this.n++;
    if (v > this.max) this.max = v;
    // Reservoir sample keeps memory bounded.
    if (this.samples.length < 1000) this.samples.push(v);
    else {
      const i = Math.floor(Math.random() * this.n);
      if (i < 1000) this.samples[i] = v;
    }
  }
  summary() {
    if (!this.n) return { n: 0 };
    const s = [...this.samples].sort((a, b) => a - b),
      at = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { n: this.n, p50: at(0.5), p95: at(0.95), max: +this.max.toFixed(1) };
  }
}
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
const metrics = {
  counters: {},
  inc(name, n = 1) {
    this.counters[name] = (this.counters[name] || 0) + n;
  },
  post: { admission: new Stat(), commit: new Stat(), total: new Stat() },
  join: new Stat(),
  fanout: { flush: new Stat(), events: 0, writes: 0, slowDrops: 0, maxQueued: 0, maxBufferedKB: 0 },
  journal: {
    write: new Stat(),
    size: new Stat(),
    errors: 0,
    add(ms, n) {
      this.write.add(ms);
      this.size.add(n);
    },
  },
  snapshots: 0,
};
// Detects a stalled event loop while it is still busy: a request handled long
// after the last timer tick means the server is behind.
let lastTickAt = performance.now();
setInterval(() => (lastTickAt = performance.now()), 50).unref();
const currentLagMs = () => Math.max(0, performance.now() - lastTickAt - 50);

const id = () => crypto.randomBytes(12).toString("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// ---------------------------------------------------------------------------
// Persistent data
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
let state = readJson(DATA_FILE, { events: [], users: [], messages: [], bans: [] });
state.events ||= [];
state.users ||= [];
state.messages ||= [];
state.bans ||= [];
const readKeyFile = (file, legacy = "") => {
  const stored = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  const key = stored || legacy || crypto.randomBytes(32).toString("hex");
  if (!stored) fs.writeFileSync(file, key, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return key;
};
const legacyIpBlockKey = state.ipBlockKey,
  ipBlockKey = readKeyFile(path.join(DATA_DIR, "ip-block-key"), legacyIpBlockKey),
  sessionKey = readKeyFile(path.join(DATA_DIR, "session-key"));
if (state.ipBlockKey) delete state.ipBlockKey;

// Debounced, non-overlapping JSON writer. Batches bursts of changes into one
// write instead of serialising the full state on every mutation.
// hooks.before() runs before the data is serialised and may wait (async);
// whatever it returns is passed to hooks.after() once the file is in place.
function createStore(file, getData, delay, maxDelay, mode, hooks = {}) {
  let timer = null,
    firstDirtyAt = 0,
    writing = false,
    dirty = false,
    closed = false;
  const writeNow = async () => {
    timer = null;
    firstDirtyAt = 0;
    if (writing) {
      dirty = true;
      return;
    }
    writing = true;
    dirty = false;
    const tmp = file + ".tmp";
    try {
      const token = hooks.before ? await hooks.before() : undefined;
      if (closed) return;
      // Serialisation is synchronous: nothing can change between before() and here.
      const text = JSON.stringify(getData());
      metrics.snapshots++;
      await fs.promises.writeFile(tmp, text, mode ? { mode } : undefined);
      // A synchronous shutdown flush may have written newer data meanwhile.
      if (closed) await fs.promises.rm(tmp, { force: true });
      else {
        await fs.promises.rename(tmp, file);
        if (hooks.after) await hooks.after(token);
      }
    } catch (err) {
      console.error("Could not save " + path.basename(file) + ":", err.message);
      dirty = true;
    } finally {
      writing = false;
      if (dirty && !closed) schedule();
    }
  };
  function schedule() {
    if (closed) return;
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeNow, Math.max(0, Math.min(delay, firstDirtyAt + maxDelay - now)));
  }
  const flushSync = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    const token = hooks.beforeSync ? hooks.beforeSync() : undefined;
    const tmp = file + ".sync.tmp";
    fs.writeFileSync(tmp, JSON.stringify(getData()), mode ? { mode } : undefined);
    fs.renameSync(tmp, file);
    if (hooks.afterSync) hooks.afterSync(token);
    dirty = false;
  };
  return { schedule, flushSync };
}

// ---------------------------------------------------------------------------
// Message journal (group commit)
// ---------------------------------------------------------------------------
// Attendee messages are appended to a journal file before they are confirmed
// (HTTP 201) or shown to anyone. All messages that arrive while one write is
// in progress are written together in the next write ("group commit"), so a
// burst costs a handful of disk writes instead of one per message.
// The full state snapshot (state.json) is still written in the background; each
// snapshot rotates the journal, and journal files that the snapshot covers are
// removed afterwards. On start-up, journal files are replayed into the state.
const JOURNAL_FSYNC = String(process.env.JOURNAL_FSYNC || "true").toLowerCase() !== "false";
const journal = (() => {
  const prefix = "messages-",
    suffix = ".journal";
  const files = () =>
    fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .map((f) => ({ f, n: Number(f.slice(prefix.length, -suffix.length)) }))
      .filter((x) => Number.isInteger(x.n))
      .sort((a, b) => a.n - b.n);
  let current = (files().at(-1)?.n || 0) + 1,
    handle = null,
    handleN = 0,
    queue = [],
    writing = null; // promise of the write in progress
  const fileName = (n) => path.join(DATA_DIR, prefix + n + suffix);
  async function writeBatch() {
    const batch = queue;
    queue = [];
    const t0 = performance.now();
    try {
      if (!handle || handleN !== current) {
        if (handle) await handle.close().catch(() => {});
        handleN = current;
        handle = await fs.promises.open(fileName(current), "a", 0o600);
      }
      await handle.write(batch.map((x) => JSON.stringify(x.m) + "\n").join(""));
      if (JOURNAL_FSYNC) await handle.datasync();
      metrics.journal.add(performance.now() - t0, batch.length);
      for (const x of batch) x.resolve();
    } catch (err) {
      console.error("Could not write message journal:", err.message);
      metrics.journal.errors++;
      for (const x of batch) x.reject(err);
      if (handle) await handle.close().catch(() => {});
      handle = null;
    }
  }
  function pump() {
    if (writing || !queue.length) return;
    writing = writeBatch().finally(() => {
      writing = null;
      pump();
    });
  }
  return {
    get pending() {
      return queue.length + (writing ? 1 : 0);
    },
    append(m) {
      return new Promise((resolve, reject) => {
        queue.push({ m, resolve, reject });
        if (!writing) setImmediate(pump); // collect everything from this loop turn
      });
    },
    // Wait until no write is in progress or queued.
    async idle() {
      while (writing || queue.length) {
        pump();
        await writing;
      }
    },
    // Start a new journal file; return the files that the next snapshot covers.
    rotate() {
      const covered = files().map((x) => x.f);
      current++;
      return covered;
    },
    remove(list) {
      for (const f of list || []) fs.rmSync(path.join(DATA_DIR, f), { force: true });
    },
    // Messages from journal files that are not in the snapshot yet.
    replay(known) {
      const out = [];
      for (const { f } of files())
        for (const line of fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const m = JSON.parse(line);
            if (m?.id && !known.has(m.id)) {
              known.add(m.id);
              out.push(m);
            }
          } catch {
            // A torn last line from a crash: the message was never confirmed.
          }
        }
      return out;
    },
    closeSync() {
      if (handle) handle.close().catch(() => {});
    },
  };
})();
const stateStore = createStore(DATA_FILE, () => state, 500, 2000, 0o600, {
  before: async () => {
    await journal.idle();
    return journal.rotate();
  },
  after: (covered) => journal.remove(covered),
  // On shutdown the journal is kept: a write may still be completing. Replay
  // at the next start skips messages that are already in the snapshot.
});
const save = () => stateStore.schedule();

let migrated = Boolean(legacyIpBlockKey);
for (const e of state.events) {
  e.blockedWords ||= [];
  e.moderatorTopics ||= {};
  e.privateThreads ||= {};
  e.pinnedMessages ||= [];
  if (e.privateMessagesEnabled === undefined) e.privateMessagesEnabled = true;
  if (!e.stageCurrentId) e.stageCurrentId = "";
}
for (const m of state.messages) {
  if (m.status === "stage" && !m.stageState) {
    m.stageState = "queued";
    m.stageQueuedAt = m.createdAt || new Date().toISOString();
    if (m.type === "question") {
      m.status = "pending";
      m.visibility = "private";
    }
    migrated = true;
  }
}
if (migrated) save();

// In-memory indexes so hot paths do not scan every message of every event.
const messagesBySlug = new Map(),
  messagesById = new Map();
const indexMessage = (m) => {
  if (!messagesBySlug.has(m.slug)) messagesBySlug.set(m.slug, []);
  messagesBySlug.get(m.slug).push(m);
  messagesById.set(m.id, m);
};
{
  // Replay confirmed messages that were journaled after the last snapshot.
  const replayed = journal.replay(new Set(state.messages.map((m) => m.id)));
  if (replayed.length) {
    state.messages.push(...replayed);
    console.log("Recovered " + replayed.length + " message(s) from the journal.");
    save();
  }
}
state.messages.forEach(indexMessage);
// clientMessageId -> message, per attendee session (key = sha256(session:id)).
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const idempotency = new Map();
for (const m of state.messages)
  if (m.clientKey)
    idempotency.set(m.clientKey, {
      messageId: m.id,
      textHash: sha256((m.type === "private" ? "private" : "public") + ":" + m.text),
      at: Date.parse(m.createdAt) || Date.now(),
      pending: null,
    });
const eventMessages = (slug) => messagesBySlug.get(slug) || [];
const findMessage = (messageId, slug) => {
  const m = messagesById.get(String(messageId || ""));
  return m && m.slug === slug ? m : undefined;
};
function addMessage(m) {
  state.messages.push(m);
  indexMessage(m);
  save();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const secretEqual = (a, b) => {
  const x = Buffer.from(String(a || "")),
    y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const color = (s, f) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || "")) ? String(s) : f);
const logoUrl = (s) => {
  try {
    const u = new URL(String(s || ""));
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
};
const slugify = (s) =>
  String(s || "event")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";
const scryptAsync = (secret, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(String(secret), salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString("hex")))),
  );
const hash = (p, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  hash: crypto.scryptSync(p, salt, 64).toString("hex"),
});
const hashAsync = async (p, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  hash: await scryptAsync(p, salt),
});
const verifyHash = async (secret, record) => {
  if (!record?.salt || !record?.hash) return false;
  const candidate = Buffer.from(await scryptAsync(secret, record.salt), "hex"),
    expected = Buffer.from(record.hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
};
const safeUser = (u) => ({ id: u.id, email: u.email, role: u.role, active: u.active !== false });
if (!state.users.some((u) => u.role === "owner")) {
  const email = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw Error("Set ADMIN_PASSWORD to a unique password of at least 12 characters.");
  state.users.push({ id: id(), email, role: "owner", active: true, ...hash(password) });
  save();
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
function cookie(req, name) {
  const s = req.headers.cookie || "",
    p = s
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="));
  try {
    return p ? decodeURIComponent(p.slice(name.length + 1)) : "";
  } catch {
    return "";
  }
}
const isMutating = (req) => !["GET", "HEAD"].includes(req.method);
const requestIsSecure = (req) =>
  COOKIE_SECURE === "true" ||
  (COOKIE_SECURE !== "false" &&
    (Boolean(req.socket?.encrypted) ||
      (TRUST_PROXY &&
        String(req.headers["x-forwarded-proto"] || "")
          .split(",")[0]
          .trim() === "https")));
// Staff pages are top-level pages on the chat domain: SameSite=Strict.
const staffCookie = (req, value, maxAge) =>
  STAFF_COOKIE +
  "=" +
  value +
  "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
  maxAge +
  (requestIsSecure(req) ? "; Secure" : "");
// The attendee chat usually runs in an iframe on the livestream site, so the
// cookie must be allowed in a third-party context. Over HTTPS it is
// SameSite=None + Secure + Partitioned (CHIPS); it is scoped to the event API
// path only. Over plain HTTP (local testing) browsers reject SameSite=None,
// so Lax is used there.
const guestCookie = (req, slug, value, maxAge) =>
  GUEST_COOKIE +
  "=" +
  value +
  "; HttpOnly; Path=/api/events/" +
  encodeURIComponent(slug) +
  "; Max-Age=" +
  maxAge +
  (requestIsSecure(req) ? "; SameSite=None; Secure; Partitioned" : "; SameSite=Lax");
function normalizeIp(input) {
  let ip = String(input || "")
    .trim()
    .toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  ip = ip.split("%")[0];
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (net.isIP(ip) === 4) return ip;
  if (net.isIP(ip) !== 6) return "";
  const parts = ip.split("::");
  let left = parts[0] ? parts[0].split(":") : [],
    right = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const expandV4 = (groups) => {
    if (groups.at(-1)?.includes(".")) {
      const nums = groups.pop().split(".").map(Number);
      if (nums.length !== 4 || nums.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return [];
      groups.push(((nums[0] << 8) | nums[1]).toString(16), ((nums[2] << 8) | nums[3]).toString(16));
    }
    return groups;
  };
  left = expandV4(left);
  right = expandV4(right);
  let groups =
    parts.length > 1
      ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
      : left;
  if (groups.length !== 8) return "";
  groups = groups.map((x) => x.replace(/^0+(?=.)/, "") || "0");
  let bestStart = -1,
    bestLength = 1;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestStart < 0) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":"),
    after = groups.slice(bestStart + bestLength).join(":");
  return before + "::" + after;
}
function clientIp(req) {
  let ip = req.socket?.remoteAddress || "";
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .at(-1)
      .trim();
    if (forwarded && net.isIP(forwarded)) ip = forwarded;
  }
  return normalizeIp(ip);
}
const ipHashForRequest = (req) => {
  const ip = clientIp(req);
  return ip ? crypto.createHmac("sha256", ipBlockKey).update(ip).digest("hex") : "";
};
const ipIsBanned = (slug, h) => Boolean(h && state.bans.some((x) => x.slug === slug && x.ipHash === h));
const participantIsBanned = (slug, participantId) =>
  Boolean(participantId && state.bans.some((x) => x.slug === slug && x.participantId === participantId));

// Origin / CSRF protection -------------------------------------------------
// Every state-changing request must come from the chat's own origin (or an
// origin listed in ALLOWED_ORIGINS). Requests authenticated by a session
// must also carry that session's CSRF token in the x-csrf-token header.
const requestHosts = (req) => {
  const hosts = new Set();
  const add = (v) =>
    String(v || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .forEach((x) => hosts.add(x));
  add(req.headers.host);
  if (TRUST_PROXY) add(req.headers["x-forwarded-host"]);
  return hosts;
};
function originAllowed(req) {
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site && site !== "same-origin" && site !== "none") return false;
  let origin = String(req.headers.origin || "");
  if (!origin || origin === "null") {
    try {
      origin = req.headers.referer ? new URL(req.headers.referer).origin : "";
    } catch {
      origin = "";
    }
  }
  if (!origin || origin === "null") return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    return requestHosts(req).has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}
const csrfValid = (req, expected) => secretEqual(req.headers["x-csrf-token"], expected);
const guestCsrf = (key) =>
  crypto
    .createHmac("sha256", sessionKey)
    .update("csrf:" + key)
    .digest("base64url");

// ---------------------------------------------------------------------------
// Staff sessions
// ---------------------------------------------------------------------------
const sessions = new Map(),
  loginFailures = new Map();
function auth(req, role) {
  const sid = cookie(req, STAFF_COOKIE),
    sess = sid ? sessions.get(sid) : undefined;
  if (!sess || sess.expires < Date.now()) {
    if (sid) sessions.delete(sid);
    return null;
  }
  if (isMutating(req) && !csrfValid(req, sess.csrf)) return null;
  const u = state.users.find((x) => x.id === sess.userId && x.active !== false);
  if (
    !u ||
    (role === "moderator" && !["owner", "moderator", "event-owner"].includes(u.role)) ||
    (role === "stage" && !["owner", "moderator", "stage", "event-owner"].includes(u.role))
  )
    return null;
  return u;
}
const staffSession = (req) => sessions.get(cookie(req, STAFF_COOKIE));
const canManageEvent = (u, e) =>
  Boolean(u && (u.role === "owner" || (u.role === "event-owner" && u.ownerEventId === e.id)));
function eventAuth(req, e, role = "moderator") {
  const u = auth(req, role);
  return u &&
    (u.role === "owner" ||
      (e.moderators.includes(u.id) && (u.role !== "event-owner" || u.ownerEventId === e.id)))
    ? u
    : null;
}

// ---------------------------------------------------------------------------
// Attendee (guest) sessions
// ---------------------------------------------------------------------------
// The browser only ever holds a random session secret (HttpOnly cookie). The
// server stores a SHA-256 of it; the participant identity is generated here
// and is never accepted from the client.
const guestSessions = new Map();
const guestData = readJson(GUEST_FILE, { sessions: [] });
for (const rec of guestData.sessions || [])
  if (rec?.key && rec.expiresAt > Date.now()) guestSessions.set(rec.key, rec);
const guestStore = createStore(
  GUEST_FILE,
  () => ({ sessions: [...guestSessions.values()] }),
  1000,
  3000,
  0o600,
);
const saveGuests = () => guestStore.schedule();
const privateUnlocks = new Map(),
  streamTickets = new Map();
function guestFromRequest(req, slug, { csrf = isMutating(req) } = {}) {
  const raw = cookie(req, GUEST_COOKIE) || String(req.headers["x-guest-session"] || "");
  if (!raw || raw.length > 200) return null;
  const key = sha256(raw),
    rec = guestSessions.get(key);
  if (!rec || rec.slug !== slug) return null;
  if (rec.expiresAt <= Date.now()) {
    endGuestSession(key);
    return null;
  }
  if (csrf && !csrfValid(req, guestCsrf(key))) return null;
  return rec;
}
function endGuestSession(key) {
  const rec = guestSessions.get(key);
  if (!rec) return;
  guestSessions.delete(key);
  for (const [token, unlock] of privateUnlocks) if (unlock.key === key) privateUnlocks.delete(token);
  for (const [ticket, t] of streamTickets) if (t.key === key) streamTickets.delete(ticket);
  closeStreams(rec.slug, (c) => c.guestKey === key, "session-ended");
  saveGuests();
}
function privateFromRequest(req, rec) {
  const token = String(req.headers["x-private-token"] || ""),
    unlock = token ? privateUnlocks.get(token) : undefined,
    now = Date.now();
  if (!rec || !unlock || unlock.key !== rec.key) return null;
  if (now - unlock.lastUsed > PRIVATE_IDLE_MS || now > unlock.expiresAt) {
    privateUnlocks.delete(token);
    return null;
  }
  unlock.lastUsed = now;
  return unlock;
}
const guestView = (rec, e) => ({
  name: rec.name,
  language: rec.language || "",
  csrf: guestCsrf(rec.key),
  pinSet: Boolean(rec.pin),
  pinDisabled: rec.pinFailures >= PIN_MAX_FAILURES,
  expiresAt: rec.expiresAt,
  event: publicEvent(e),
});
// Messages as the attendee may see them in their own private conversation.
const privateView = (m) => ({
  id: m.id,
  type: m.type,
  text: m.text,
  author: m.type === "private-reply" ? "Moderator" : m.author,
  createdAt: m.createdAt,
});
const privateHistoryFor = (slug, participantId) =>
  participantId
    ? eventMessages(slug)
        .filter(
          (m) =>
            (m.type === "private" && m.participantId === participantId) ||
            (m.type === "private-reply" && m.targetParticipantId === participantId),
        )
        .map(privateView)
    : [];
const issueUnlock = (rec) => {
  const token = randomToken(),
    now = Date.now();
  privateUnlocks.set(token, { key: rec.key, slug: rec.slug, lastUsed: now, expiresAt: now + PRIVATE_MAX_MS });
  return token;
};
const pinLockedFor = (rec) => Math.max(0, (rec.pinLockedUntil || 0) - Date.now());

// ---------------------------------------------------------------------------
// Realtime connections (Server-Sent Events)
// ---------------------------------------------------------------------------
const rooms = new Map();
let connectionCount = 0;
const room = (slug) => {
  if (!rooms.has(slug))
    rooms.set(slug, {
      slug,
      guest: new Set(),
      moderator: new Set(),
      stage: new Set(),
      private: new Set(),
      participants: new Map(),
      // Batched delivery to attendees (see deliverToGuests).
      outbox: [],
      job: null,
      timer: null,
      lastFlush: 0,
    });
  return rooms.get(slug);
};
const countConnections = (slug) => rooms.get(slug)?.participants.size || 0;
function sseWrite(c, payload) {
  const res = c.res;
  if (res.destroyed || res.writableEnded) return false;
  // Drop clients that stop reading instead of buffering without limit. The
  // browser reconnects and receives the recent history again.
  if (res.writableLength > SSE_MAX_BUFFER) {
    metrics.fanout.slowDrops++;
    res.destroy();
    return false;
  }
  try {
    res.write(payload);
    return true;
  } catch {
    return false;
  }
}
const ssePayload = (kind, data) => "event: " + kind + "\ndata: " + JSON.stringify(data) + "\n\n";
function addConnection(slug, c) {
  const r = room(slug);
  r[c.role].add(c);
  connectionCount++;
  if (c.role === "guest" && c.participantId)
    r.participants.set(c.participantId, (r.participants.get(c.participantId) || 0) + 1);
}
function removeConnection(slug, c) {
  const r = rooms.get(slug);
  if (!r || !r[c.role].delete(c)) return;
  connectionCount--;
  if (c.role === "guest" && c.participantId) {
    const n = (r.participants.get(c.participantId) || 1) - 1;
    if (n > 0) r.participants.set(c.participantId, n);
    else r.participants.delete(c.participantId);
  }
}

// Writing to a socket costs about the same for one event as for ten (the
// system call dominates, measured ~12–19 µs per connection). Attendee events
// are therefore queued per event and written as one batch per connection:
//  - the first event after a quiet period goes out on the next loop turn;
//  - further events within FANOUT_INTERVAL_MS are collected into the next batch;
//  - a batch is written in slices of FANOUT_SLICE connections with the event
//    loop free in between, so new requests keep being answered;
//  - batches are written strictly one after another, so every connection
//    receives events in the order they were queued.
// The queue is bounded: queueing fails (and the caller answers 503) when
// MAX_PENDING_EVENTS events are waiting.
function deliverToGuests(r, payload) {
  if (r.outbox.length >= MAX_PENDING_EVENTS) return false;
  r.outbox.push(payload);
  if (r.outbox.length > metrics.fanout.maxQueued) metrics.fanout.maxQueued = r.outbox.length;
  scheduleFlush(r);
  return true;
}
const guestBacklog = (r) => (r ? r.outbox.length : 0);
function scheduleFlush(r) {
  if (r.timer || r.job || !r.outbox.length) return;
  const wait = Math.max(0, r.lastFlush + FANOUT_INTERVAL_MS - Date.now());
  r.timer = wait ? setTimeout(startFlush, wait, r) : setImmediate(startFlush, r);
}
function startFlush(r) {
  r.timer = null;
  if (!r.outbox.length) return;
  const events = r.outbox.length,
    buffer = Buffer.from(r.outbox.join(""));
  r.outbox = [];
  r.lastFlush = Date.now();
  r.job = { buffer, conns: [...r.guest], i: 0, t0: performance.now(), events };
  writeSlice(r);
}
function writeSlice(r) {
  const job = r.job,
    end = Math.min(job.conns.length, job.i + FANOUT_SLICE);
  for (; job.i < end; job.i++) sseWrite(job.conns[job.i], job.buffer);
  if (job.i < job.conns.length) return setImmediate(writeSlice, r);
  // Writes are flushed to the sockets on the next tick; measure after that.
  setImmediate(() => {
    let buffered = 0;
    for (const c of job.conns) buffered += c.res.writableLength || 0;
    metrics.fanout.flush.add(performance.now() - job.t0);
    metrics.fanout.events += job.events;
    metrics.fanout.writes += job.conns.length;
    metrics.fanout.maxBufferedKB = Math.max(metrics.fanout.maxBufferedKB, Math.round(buffered / 1024));
    r.job = null;
    scheduleFlush(r);
  });
}
const AUDIENCES = { all: ["guest", "moderator", "stage"], moderator: ["moderator"], stage: ["stage"] };
// Returns false only when the attendee queue is full (the event was not sent
// to attendees). Staff screens are few and are written to directly.
function broadcast(slug, kind, data, audience = "all") {
  const r = rooms.get(slug);
  if (!r) return true;
  const p = ssePayload(kind, data);
  let queued = true;
  for (const role of AUDIENCES[audience] || []) {
    if (role === "guest") {
      if (r.guest.size) queued = deliverToGuests(r, p);
    } else for (const c of r[role]) sseWrite(c, p);
  }
  return queued;
}
function sendPrivate(slug, participantId, kind, data) {
  const r = rooms.get(slug);
  if (!r) return;
  const p = ssePayload(kind, data);
  for (const c of r.private) if (c.participantId === participantId) sseWrite(c, p);
}
function closeStreams(slug, predicate, eventName) {
  const list = slug ? [[slug, rooms.get(slug)]] : [...rooms];
  for (const [roomSlug, r] of list) {
    if (!r) continue;
    for (const role of ["guest", "moderator", "stage", "private"])
      for (const c of [...r[role]])
        if (predicate(c)) {
          sseWrite(c, "event: " + eventName + "\ndata: {}\n\n");
          try {
            c.res.end();
          } catch {}
          removeConnection(roomSlug, c);
        }
  }
}
const revokeUserStreams = (userId, slug = "") =>
  closeStreams(slug, (c) => c.userId && c.userId === userId, "access-revoked");
function revokeUserAccess(userId) {
  for (const [sid, session] of sessions) if (session.userId === userId) sessions.delete(sid);
  revokeUserStreams(userId);
}
// One heartbeat for all connections, written in slices like the batches.
const PING = Buffer.from(": ping\n\n");
let heartbeatRunning = false;
const heartbeat = setInterval(() => {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  const all = [];
  for (const r of rooms.values())
    for (const role of ["guest", "moderator", "stage", "private"]) for (const c of r[role]) all.push(c);
  let i = 0;
  const step = () => {
    const end = Math.min(all.length, i + FANOUT_SLICE);
    for (; i < end; i++) sseWrite(all[i], PING);
    if (i < all.length) setImmediate(step);
    else heartbeatRunning = false;
  };
  step();
}, HEARTBEAT_MS);
heartbeat.unref();

// ---------------------------------------------------------------------------
// Event data views
// ---------------------------------------------------------------------------
const eventBySlug = (s) => state.events.find((e) => e.slug === s);
// Messages as shown to attendees and on public channels. Staff e-mail
// addresses are never exposed there.
// What attendees receive for a public message: only what the chat shows.
// Every byte is sent to every connected attendee, so this stays small.
const publicView = (m) => ({
  id: m.id,
  author: m.type === "announcement" ? "Moderator" : m.author,
  text: m.text,
  createdAt: m.createdAt,
});
const messageEvent = (m) => ({
  id: m.id,
  slug: m.slug,
  type: m.type,
  text: m.text,
  author: m.type === "announcement" ? "Moderator" : m.author,
  status: m.status,
  createdAt: m.createdAt,
  sourceId: m.sourceId || null,
  language: m.language || "",
});
const pinnedForEvent = (e) =>
  (e.pinnedMessages || [])
    .map((p) => {
      const m = findMessage(p.messageId, e.slug);
      return m && m.status === "published" && m.visibility === "public"
        ? { ...messageEvent(m), color: color(p.color, "#f0c000") }
        : null;
    })
    .filter(Boolean)
    .slice(0, 5);
const publicEvent = (e) => ({
  id: e.id,
  slug: e.slug,
  title: e.title,
  mode: e.mode,
  capacity: e.capacity,
  chatEnabled: e.chatEnabled !== false,
  chatTypes: e.chatTypes || "both",
  privateMessagesEnabled: e.privateMessagesEnabled !== false,
  pinnedMessages: pinnedForEvent(e),
  branding: { logo: e.branding?.logo || "" },
  active: e.active,
  createdAt: e.createdAt,
});
const recent = (slug, n = 60) => {
  const rows = eventMessages(slug),
    out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    const m = rows[i];
    if (m.visibility === "public" && m.status === "published") out.push(publicView(m));
  }
  return out.reverse();
};
// Public messages published at or after position `from` in the event's list.
const recentSince = (slug, from, n = 60) => {
  const rows = eventMessages(slug),
    out = [];
  for (let i = rows.length - 1; i >= from && out.length < n; i--) {
    const m = rows[i];
    if (m.visibility === "public" && m.status === "published") out.push(publicView(m));
  }
  return out.reverse();
};
const stageEvent = (m) => ({
  ...messageEvent(m),
  author: m.author,
  stageState: m.stageState || "",
  stageQueuedAt: m.stageQueuedAt || "",
  stageReadAt: m.stageReadAt || "",
});
const stageQueue = (slug) =>
  eventMessages(slug)
    .filter((m) => m.stageState === "queued")
    .map(stageEvent);
const stageSnapshot = (e) => {
  const current = findMessage(e.stageCurrentId, e.slug);
  return {
    queue: stageQueue(e.slug),
    current: current?.stageState === "queued" ? stageEvent(current) : null,
  };
};
const stageTokenValid = (e, access) =>
  Boolean(e.stageToken && secretEqual(access, e.stageToken) && Date.now() < e.stageAccessExpires);
const stageAuthorized = (req, e, access = "") =>
  Boolean(eventAuth(req, e, "stage") || stageTokenValid(e, access));
const sanitize = (s, max = MAX_MESSAGE) =>
  String(s || "")
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
function blockedTerm(text, words) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase();
  return (words || []).find((raw) => {
    const word = String(raw || "")
      .trim()
      .normalize("NFKC")
      .toLocaleLowerCase();
    if (!word) return false;
    const escaped = word
      .split(/\s+/)
      .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    return new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "($|[^\\p{L}\\p{N}])", "iu").test(normalized);
  });
}
const assignmentEvent = (m) => ({ id: m.id, topic: m.topic || "", assignedTo: m.assignedTo || "" });
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 30000) throw Error("Request too large");
    chunks.push(c);
  }
  if (!size) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
const userRate = new Map(),
  roomRate = new Map();
function roomRateAllowed(slug) {
  const now = Date.now(),
    recentTimes = (roomRate.get(slug) || []).filter((t) => now - t < 1000);
  if (recentTimes.length >= ROOM_RATE) {
    roomRate.set(slug, recentTimes);
    return false;
  }
  recentTimes.push(now);
  roomRate.set(slug, recentTimes);
  return true;
}

// ---------------------------------------------------------------------------
// Periodic clean-up of expired sessions, tickets and rate-limit entries
// ---------------------------------------------------------------------------
function sweep() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires < now) sessions.delete(sid);
  let guestsChanged = false;
  for (const [key, rec] of guestSessions)
    if (rec.expiresAt <= now) {
      endGuestSession(key);
      guestsChanged = true;
    }
  for (const [token, u] of privateUnlocks)
    if (now - u.lastUsed > PRIVATE_IDLE_MS || now > u.expiresAt) {
      privateUnlocks.delete(token);
      closeStreams(u.slug, (c) => c.unlockToken === token, "private-locked");
    }
  for (const [ticket, t] of streamTickets) if (t.expiresAt < now) streamTickets.delete(ticket);
  for (const [key, entry] of idempotency)
    if (!entry.pending && now - entry.at > IDEMPOTENCY_MS) idempotency.delete(key);
  for (const [key, t] of userRate) if (now - t > 10000) userRate.delete(key);
  for (const [slug, times] of roomRate) if (!times.some((t) => now - t < 1000)) roomRate.delete(slug);
  for (const [key, f] of loginFailures) if (now - f.first > LOGIN_WINDOW_MS) loginFailures.delete(key);
  for (const [slug, r] of rooms)
    if (!r.guest.size && !r.moderator.size && !r.stage.size && !r.private.size) rooms.delete(slug);
  if (guestsChanged) saveGuests();
}
setInterval(sweep, Math.min(SWEEP_MS, PRIVATE_IDLE_MS)).unref();

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
// Static files are read and compressed once at start-up.
const staticAssets = new Map();
for (const name of fs.readdirSync(PUBLIC_DIR)) {
  const file = path.join(PUBLIC_DIR, name);
  if (!fs.statSync(file).isFile()) continue;
  const raw = fs.readFileSync(file);
  staticAssets.set(file, {
    raw,
    gzip: zlib.gzipSync(raw, { level: 9 }),
    br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
    type: MIME[path.extname(file)] || "application/octet-stream",
    etag: '"' + crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 22) + '"',
  });
}
const server = http.createServer(async (req, res) => {
  const reqStart = performance.now();
  const url = new URL(req.url, "http://localhost");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors " +
      (process.env.FRAME_ANCESTORS || "*"),
  );
  if (req.method === "OPTIONS") {
    // The API is only used same-origin; no CORS is granted.
    res.writeHead(204, { allow: "GET,POST,PATCH,DELETE" });
    return res.end();
  }
  try {
    if (url.pathname === "/health")
      return send(res, 200, { ok: true, connections: connectionCount, events: state.events.length });
    if (url.pathname.startsWith("/api/") && isMutating(req) && !originAllowed(req))
      return send(res, 403, { error: "Request blocked." });
    if (url.pathname === "/api/login" && req.method === "POST") {
      const b = await body(req),
        email = String(b.email || "")
          .trim()
          .toLowerCase(),
        limiterKey = email + "\n" + ipHashForRequest(req),
        failures = loginFailures.get(limiterKey);
      if (failures && failures.count >= LOGIN_MAX_FAILURES && Date.now() - failures.first < LOGIN_WINDOW_MS)
        return send(res, 429, { error: "Too many sign-in attempts. Please try again later." });
      const u = state.users.find((x) => x.email === email && x.active !== false);
      if (!u || !(await verifyHash(String(b.password || ""), u))) {
        const f =
          failures && Date.now() - failures.first < LOGIN_WINDOW_MS
            ? failures
            : { count: 0, first: Date.now() };
        f.count++;
        loginFailures.set(limiterKey, f);
        return send(res, 401, { error: "Invalid email address or password." });
      }
      loginFailures.delete(limiterKey);
      const previous = cookie(req, STAFF_COOKIE);
      if (previous) sessions.delete(previous);
      const sid = randomToken(),
        csrf = randomToken();
      sessions.set(sid, { userId: u.id, csrf, expires: Date.now() + STAFF_SESSION_MS });
      return send(
        res,
        200,
        { user: safeUser(u), csrf },
        { "set-cookie": staffCookie(req, sid, STAFF_SESSION_MS / 1000) },
      );
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      const sid = cookie(req, STAFF_COOKIE),
        sess = sessions.get(sid);
      if (sess) {
        sessions.delete(sid);
        closeStreams("", (c) => c.staffSid === sid, "access-revoked");
      }
      return send(res, 200, { ok: true }, { "set-cookie": staffCookie(req, "", 0) });
    }
    if (url.pathname === "/api/me" && req.method === "GET") {
      const u = auth(req);
      return u
        ? send(res, 200, { user: safeUser(u), csrf: staffSession(req).csrf })
        : send(res, 401, { error: "Log in" });
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      const u = auth(req);
      if (!u) return send(res, 401, { error: "Log in" });
      return send(res, 200, {
        events: state.events
          .filter(
            (e) =>
              u.role === "owner" ||
              (e.moderators.includes(u.id) && (u.role !== "event-owner" || u.ownerEventId === e.id)),
          )
          .map(publicEvent),
      });
    }
    if (url.pathname === "/api/events" && req.method === "POST") {
      const u = auth(req);
      if (u?.role !== "owner") return send(res, 403, { error: "Only the platform admin can create events." });
      const b = await body(req),
        title = sanitize(b.title, 100) || "New event";
      let slug = slugify(b.slug || title);
      if (state.events.some((e) => e.slug === slug)) slug += "-" + id().slice(0, 4);
      const e = {
        id: id(),
        slug,
        title,
        mode: ["moderated", "readonly", "open"].includes(b.mode) ? b.mode : "moderated",
        capacity: Math.min(20000, Math.max(1, Number(b.capacity) || DEFAULT_MAX)),
        active: true,
        chatEnabled: true,
        chatTypes: "both",
        privateMessagesEnabled: true,
        blockedWords: [],
        pinnedMessages: [],
        privateThreads: {},
        branding: { primary: "#111111", background: "#ffffff", logo: logoUrl(b.logo) },
        createdAt: new Date().toISOString(),
        moderators: [u.id],
        moderatorTopics: {},
      };
      state.events.push(e);
      save();
      return send(res, 201, { event: publicEvent(e) });
    }
    const match = url.pathname.match(/^\/api\/events\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const slug = decodeURIComponent(match[1]),
        action = match[2] || "",
        e = eventBySlug(slug);
      if (!e || !e.active) return send(res, 404, { error: "Event not found" });
      if (!action && req.method === "GET") return send(res, 200, { event: publicEvent(e) });

      // ---- Attendee session ------------------------------------------------
      if (action === "join" && req.method === "POST") {
        const b = await body(req);
        if (e.chatEnabled === false) return send(res, 403, { error: "Chat is disabled." });
        const visitorIpHash = ipHashForRequest(req);
        if (ipIsBanned(slug, visitorIpHash))
          return send(res, 403, { error: "You do not have access to this chat." });
        if (countConnections(slug) >= e.capacity)
          return send(res, 429, { error: "This chat has reached its maximum capacity." });
        if (guestSessions.size >= MAX_GUEST_SESSIONS)
          return send(res, 503, { error: "This chat is busy. Please try again shortly." });
        // A new join from this browser ends the previous attendee session so a
        // following visitor never inherits it.
        const previous = cookie(req, GUEST_COOKIE) || String(req.headers["x-guest-session"] || "");
        if (previous) endGuestSession(sha256(previous));
        // A client may ask for a shorter session (load tests do, so abandoned
        // test sessions expire quickly); never longer than GUEST_SESSION_HOURS.
        const minutes = Number(b.sessionMinutes),
          lifetime =
            Number.isFinite(minutes) && minutes >= 1
              ? Math.min(GUEST_SESSION_MS, minutes * 60000)
              : GUEST_SESSION_MS;
        const raw = randomToken(),
          now = Date.now(),
          rec = {
            key: sha256(raw),
            slug,
            participantId: id(),
            name: sanitize(b.name, 40) || "Guest",
            language: sanitize(b.language, 40),
            ipHash: visitorIpHash,
            createdAt: now,
            expiresAt: now + lifetime,
            pin: null,
            pinFailures: 0,
            pinConsecutive: 0,
            pinLockedUntil: 0,
          };
        guestSessions.set(rec.key, rec);
        saveGuests();
        // The first stream ticket comes with the join, saving one round trip
        // through the proxy. The join already carries the history, so the
        // stream only sends what was published after this moment.
        const ticket = randomToken();
        streamTickets.set(ticket, {
          key: rec.key,
          slug,
          scope: "public",
          unlockToken: "",
          expiresAt: now + TICKET_MS,
          historyFrom: eventMessages(slug).length,
        });
        metrics.join.add(performance.now() - reqStart);
        return send(
          res,
          200,
          {
            ...guestView(rec, e),
            ticket,
            history: recent(slug),
            // Only returned when the client reports that cookies are blocked
            // (e.g. third-party iframe in Safari); kept in tab memory/sessionStorage.
            ...(b.cookieless === true ? { sessionToken: raw } : {}),
          },
          { "set-cookie": guestCookie(req, slug, raw, Math.floor(lifetime / 1000)) },
        );
      }
      if (action === "session" && req.method === "GET") {
        const rec = guestFromRequest(req, slug);
        if (!rec) return send(res, 401, { error: "Session expired." });
        if (participantIsBanned(slug, rec.participantId) || ipIsBanned(slug, rec.ipHash))
          return send(res, 403, { error: "You do not have access to this chat." });
        return send(res, 200, {
          ...guestView(rec, e),
          ...(url.searchParams.get("light") ? {} : { history: recent(slug) }),
        });
      }
      if (action === "session/end" && req.method === "POST") {
        const rec = guestFromRequest(req, slug);
        if (rec) endGuestSession(rec.key);
        return send(res, 200, { ok: true }, { "set-cookie": guestCookie(req, slug, "", 0) });
      }
      if (action === "stream-ticket" && req.method === "POST") {
        const rec = guestFromRequest(req, slug);
        if (!rec) return send(res, 401, { error: "Session expired." });
        if (participantIsBanned(slug, rec.participantId) || ipIsBanned(slug, rec.ipHash))
          return send(res, 403, { error: "You do not have access to this chat." });
        const b = await body(req),
          scope = b.scope === "private" ? "private" : "public";
        let unlockToken = "";
        if (scope === "private") {
          if (!privateFromRequest(req, rec))
            return send(res, 401, { error: "Enter your PIN to open your private conversation." });
          unlockToken = String(req.headers["x-private-token"]);
        }
        const ticket = randomToken();
        streamTickets.set(ticket, {
          key: rec.key,
          slug,
          scope,
          unlockToken,
          expiresAt: Date.now() + TICKET_MS,
        });
        return send(res, 200, { ticket });
      }

      // ---- Private conversation (PIN protected) ------------------------------
      if (action.startsWith("private/") && req.method === "POST") {
        const rec = guestFromRequest(req, slug);
        if (!rec) return send(res, 401, { error: "Session expired." });
        if (participantIsBanned(slug, rec.participantId) || ipIsBanned(slug, rec.ipHash))
          return send(res, 403, { error: "You do not have access to this chat." });
        const step = action.slice("private/".length);
        if (step === "pin" || step === "unlock") {
          const b = await body(req),
            pin = String(b.pin || "");
          if (rec.pinFailures >= PIN_MAX_FAILURES)
            return send(res, 423, {
              error: "Your private conversation is locked. Start a new chat session to continue.",
            });
          if (step === "pin") {
            if (rec.pin) return send(res, 409, { error: "A PIN has already been set for this session." });
            if (pin.length < PIN_MIN || pin.length > PIN_MAX)
              return send(res, 400, { error: "Choose a PIN or passphrase of 6 to 64 characters." });
            rec.pin = await hashAsync(pin);
            saveGuests();
            return send(res, 200, { privateToken: issueUnlock(rec) });
          }
          if (!rec.pin) return send(res, 409, { error: "Set a PIN first." });
          const wait = pinLockedFor(rec);
          if (wait)
            return send(
              res,
              429,
              {
                error: "Too many incorrect attempts. Please try again later.",
                retryAfter: Math.ceil(wait / 1000),
              },
              { "retry-after": String(Math.ceil(wait / 1000)) },
            );
          if (!(await verifyHash(pin, rec.pin))) {
            rec.pinFailures = (rec.pinFailures || 0) + 1;
            rec.pinConsecutive = (rec.pinConsecutive || 0) + 1;
            if (rec.pinConsecutive >= PIN_ATTEMPTS_BEFORE_LOCK) {
              rec.pinConsecutive = 0;
              rec.pinLockedUntil = Date.now() + PIN_LOCK_MS;
            }
            saveGuests();
            if (rec.pinFailures >= PIN_MAX_FAILURES) {
              for (const [token, u] of privateUnlocks) if (u.key === rec.key) privateUnlocks.delete(token);
              closeStreams(slug, (c) => c.role === "private" && c.guestKey === rec.key, "private-locked");
              return send(res, 423, {
                error: "Your private conversation is locked. Start a new chat session to continue.",
              });
            }
            return send(res, 401, { error: "Incorrect PIN." });
          }
          rec.pinConsecutive = 0;
          rec.pinLockedUntil = 0;
          saveGuests();
          return send(res, 200, { privateToken: issueUnlock(rec) });
        }
        if (step === "lock") {
          for (const [token, u] of privateUnlocks) if (u.key === rec.key) privateUnlocks.delete(token);
          closeStreams(slug, (c) => c.role === "private" && c.guestKey === rec.key, "private-locked");
          return send(res, 200, { ok: true });
        }
        if (step === "history") {
          if (!privateFromRequest(req, rec))
            return send(res, 401, { error: "Enter your PIN to open your private conversation." });
          return send(res, 200, { messages: privateHistoryFor(slug, rec.participantId) });
        }
        return send(res, 404, { error: "Not found" });
      }

      // ---- Realtime stream -------------------------------------------------
      if (action === "stream" && req.method === "GET") {
        const ticketId = url.searchParams.get("ticket") || "";
        let role = null,
          guest = null,
          ticket = null,
          u = null;
        if (ticketId) {
          ticket = streamTickets.get(ticketId);
          streamTickets.delete(ticketId);
          guest =
            ticket && ticket.slug === slug && ticket.expiresAt > Date.now()
              ? guestSessions.get(ticket.key)
              : null;
          if (!guest || guest.slug !== slug || guest.expiresAt <= Date.now())
            return send(res, 401, { error: "Session expired." });
          if (ticket.scope === "private") {
            const unlock = privateUnlocks.get(ticket.unlockToken);
            if (!unlock || unlock.key !== guest.key) return send(res, 401, { error: "Session expired." });
            role = "private";
          } else role = "guest";
          if (participantIsBanned(slug, guest.participantId) || ipIsBanned(slug, guest.ipHash))
            return send(res, 403, { error: "You do not have access to this chat." });
          if (
            role === "guest" &&
            !rooms.get(slug)?.participants.has(guest.participantId) &&
            countConnections(slug) >= e.capacity
          )
            return send(res, 429, { error: "This chat has reached its maximum capacity." });
        } else {
          u = auth(req, "stage");
          const stageView = url.searchParams.get("screen") === "stage";
          role =
            stageView && u && eventAuth(req, e, "stage")
              ? "stage"
              : u && u.role !== "stage" && eventAuth(req, e)
                ? "moderator"
                : u && eventAuth(req, e, "stage")
                  ? "stage"
                  : stageTokenValid(e, url.searchParams.get("access") || "")
                    ? "stage"
                    : null;
          if (!role) return send(res, 401, { error: "Session expired." });
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const c = {
          res,
          role,
          participantId: guest?.participantId || "",
          ipHash: guest?.ipHash || "",
          guestKey: guest?.key || "",
          unlockToken: role === "private" ? ticket.unlockToken : "",
          userId: u?.id || "",
          staffSid: u ? cookie(req, STAFF_COOKIE) : "",
        };
        addConnection(slug, c);
        const ready =
          role === "private"
            ? { privateHistory: privateHistoryFor(slug, guest.participantId) }
            : {
                connections: countConnections(slug),
                capacity: e.capacity,
                history:
                  role === "stage"
                    ? stageQueue(slug)
                    : ticket?.historyFrom !== undefined
                      ? recentSince(slug, ticket.historyFrom)
                      : recent(slug),
                pins: pinnedForEvent(e),
                stage: role === "stage" ? stageSnapshot(e) : undefined,
              };
        sseWrite(c, "retry: 3000\n" + ssePayload("ready", ready));
        req.on("close", () => removeConnection(slug, c));
        return;
      }

      // ---- Attendee messages -------------------------------------------------
      // POST /messages
      //   201  new message: stored in the journal (written, fdatasync'd), added
      //        to the chat and queued for live delivery in order.
      //   200  same clientMessageId sent again: the original result, no copy.
      //   429  refused by a rate limit (Retry-After); nothing was stored.
      //   503  refused because the server is overloaded or could not store the
      //        message (Retry-After); nothing was stored.
      // A client that gets no answer (time-out, 502) can ask
      // GET /messages/status?clientMessageId=… or simply retry with the same id.
      if (action === "messages" && req.method === "POST") {
        const g = guestFromRequest(req, slug);
        if (!g) return send(res, 401, { error: "Session expired." });
        const b = await body(req);
        if (e.chatEnabled === false) return send(res, 403, { error: "Chat is disabled." });
        const visitorIpHash = ipHashForRequest(req);
        if (
          ipIsBanned(slug, visitorIpHash) ||
          ipIsBanned(slug, g.ipHash) ||
          participantIsBanned(slug, g.participantId)
        )
          return send(res, 403, { error: "You do not have access to this chat." });
        if (visitorIpHash && visitorIpHash !== g.ipHash) {
          g.ipHash = visitorIpHash;
          saveGuests();
        }
        if (e.mode === "readonly") return send(res, 403, { error: "Chat is read-only." });
        const kind = b.kind === "private" ? "private" : "public";
        if (kind === "private" && e.privateMessagesEnabled === false)
          return send(res, 403, { error: "Private messages are disabled for this event." });
        if (kind === "private" && !privateFromRequest(req, g))
          return send(res, 401, { error: "Enter your PIN to open your private conversation." });
        const text = sanitize(b.text);
        if (!text) return send(res, 400, { error: "Please enter a message first." });
        if (blockedTerm(text, e.blockedWords))
          return send(res, 400, { error: "Your message contains a blocked word or phrase." });
        // Idempotency: the same clientMessageId from the same session never
        // creates a second message.
        const clientMessageId = b.clientMessageId === undefined ? "" : String(b.clientMessageId);
        if (clientMessageId && !CLIENT_ID_RE.test(clientMessageId))
          return send(res, 400, { error: "Invalid message id." });
        const idemKey = clientMessageId ? sha256(g.key + ":" + clientMessageId) : "",
          textHash = sha256(kind + ":" + text);
        if (idemKey && idempotency.has(idemKey)) {
          const entry = idempotency.get(idemKey);
          if (entry.textHash !== textHash)
            return send(res, 409, { error: "This message id was already used for another message." });
          if (entry.pending) await entry.pending.catch(() => {});
          const original = idempotency.has(idemKey) ? messagesById.get(entry.messageId) : null;
          if (original) {
            metrics.inc("post.replayed");
            return send(res, 200, {
              ok: true,
              replayed: true,
              status: original.status,
              message: original.type === "private" ? privateView(original) : messageEvent(original),
            });
          }
          // The earlier attempt was not stored; continue as a new attempt.
        }
        const now = Date.now(),
          last = userRate.get(g.key) || 0;
        if (now - last < 5000) {
          metrics.inc("post.429.user");
          return send(
            res,
            429,
            {
              error: "Please wait before sending another message.",
              retryAfter: Math.ceil((last + 5000 - now) / 1000),
            },
            { "retry-after": String(Math.ceil((last + 5000 - now) / 1000)) },
          );
        }
        const direct = e.mode === "open" && kind === "public";
        // Overload protection: refuse quickly instead of queueing work that
        // would only be answered after the client has given up.
        const r = rooms.get(slug);
        if (
          shuttingDown ||
          currentLagMs() > OVERLOAD_LAG_MS ||
          journal.pending >= MAX_PENDING_MESSAGES ||
          (direct && guestBacklog(r) >= MAX_PENDING_EVENTS - 10)
        ) {
          metrics.inc("post.503.overload");
          return send(
            res,
            503,
            { error: "This chat is busy. Please try again shortly.", retryAfter: 2 },
            { "retry-after": "2" },
          );
        }
        if (direct && !roomRateAllowed(slug)) {
          metrics.inc("post.429.room");
          return send(
            res,
            429,
            { error: "This chat is busy. Please try again shortly.", retryAfter: 1 },
            { "retry-after": "1" },
          );
        }
        userRate.set(g.key, now);
        const m = {
          id: id(),
          slug,
          text,
          author: g.name,
          participantId: g.participantId,
          ipHash: g.ipHash || "",
          type: kind === "private" ? "private" : "question",
          visibility: direct ? "public" : "private",
          status: direct ? "published" : kind === "private" ? "private" : "pending",
          language: g.language || "",
          createdAt: new Date(now).toISOString(),
          ...(idemKey ? { clientKey: idemKey } : {}),
        };
        if (direct) m.publishedAt = m.createdAt;
        const tAdmitted = performance.now();
        metrics.post.admission.add(tAdmitted - reqStart);
        const entry = { messageId: m.id, textHash, at: now, pending: journal.append(m) };
        if (idemKey) idempotency.set(idemKey, entry);
        try {
          await entry.pending;
        } catch {
          if (idemKey) idempotency.delete(idemKey);
          if (userRate.get(g.key) === now) userRate.delete(g.key);
          metrics.inc("post.503.storage");
          return send(
            res,
            503,
            { error: "Your message could not be stored. Please try again.", retryAfter: 2 },
            { "retry-after": "2" },
          );
        }
        entry.pending = null;
        metrics.post.commit.add(performance.now() - tAdmitted);
        // Stored: make it part of the chat and queue live delivery.
        state.messages.push(m);
        indexMessage(m);
        save();
        metrics.inc("post.201");
        if (kind === "private") {
          e.privateThreads ||= {};
          e.privateThreads[m.participantId] = { status: "open", updatedAt: m.createdAt };
          broadcast(
            slug,
            "private-thread-status",
            { participantId: m.participantId, status: "open", updatedAt: m.createdAt },
            "moderator",
          );
          broadcast(slug, "private-message", messageEvent(m), "moderator");
          sendPrivate(slug, m.participantId, "private", privateView(m));
          metrics.post.total.add(performance.now() - reqStart);
          return send(res, 201, { ok: true, status: m.status, message: privateView(m) });
        }
        if (direct) {
          broadcast(slug, "public", publicView(m));
          broadcast(slug, "public-message", messageEvent(m), "moderator");
        } else broadcast(slug, "inbox", messageEvent(m), "moderator");
        metrics.post.total.add(performance.now() - reqStart);
        return send(res, 201, { ok: true, status: m.status, message: messageEvent(m) });
      }
      // Outcome of a message sent with a clientMessageId, for this session only.
      // Returns no message text.
      if (action === "messages/status" && req.method === "GET") {
        const g = guestFromRequest(req, slug);
        if (!g) return send(res, 401, { error: "Session expired." });
        const clientMessageId = url.searchParams.get("clientMessageId") || "";
        if (!CLIENT_ID_RE.test(clientMessageId)) return send(res, 400, { error: "Invalid message id." });
        const entry = idempotency.get(sha256(g.key + ":" + clientMessageId));
        if (!entry) return send(res, 404, { status: "unknown" });
        if (entry.pending) return send(res, 202, { status: "pending" });
        const m = messagesById.get(entry.messageId);
        if (!m) return send(res, 404, { status: "unknown" });
        return send(res, 200, {
          status: "accepted",
          message: {
            id: m.id,
            kind: m.type === "private" ? "private" : "public",
            status: m.status,
            createdAt: m.createdAt,
          },
        });
      }

      // ---- Staff endpoints -----------------------------------------------------
      const mod = eventAuth(req, e);
      if (action === "messages" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const messages = eventMessages(slug)
          .filter(
            (m) => mod.role === "owner" || canManageEvent(mod, e) || !m.assignedTo || m.assignedTo === mod.id,
          )
          .map((m) => {
            const { ipHash, clientKey, ...visible } = m;
            return { ...visible, ipAvailable: Boolean(ipHash) && TRUST_PROXY };
          });
        return send(res, 200, {
          messages,
          privateThreads: e.privateThreads || {},
          pins: pinnedForEvent(e),
          trustProxy: TRUST_PROXY,
        });
      }
      if (action === "messages/topics" && req.method === "PATCH") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can set moderator topics." });
        const b = await body(req),
          user = state.users.find(
            (x) => x.id === b.userId && e.moderators.includes(x.id) && x.role === "moderator",
          );
        if (!user) return send(res, 404, { error: "Moderator not found." });
        const topics = [
          ...new Set((Array.isArray(b.topics) ? b.topics : []).map((x) => sanitize(x, 60)).filter(Boolean)),
        ].slice(0, 20);
        e.moderatorTopics ||= {};
        e.moderatorTopics[user.id] = topics;
        save();
        return send(res, 200, { user: { ...safeUser(user), topics } });
      }
      if (action === "settings" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        return send(res, 200, { event: { ...publicEvent(e), blockedWords: e.blockedWords || [] } });
      }
      if (action === "settings" && req.method === "PATCH") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req);
        if (b.title) e.title = sanitize(b.title, 100);
        if (["open", "moderated", "readonly"].includes(b.mode)) e.mode = b.mode;
        if (Number.isFinite(Number(b.capacity)))
          e.capacity = Math.max(1, Math.min(20000, Number(b.capacity)));
        if (typeof b.chatEnabled === "boolean") e.chatEnabled = b.chatEnabled;
        if (typeof b.privateMessagesEnabled === "boolean")
          e.privateMessagesEnabled = b.privateMessagesEnabled;
        if (["public", "private", "both"].includes(b.chatTypes)) e.chatTypes = b.chatTypes;
        if (b.branding) e.branding = { ...e.branding, logo: logoUrl(b.branding.logo) };
        if (typeof b.blockedWords === "string")
          e.blockedWords = [
            ...new Set(
              b.blockedWords
                .split(/[,\n]/)
                .map((x) => sanitize(x, 60))
                .filter(Boolean),
            ),
          ].slice(0, 100);
        save();
        broadcast(slug, "settings", publicEvent(e));
        return send(res, 200, { event: publicEvent(e) });
      }
      const assign = action.match(/^messages\/([^/]+)\/assign$/);
      if (assign && req.method === "POST") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can assign questions." });
        const b = await body(req),
          m = findMessage(assign[1], slug);
        if (!m) return send(res, 404, { error: "Message not found." });
        const assignedTo = String(b.assignedTo || "");
        if (
          assignedTo &&
          !state.users.some(
            (x) =>
              x.id === assignedTo &&
              e.moderators.includes(x.id) &&
              x.role === "moderator" &&
              x.active !== false,
          )
        )
          return send(res, 400, { error: "Choose an active moderator for this event." });
        m.topic = sanitize(b.topic, 60);
        m.assignedTo = assignedTo;
        m.assignedAt = assignedTo ? new Date().toISOString() : "";
        save();
        broadcast(slug, "assignment", assignmentEvent(m), "moderator");
        const { ipHash, clientKey, ...visible } = m;
        return send(res, 200, { message: visible });
      }
      if (action.startsWith("conversations/") && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const conv = action.match(/^conversations\/([^/]+)\/(close|reopen)$/);
        if (!conv) return send(res, 404, { error: "Not found" });
        const participantId = decodeURIComponent(conv[1]),
          threadMessages = eventMessages(slug).filter(
            (m) =>
              (m.participantId === participantId || m.targetParticipantId === participantId) &&
              ["private", "private-reply"].includes(m.type),
          );
        if (!threadMessages.length) return send(res, 404, { error: "Private conversation not found." });
        const status = conv[2] === "close" ? "closed" : "open",
          updatedAt = new Date().toISOString();
        e.privateThreads ||= {};
        e.privateThreads[participantId] = {
          ...(e.privateThreads[participantId] || {}),
          status,
          updatedAt,
          ...(status === "closed"
            ? { closedAt: updatedAt, closedBy: mod.email }
            : { closedAt: "", closedBy: "" }),
        };
        save();
        broadcast(slug, "private-thread-status", { participantId, status, updatedAt }, "moderator");
        return send(res, 200, { participantId, ...e.privateThreads[participantId] });
      }
      if (action === "pins" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req),
          m = findMessage(b.messageId, slug);
        if (!m || m.status !== "published" || m.visibility !== "public" || m.type !== "question")
          return send(res, 400, { error: "Only published public questions can be pinned." });
        e.pinnedMessages ||= [];
        const existing = e.pinnedMessages.find((x) => x.messageId === m.id);
        if (!existing && e.pinnedMessages.length >= 5)
          return send(res, 409, { error: "Up to five messages can be pinned at a time." });
        const pin = {
          messageId: m.id,
          color: color(b.color, "#f0c000"),
          by: mod.email,
          at: new Date().toISOString(),
        };
        if (existing) Object.assign(existing, pin);
        else e.pinnedMessages.push(pin);
        save();
        const pins = pinnedForEvent(e);
        broadcast(slug, "pins", pins);
        return send(res, 200, { pins });
      }
      if (action === "announcements" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req),
          text = sanitize(b.text);
        if (!text) return send(res, 400, { error: "Please enter a message first." });
        if (blockedTerm(text, e.blockedWords))
          return send(res, 400, { error: "Your message contains a blocked word or phrase." });
        e.pinnedMessages ||= [];
        if (e.pinnedMessages.length >= 5)
          return send(res, 409, { error: "Up to five messages can be pinned at a time." });
        const now = new Date().toISOString(),
          m = {
            id: id(),
            slug,
            text,
            author: mod.email,
            type: "announcement",
            visibility: "public",
            status: "published",
            createdAt: now,
            publishedAt: now,
          };
        addMessage(m);
        e.pinnedMessages.push({ messageId: m.id, color: color(b.color, "#111111"), by: mod.email, at: now });
        save();
        broadcast(slug, "public", publicView(m));
        broadcast(slug, "public-message", messageEvent(m), "moderator");
        const pins = pinnedForEvent(e);
        broadcast(slug, "pins", pins);
        return send(res, 201, { message: messageEvent(m), pins });
      }
      const unpin = action.match(/^pins\/([^/]+)$/);
      if (unpin && req.method === "DELETE") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const messageId = decodeURIComponent(unpin[1]),
          found = findMessage(messageId, slug),
          announcement = found?.type === "announcement" ? found : null;
        e.pinnedMessages = (e.pinnedMessages || []).filter((x) => x.messageId !== messageId);
        if (announcement) {
          announcement.status = "withdrawn";
          announcement.visibility = "private";
          broadcast(slug, "remove", { id: announcement.id });
        }
        save();
        const pins = pinnedForEvent(e);
        broadcast(slug, "pins", pins);
        return send(res, 200, { pins });
      }
      if (action === "bans" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const rowsForEvent = eventMessages(slug);
        const bans = state.bans
          .filter((x) => x.slug === slug)
          .map((b) => {
            const rows = rowsForEvent.filter(
              (m) =>
                (b.participantId && m.participantId === b.participantId) ||
                (b.ipHash && m.ipHash === b.ipHash),
            );
            return {
              id: b.id || b.participantId || b.ipHash,
              kind: b.ipHash ? "ip" : "user",
              participantId: b.participantId || "",
              name: b.name || rows[0]?.author || (b.ipHash ? "IP address" : "Attendee"),
              at: b.at,
              by: b.by,
              messageCount: rows.length,
            };
          });
        return send(res, 200, { bans, trustProxy: TRUST_PROXY });
      }
      const unban = action.match(/^bans\/([^/]+)$/);
      if (unban && req.method === "DELETE") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const key = decodeURIComponent(unban[1]),
          ban = state.bans.find((x) => x.slug === slug && (x.id === key || x.participantId === key));
        if (!ban) return send(res, 404, { error: "Blocked user not found." });
        state.bans = state.bans.filter((x) => x !== ban);
        save();
        broadcast(
          slug,
          "ban-change",
          { participantId: ban.participantId || "", kind: ban.ipHash ? "ip" : "user", blocked: false },
          "moderator",
        );
        return send(res, 200, { ok: true });
      }
      const stageAction = action.match(/^messages\/([^/]+)\/stage-(show|read)$/);
      if (stageAction && req.method === "POST") {
        const b = await body(req),
          m = findMessage(stageAction[1], slug);
        if (!stageAuthorized(req, e, b.access)) return send(res, 401, { error: "Stage access required." });
        if (!m) return send(res, 404, { error: "Message not found." });
        if (m.stageState !== "queued")
          return send(res, 409, { error: "This item is no longer in the speaker queue." });
        if (stageAction[2] === "show") {
          e.stageCurrentId = m.id;
          m.stageShownAt = new Date().toISOString();
        } else {
          m.stageState = "read";
          m.stageReadAt = new Date().toISOString();
          if (e.stageCurrentId === m.id) e.stageCurrentId = "";
        }
        save();
        broadcast(slug, "stage-state", stageSnapshot(e), "stage");
        broadcast(slug, "stage-status", stageSnapshot(e), "moderator");
        broadcast(slug, "message-status", messageEvent(m), "moderator");
        return send(res, 200, { message: stageEvent(m), stage: stageSnapshot(e) });
      }
      const op = action.match(/^messages\/([^/]+)\/(publish|withdraw|reject|stage-remove|stage|delete)$/);
      if (op && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const m = findMessage(op[1], slug);
        if (!m) return send(res, 404, { error: "Message not found" });
        const act = op[2];
        // Private conversations can never be published or sent to the stage.
        if (
          ["private", "private-reply", "stage-reply"].includes(m.type) &&
          ["publish", "stage"].includes(act)
        )
          return send(res, 400, { error: "Private messages cannot be published." });
        if (act === "publish") {
          if (!roomRateAllowed(slug))
            return send(res, 429, {
              error: "Publishing is temporarily rate-limited. Please try again shortly.",
            });
          m.status = "published";
          m.visibility = "public";
          m.publishedAt = new Date().toISOString();
          broadcast(slug, "public", publicView(m));
        }
        if (act === "withdraw") {
          if (m.status !== "published" && m.status !== "withdrawn")
            return send(res, 400, { error: "Only a published question can be withdrawn." });
          m.status = "withdrawn";
          m.visibility = "private";
          m.withdrawnAt = new Date().toISOString();
          broadcast(slug, "remove", { id: m.id });
        }
        if (act === "reject") {
          m.status = "rejected";
          m.visibility = "private";
        }
        if (act === "delete") {
          m.status = "deleted";
          m.visibility = "private";
          m.stageState = "removed";
          if (e.stageCurrentId === m.id) e.stageCurrentId = "";
          broadcast(slug, "remove", { id: m.id });
        }
        if (act === "stage-remove") {
          if (m.stageState !== "queued")
            return send(res, 400, { error: "This item is no longer in the speaker queue." });
          m.stageState = "removed";
          m.stageRemovedAt = new Date().toISOString();
          if (e.stageCurrentId === m.id) e.stageCurrentId = "";
        }
        if (act === "withdraw" || act === "delete") {
          e.pinnedMessages = (e.pinnedMessages || []).filter((x) => x.messageId !== m.id);
          broadcast(slug, "pins", pinnedForEvent(e));
        }
        if (act === "stage") {
          m.stageState = "queued";
          m.stageQueuedAt = new Date().toISOString();
          m.stageReadAt = "";
        }
        save();
        if (act === "stage" || act === "stage-remove")
          broadcast(slug, "stage-state", stageSnapshot(e), "stage");
        broadcast(slug, "stage-status", stageSnapshot(e), "moderator");
        broadcast(slug, "message-status", messageEvent(m), "moderator");
        return send(res, 200, {
          message: act === "stage" || act === "stage-remove" ? stageEvent(m) : messageEvent(m),
        });
      }
      if (action === "messages/private" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req),
          text = sanitize(b.text),
          participantId = String(b.participantId || "").slice(0, 80),
          m = participantId
            ? eventMessages(slug).find(
                (x) => x.participantId === participantId && ["private", "question"].includes(x.type),
              )
            : findMessage(b.messageId, slug);
        if (!m || !m.participantId || !["private", "question"].includes(m.type) || !text)
          return send(res, 400, { error: "This private conversation cannot be answered." });
        const now = new Date().toISOString(),
          reply = {
            id: id(),
            slug,
            text,
            author: mod.email,
            type: "private-reply",
            visibility: "private",
            status: "private",
            targetParticipantId: m.participantId,
            createdAt: now,
          };
        addMessage(reply);
        e.privateThreads ||= {};
        e.privateThreads[m.participantId] = {
          ...(e.privateThreads[m.participantId] || {}),
          status: "open",
          updatedAt: now,
          closedAt: "",
          closedBy: "",
        };
        save();
        broadcast(
          slug,
          "private-thread-status",
          { participantId: m.participantId, status: "open", updatedAt: now },
          "moderator",
        );
        sendPrivate(slug, m.participantId, "private", privateView(reply));
        broadcast(slug, "private-reply", messageEvent(reply), "moderator");
        return send(res, 201, { message: messageEvent(reply) });
      }
      if (action === "ban" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req),
          m = findMessage(b.messageId, slug);
        if (!m?.participantId) return send(res, 400, { error: "Participant not found" });
        if (!participantIsBanned(slug, m.participantId))
          state.bans.push({
            id: id(),
            slug,
            participantId: m.participantId,
            by: mod.email,
            at: new Date().toISOString(),
          });
        closeStreams(
          slug,
          (c) => ["guest", "private"].includes(c.role) && c.participantId === m.participantId,
          "banned",
        );
        save();
        broadcast(
          slug,
          "ban-change",
          { participantId: m.participantId, kind: "user", blocked: true },
          "moderator",
        );
        return send(res, 200, { ok: true });
      }
      if (action === "ban-ip" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        if (!TRUST_PROXY)
          return send(res, 409, {
            error:
              "Set TRUST_PROXY=true to enable IP blocking. Use it only behind a reverse proxy that sets X-Forwarded-For.",
          });
        const b = await body(req),
          m = findMessage(b.messageId, slug);
        if (!m) return send(res, 404, { error: "Message not found." });
        if (!m.ipHash)
          return send(res, 400, {
            error:
              "Could not determine the visitor IP address. Enable trusted proxy support if the app is behind a reverse proxy.",
          });
        if (!ipIsBanned(slug, m.ipHash))
          state.bans.push({
            id: id(),
            slug,
            ipHash: m.ipHash,
            name: m.author || "Attendee",
            by: mod.email,
            at: new Date().toISOString(),
          });
        closeStreams(slug, (c) => ["guest", "private"].includes(c.role) && c.ipHash === m.ipHash, "banned");
        save();
        broadcast(slug, "ban-change", { kind: "ip", blocked: true }, "moderator");
        return send(res, 200, { ok: true });
      }
      if (action === "stage" && req.method === "POST") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const b = await body(req),
          text = sanitize(b.text);
        if (!text) return send(res, 400, { error: "Message is empty" });
        const m = {
          id: id(),
          slug,
          text,
          author: mod.email,
          type: b.type === "cue" ? "cue" : "stage",
          visibility: "private",
          status: "stage",
          stageState: "queued",
          stageQueuedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        addMessage(m);
        broadcast(slug, "stage-state", stageSnapshot(e), "stage");
        broadcast(slug, "stage-status", stageSnapshot(e), "moderator");
        return send(res, 201, { message: stageEvent(m) });
      }
      if (action === "stage-access" && req.method === "POST") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can create stage links." });
        e.stageToken = randomToken();
        e.stageAccessExpires = Date.now() + 12 * 3600000;
        save();
        return send(res, 200, {
          url: "/stage/" + encodeURIComponent(slug) + "?access=" + e.stageToken,
          expiresAt: e.stageAccessExpires,
        });
      }
      if (action === "stage-qr" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const access = url.searchParams.get("access") || "";
        if (!stageTokenValid(e, access))
          return send(res, 403, { error: "This stage link has expired. Create a new one." });
        const host = String((TRUST_PROXY && req.headers["x-forwarded-host"]) || req.headers.host || "")
            .split(",")[0]
            .trim(),
          proto = requestIsSecure(req) ? "https" : "http";
        if (!host || /[\s/]/.test(host))
          return send(res, 400, { error: "Could not determine the public host for the QR code." });
        const stageUrl =
            proto +
            "://" +
            host +
            "/stage/" +
            encodeURIComponent(slug) +
            "?access=" +
            encodeURIComponent(access),
          svg = await QRCode.toString(stageUrl, {
            type: "svg",
            margin: 2,
            width: 320,
            errorCorrectionLevel: "M",
          });
        res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" });
        return res.end(svg);
      }
      if (action === "stage-reply" && req.method === "POST") {
        const b = await body(req),
          u = eventAuth(req, e, "stage");
        if (!u && !stageTokenValid(e, b.access)) return send(res, 401, { error: "Access denied" });
        const text = sanitize(b.text);
        if (!text) return send(res, 400, { error: "Message is empty" });
        const m = {
          id: id(),
          slug,
          text,
          author: u?.email || "Speaker",
          type: "stage-reply",
          visibility: "private",
          status: "private",
          createdAt: new Date().toISOString(),
        };
        addMessage(m);
        broadcast(slug, "stage-reply", { ...messageEvent(m), author: m.author }, "moderator");
        return send(res, 201, { message: messageEvent(m) });
      }
      if (action === "moderators" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        return send(res, 200, {
          users: state.users
            .filter(
              (x) => e.moderators.includes(x.id) && (x.role !== "event-owner" || x.ownerEventId === e.id),
            )
            .map((u) => ({
              ...safeUser(u),
              topics: e.moderatorTopics?.[u.id] || [],
              shared: state.events.some((other) => other.id !== e.id && other.moderators.includes(u.id)),
            })),
        });
      }
      if (action === "moderators" && req.method === "POST") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can manage the team." });
        const b = await body(req),
          email = String(b.email || "")
            .trim()
            .toLowerCase(),
          password = String(b.password || ""),
          requestedRole = ["moderator", "stage", "event-owner"].includes(b.role) ? b.role : "moderator";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 12)
          return send(res, 400, {
            error: "Enter a valid email address and a password of at least 12 characters.",
          });
        if (requestedRole === "event-owner" && mod.role !== "owner")
          return send(res, 403, { error: "Only the platform admin can create an event owner." });
        let user = state.users.find((x) => x.email === email);
        if (!user) {
          user = {
            id: id(),
            email,
            role: requestedRole,
            active: true,
            ...(requestedRole === "event-owner" ? { ownerEventId: e.id } : {}),
            ...(await hashAsync(password)),
          };
          state.users.push(user);
        } else if (requestedRole === "event-owner") {
          if (user.role !== "event-owner" || user.ownerEventId !== e.id)
            return send(res, 409, { error: "An event owner account must be unique to this event." });
        } else if (user.role !== requestedRole)
          return send(res, 409, { error: "This account already has a different role." });
        if (user.role === "owner")
          return send(res, 409, { error: "The platform admin cannot be added as a team account." });
        if (user.role === "event-owner" && user.ownerEventId !== e.id)
          return send(res, 409, { error: "This account belongs to another event." });
        if (!e.moderators.includes(user.id)) e.moderators.push(user.id);
        e.moderatorTopics ||= {};
        if (user.role === "moderator")
          e.moderatorTopics[user.id] = [
            ...new Set(
              String(b.topics || "")
                .split(",")
                .map((x) => sanitize(x, 60))
                .filter(Boolean),
            ),
          ].slice(0, 20);
        save();
        return send(res, 201, { user: { ...safeUser(user), topics: e.moderatorTopics[user.id] || [] } });
      }
      const teamPatch = action.match(/^moderators\/([^/]+)$/);
      if (teamPatch && req.method === "PATCH") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can manage the team." });
        const user = state.users.find(
          (x) => x.id === decodeURIComponent(teamPatch[1]) && e.moderators.includes(x.id),
        );
        if (!user) return send(res, 404, { error: "Team account not found." });
        if (
          user.role === "owner" ||
          (user.role === "event-owner" && (mod.role !== "owner" || user.ownerEventId !== e.id))
        )
          return send(res, 403, { error: "This account cannot be edited here." });
        const b = await body(req),
          sharedElsewhere = state.events.some(
            (other) => other.id !== e.id && other.moderators.includes(user.id),
          );
        if (
          mod.role === "event-owner" &&
          sharedElsewhere &&
          ["email", "password", "role", "active"].some((k) => b[k] !== undefined)
        )
          return send(res, 403, {
            error:
              "This account is also used in another event. Ask the platform admin to change its login or access settings.",
          });
        if (b.email !== undefined) {
          const email = String(b.email || "")
            .trim()
            .toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
            return send(res, 400, { error: "Enter a valid email address." });
          if (state.users.some((x) => x.id !== user.id && x.email === email))
            return send(res, 409, { error: "That email address is already in use." });
          if (user.email !== email) {
            user.email = email;
            revokeUserAccess(user.id);
          }
        }
        if (b.password) {
          const password = String(b.password);
          if (password.length < 12)
            return send(res, 400, { error: "Passwords must be at least 12 characters." });
          Object.assign(user, await hashAsync(password));
          revokeUserAccess(user.id);
        }
        if (b.role !== undefined) {
          if (!["moderator", "stage", "event-owner"].includes(b.role))
            return send(res, 400, { error: "Choose a valid team role." });
          if (b.role === "event-owner") {
            if (mod.role !== "owner")
              return send(res, 403, { error: "Only the platform admin can assign an event owner." });
            const otherEvents = state.events.some((x) => x.id !== e.id && x.moderators.includes(user.id));
            if (otherEvents)
              return send(res, 409, {
                error: "Remove this account from its other events before making it an event owner.",
              });
            user.role = "event-owner";
            user.ownerEventId = e.id;
          } else {
            user.role = b.role;
            delete user.ownerEventId;
          }
          revokeUserAccess(user.id);
        }
        if (typeof b.active === "boolean" && user.active !== b.active) {
          user.active = b.active;
          revokeUserAccess(user.id);
        }
        if (b.topics !== undefined) {
          const values = Array.isArray(b.topics) ? b.topics : String(b.topics || "").split(",");
          e.moderatorTopics ||= {};
          e.moderatorTopics[user.id] = [...new Set(values.map((x) => sanitize(x, 60)).filter(Boolean))].slice(
            0,
            20,
          );
        }
        save();
        return send(res, 200, { user: { ...safeUser(user), topics: e.moderatorTopics?.[user.id] || [] } });
      }
      if (action === "moderators" && req.method === "DELETE") {
        if (!canManageEvent(mod, e))
          return send(res, 403, { error: "Only the event owner can manage the team." });
        const b = await body(req),
          user = state.users.find((x) => x.id === b.userId);
        if (
          !user ||
          user.role === "owner" ||
          (user.role === "event-owner" && (mod.role !== "owner" || user.ownerEventId !== e.id))
        )
          return send(res, 403, { error: "This account cannot be removed from the team." });
        e.moderators = e.moderators.filter((x) => x !== b.userId);
        revokeUserStreams(b.userId, slug);
        if (e.moderatorTopics) delete e.moderatorTopics[b.userId];
        for (const m of eventMessages(slug)) if (m.assignedTo === b.userId) m.assignedTo = "";
        save();
        return send(res, 200, { ok: true });
      }
      if (action === "export" && req.method === "GET") {
        if (!mod) return send(res, 401, { error: "Access denied" });
        const rows = eventMessages(slug);
        const csv = [
          "time,type,status,stage_status,topic,assigned_to,name,language,message",
          ...rows.map((m) =>
            [
              m.createdAt,
              m.type,
              m.status,
              m.stageState || "",
              m.topic || "",
              m.assignedTo || "",
              m.author,
              m.language || "",
              m.text,
            ]
              .map((x) => {
                let v = String(x || "");
                if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
                return '"' + v.replaceAll('"', '""') + '"';
              })
              .join(","),
          ),
        ].join("\n");
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="' + slug + '-chat.csv"',
        });
        return res.end(csv);
      }
      return send(res, 404, { error: "Not found" });
    }
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    const spa = /^\/(e|stage|moderator|private)\/[^/]+\/?$/.test(url.pathname),
      file = path.join(
        PUBLIC_DIR,
        url.pathname === "/" || spa ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, ""),
      );
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: "Forbidden" });
    const asset = staticAssets.get(file);
    if (!asset) return send(res, 404, { error: "Not found" });
    // Browsers revalidate (no-cache) and get 304 when nothing changed.
    const headers = {
      "content-type": asset.type,
      "cache-control": "no-cache",
      etag: asset.etag,
      vary: "Accept-Encoding",
    };
    if (String(req.headers["if-none-match"] || "") === asset.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const accept = String(req.headers["accept-encoding"] || "");
    const [encoding, data] = /\bbr\b/.test(accept)
      ? ["br", asset.br]
      : /\bgzip\b/.test(accept)
        ? ["gzip", asset.gzip]
        : ["", asset.raw];
    res.writeHead(200, {
      ...headers,
      ...(encoding ? { "content-encoding": encoding } : {}),
      "content-length": data.length,
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (err) {
    if (!(err instanceof SyntaxError) && err.message !== "Request too large") console.error(err);
    if (!res.headersSent)
      send(res, 400, {
        error: err.message === "Request too large" ? "Request too large." : "Invalid request.",
      });
    else res.end();
  }
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0; // SSE connections are long-lived.
server.listen({ port: PORT, host: "0.0.0.0", backlog: LISTEN_BACKLOG }, () =>
  console.log("8star Chat listening on " + PORT),
);

// Periodic metrics line in the container log (METRICS_LOG_SECONDS > 0).
// Contains counts and timings only.
if (METRICS_LOG_SECONDS > 0) {
  let lastCpu = process.cpuUsage(),
    lastElu = performance.eventLoopUtilization(),
    lastAt = performance.now();
  setInterval(() => {
    const now = performance.now(),
      cpu = process.cpuUsage(lastCpu),
      elu = performance.eventLoopUtilization(lastElu),
      mem = process.memoryUsage();
    let guests = 0,
      staff = 0,
      privateStreams = 0,
      queued = 0;
    for (const r of rooms.values()) {
      guests += r.guest.size;
      staff += r.moderator.size + r.stage.size;
      privateStreams += r.private.size;
      queued += r.outbox.length;
    }
    const line = {
      metrics: {
        at: new Date().toISOString(),
        seconds: +((now - lastAt) / 1000).toFixed(1),
        loopDelayMs: {
          p50: +(loopDelay.percentile(50) / 1e6).toFixed(1),
          p99: +(loopDelay.percentile(99) / 1e6).toFixed(1),
          max: +(loopDelay.max / 1e6).toFixed(1),
        },
        loopUtilization: +elu.utilization.toFixed(3),
        cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100),
        rssMB: Math.round(mem.rss / 1048576),
        heapMB: Math.round(mem.heapUsed / 1048576),
        connections: { guests, privateStreams, staff, total: connectionCount },
        attendeeSessions: guestSessions.size,
        counters: metrics.counters,
        postMs: {
          admission: metrics.post.admission.summary(),
          storage: metrics.post.commit.summary(),
          total: metrics.post.total.summary(),
        },
        joinMs: metrics.join.summary(),
        fanout: {
          batchMs: metrics.fanout.flush.summary(),
          events: metrics.fanout.events,
          writes: metrics.fanout.writes,
          queuedNow: queued,
          maxQueued: metrics.fanout.maxQueued,
          maxBufferedKB: metrics.fanout.maxBufferedKB,
          slowClientsDropped: metrics.fanout.slowDrops,
        },
        journal: {
          writeMs: metrics.journal.write.summary(),
          messagesPerWrite: metrics.journal.size.summary(),
          errors: metrics.journal.errors,
          pendingNow: journal.pending,
        },
        snapshots: metrics.snapshots,
      },
    };
    console.log(JSON.stringify(line));
    loopDelay.reset();
    metrics.counters = {};
    metrics.post.admission.reset();
    metrics.post.commit.reset();
    metrics.post.total.reset();
    metrics.join.reset();
    metrics.fanout.flush.reset();
    Object.assign(metrics.fanout, { events: 0, writes: 0, slowDrops: 0, maxQueued: 0, maxBufferedKB: 0 });
    metrics.journal.write.reset();
    metrics.journal.size.reset();
    metrics.journal.errors = 0;
    metrics.snapshots = 0;
    lastCpu = process.cpuUsage();
    lastElu = performance.eventLoopUtilization();
    lastAt = now;
  }, METRICS_LOG_SECONDS * 1000).unref();
}

// Write pending data before the container stops.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Received " + signal + ", saving data and closing connections.");
  try {
    stateStore.flushSync();
    guestStore.flushSync();
  } catch (err) {
    console.error("Could not save data during shutdown:", err.message);
  }
  closeStreams("", () => true, "server-restart");
  server.close();
  // Let a journal write that is in progress finish, then stop.
  journal.idle().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
