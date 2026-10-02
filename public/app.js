const app = document.querySelector("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
// ---- Search helpers ----------------------------------------------------------
// Case- and accent-insensitive ("cafe" finds "Café"); every word of the query
// must occur. The same rules are used by the server for the public chat.
const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
const searchTerms = (q) => [...new Set(fold(q).split(/\s+/).filter(Boolean))].slice(0, 8);
const matchesAll = (terms, ...fields) => {
  if (!terms.length) return true;
  const hay = fold(fields.filter(Boolean).join("\n"));
  return terms.every((t) => hay.includes(t));
};
// Escaped HTML of `text` with every occurrence of a term wrapped in <mark>.
const highlight = (text, terms) => {
  const raw = String(text ?? "");
  if (!terms?.length) return esc(raw);
  // Folded copy of the text plus, per folded character, its range in `raw`.
  let folded = "";
  const from = [],
    to = [];
  let pos = 0;
  for (const ch of raw) {
    for (const c of fold(ch)) {
      folded += c;
      from.push(pos);
      to.push(pos + ch.length);
    }
    pos += ch.length;
  }
  const ranges = [];
  for (const t of terms) {
    let i = folded.indexOf(t);
    while (t && i !== -1) {
      ranges.push([from[i], to[i + t.length - 1]]);
      i = folded.indexOf(t, i + t.length);
    }
  }
  if (!ranges.length) return esc(raw);
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "",
    last = 0;
  for (const [a, b] of ranges) {
    if (b <= last) continue;
    const start = Math.max(a, last);
    out += esc(raw.slice(last, start)) + "<mark>" + esc(raw.slice(start, b)) + "</mark>";
    last = b;
  }
  return out + esc(raw.slice(last));
};
// CSRF token of the current staff or attendee session. Kept in memory only.
let csrfToken = "";
// opts.timeoutMs aborts a request that gets no answer; the error then has
// status 0, like any other network failure (the outcome is unknown).
const api = async (url, opts = {}) => {
  const { timeoutMs, ...fetchOpts } = opts;
  const controller = timeoutMs ? new AbortController() : null,
    timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let r;
  try {
    r = await fetch(url, {
      credentials: "same-origin",
      ...fetchOpts,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        "content-type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        ...(fetchOpts.headers || {}),
      },
    });
  } catch {
    throw Object.assign(Error("The connection was interrupted."), { status: 0 });
  } finally {
    clearTimeout(timer);
  }
  let d;
  try {
    d = (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.text();
  } catch {
    d = null;
  }
  if (!r.ok)
    throw Object.assign(Error(d?.error || "Error " + r.status), {
      status: r.status,
      retryAfter: Number(r.headers.get("retry-after")) || d?.retryAfter || 0,
      data: d,
    });
  return d;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const newClientId = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const storage = {
  get(store, key) {
    try {
      return window[store].getItem(key);
    } catch {
      return null;
    }
  },
  set(store, key, value) {
    try {
      window[store].setItem(key, value);
    } catch {}
  },
  remove(store, key) {
    try {
      window[store].removeItem(key);
    } catch {}
  },
};
const route = () => {
  const parts = location.pathname.split("/").filter(Boolean);
  return {
    kind:
      parts[0] === "e"
        ? "public"
        : parts[0] === "moderator"
          ? "moderator"
          : parts[0] === "stage"
            ? "stage"
            : parts[0] === "private"
              ? "private"
              : "home",
    slug: parts[1] ? decodeURIComponent(parts[1]) : "",
  };
};
// Theme: light, dark or auto (follows the device). An embedding page can pass
// ?theme=light|dark|auto (and ?lang=en|nl|de|fr, see i18n.js); the choice is
// remembered, and the Dark/Light mode button still overrides it.
const themeKey = "8star-theme",
  darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)"),
  resolveTheme = (t) =>
    t === "auto" ? (darkQuery?.matches ? "dark" : "light") : t === "dark" ? "dark" : "light",
  setTheme = (theme) => {
    document.documentElement.dataset.theme = resolveTheme(theme);
    storage.set("localStorage", themeKey, theme);
  };
{
  const requested = new URLSearchParams(location.search).get("theme");
  setTheme(
    ["light", "dark", "auto"].includes(requested)
      ? requested
      : storage.get("localStorage", themeKey) || "light",
  );
  darkQuery?.addEventListener?.("change", () => {
    if (storage.get("localStorage", themeKey) === "auto") setTheme("auto");
  });
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("#theme-toggle");
  if (b) {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(theme);
    b.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
});
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    const old = b.textContent;
    b.textContent = "Copied";
    setTimeout(() => {
      if (b.isConnected) b.textContent = old;
    }, 1800);
  } catch {
    b.textContent = "Copy failed";
    setTimeout(() => {
      if (b.isConnected) b.textContent = "Copy";
    }, 1800);
  }
});
const header = (right) =>
  '<header class="topbar"><div class="brand-mark"><div class="mark">8</div><div class="brand">8star <span>Chat</span></div></div><div class="toolbar">' +
  (right || "") +
  window.chatI18n.picker() +
  '<button type="button" class="secondary small" id="theme-toggle">' +
  (document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode") +
  "</button></div></header>";
const time = (t) =>
    new Date(t).toLocaleTimeString(window.chatI18n.language, { hour: "2-digit", minute: "2-digit" }),
  eventApi = (s) => "/api/events/" + encodeURIComponent(s),
  logo = (b) =>
    b?.logo
      ? '<img alt="" src="' + esc(b.logo) + '" style="max-width:150px;max-height:48px;object-fit:contain">'
      : "";
const modeName = (m) => (m === "open" ? "Open" : m === "readonly" ? "Read-only" : "Moderated");
const roleName = (r) =>
  r === "owner"
    ? "Platform admin"
    : r === "event-owner"
      ? "Event owner"
      : r === "moderator"
        ? "Moderator"
        : "Stage monitor";
const statusName = (s) =>
  ({ open: "Open", closed: "Closed", queued: "Queued", read: "Read", removed: "Removed" })[s] || s;
function login() {
  app.innerHTML =
    '<main class="center"><section class="card login">' +
    header("") +
    '<h2>Sign in</h2><p class="muted">Sign in to manage events.</p><form id="login"><label>Email address</label><input type="email" name="email" autocomplete="username" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><div class="error" id="error"></div><button class="form-actions">Sign in</button></form></section></main>';
  document.querySelector("#login").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const d = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(ev.target))),
      });
      csrfToken = d.csrf;
      homePage();
    } catch (e) {
      document.querySelector("#error").textContent = e.message;
    }
  };
}
async function homePage() {
  let me;
  try {
    const d = await api("/api/me");
    me = d.user;
    csrfToken = d.csrf;
  } catch {
    return login();
  }
  const { events } = await api("/api/events");
  const createCard =
    me.role === "owner"
      ? '<section class="grid"><div class="card"><h2>New event</h2><form id="create"><label>Event name</label><input name="title" placeholder="Annual conference 2026" required><div class="row"><div><label>Maximum participants</label><input name="capacity" type="number" min="1" max="20000" value="10000"></div><div><label>Chat mode</label><select name="mode"><option value="moderated">Moderated</option><option value="readonly">Read-only</option><option value="open">Open</option></select></div></div><div class="hint">Moderated: approve before public. Read-only: attendees can only view. Open: public messages go live immediately.</div><button class="form-actions">Create event</button><div class="error" id="create-error"></div></form></div><div class="card"><h2>Included</h2><p class="muted">Moderation queue and archive, private conversations, speaker question queue, topic assignments, and a secure speaker link.</p><span class="pill">White-label for each event</span></div></section>'
      : "";
  app.innerHTML =
    '<main class="wrap">' +
    header('<button class="secondary small" id="logout">Sign out</button>') +
    '<div class="dash-head"><div><span class="pill">Dashboard</span><h1 style="margin-top:12px">Your events</h1><div class="muted"><span data-user-content>' +
    esc(me.email) +
    "</span> · " +
    esc(roleName(me.role)) +
    "</div></div></div>" +
    createCard +
    '<section class="card" style="margin-top:18px"><h2>Events</h2><div>' +
    (events.length
      ? events
          .map(
            (e) =>
              '<div class="event"><div><b data-user-content>' +
              esc(e.title) +
              '</b><div class="muted"><span data-user-content>' +
              esc(e.slug) +
              "</span> · " +
              e.capacity.toLocaleString() +
              " participants · " +
              modeName(e.mode) +
              '</div></div><div class="toolbar"><a href="/e/' +
              encodeURIComponent(e.slug) +
              '"><button class="secondary small">Go to public chat</button></a><a href="/moderator/' +
              encodeURIComponent(e.slug) +
              '"><button class="small">Moderate</button></a>' +
              (me.role === "moderator"
                ? ""
                : '<a href="/stage/' +
                  encodeURIComponent(e.slug) +
                  '" target="_blank" rel="noreferrer"><button class="secondary small">Stage login</button></a>') +
              '<button class="secondary small" data-copy="<iframe src=&quot;' +
              location.origin +
              "/e/" +
              esc(e.slug) +
              '&quot; style=&quot;width:100%;height:650px;border:0&quot; title=&quot;Live chat&quot;></iframe>">Copy embed code</button></div></div>',
          )
          .join("")
      : '<div class="empty">No events yet.</div>') +
    "</div></section></main>";
  document.querySelector("#logout").onclick = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    csrfToken = "";
    login();
  };
  document.querySelector("#create")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = Object.fromEntries(new FormData(ev.target));
    if (
      form.mode === "open" &&
      !confirm("Open mode makes every public attendee message visible immediately. Continue?")
    )
      return;
    try {
      await api("/api/events", { method: "POST", body: JSON.stringify(form) });
      homePage();
    } catch (e) {
      document.querySelector("#create-error").textContent = e.message;
    }
  });
}
// ---------------------------------------------------------------------------
// Attendee pages: public chat and PIN-protected private conversation
// ---------------------------------------------------------------------------
// The attendee session lives in an HttpOnly cookie set by the server. Only
// when the browser blocks that cookie (e.g. a third-party iframe in Safari)
// is the session token kept in sessionStorage of this tab as a fallback.
// The private unlock token is only ever kept in memory.
const guestTokenKey = (s) => "8star-guest-session:" + s,
  privateTokens = new Map();
let activeStream = null;
const stopStream = () => {
  activeStream?.close();
  activeStream = null;
};
const guestHeaders = (s) => {
  const token = storage.get("sessionStorage", guestTokenKey(s));
  return token ? { "x-guest-session": token } : {};
};
const guestApi = (s, action, opts = {}) =>
  api(eventApi(s) + "/" + action, { ...opts, headers: { ...guestHeaders(s), ...(opts.headers || {}) } });
const privateHeaders = (s) => ({ "x-private-token": privateTokens.get(s) || "" });
async function loadGuestSession(s, light = false) {
  try {
    const d = await guestApi(s, "session" + (light ? "?light=1" : ""));
    csrfToken = d.csrf;
    return d;
  } catch (e) {
    if (e.status === 401) {
      storage.remove("sessionStorage", guestTokenKey(s));
      return null;
    }
    throw e;
  }
}
// The join answer includes the history and the first stream ticket, so the
// chat can open without further requests (handed over through joinedNow).
const joinedNow = new Map();
async function joinChat(s, details) {
  const d = await guestApi(s, "join", { method: "POST", body: JSON.stringify(details) });
  csrfToken = d.csrf;
  try {
    await guestApi(s, "session?light=1");
    joinedNow.set(s, d);
    return d;
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  // The cookie was not stored: use the per-tab fallback.
  const fallback = await api(eventApi(s) + "/join", {
    method: "POST",
    body: JSON.stringify({ ...details, cookieless: true }),
  });
  storage.set("sessionStorage", guestTokenKey(s), fallback.sessionToken);
  csrfToken = fallback.csrf;
  joinedNow.set(s, fallback);
  return fallback;
}
// Send a message so that it is placed at most once: the same clientMessageId
// is reused for every retry, and after an unknown outcome (time-out, lost
// connection, 502/504) the server is asked what happened first.
async function sendChatMessage(s, payload, headers = {}, onRetry = () => {}) {
  const clientMessageId = newClientId(),
    body = JSON.stringify({ ...payload, clientMessageId });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await guestApi(s, "messages", { method: "POST", body, headers, timeoutMs: 15000 });
    } catch (e) {
      // A definite answer (400/401/403/409/429): nothing more to do.
      if (e.status >= 400 && e.status < 500) throw e;
      onRetry();
      if (e.status === 503) {
        // Refused before storing; safe to retry after the advised wait.
        await sleep(Math.min(10, e.retryAfter || 2) * 1000);
        continue;
      }
      try {
        const st = await guestApi(
          s,
          "messages/status?clientMessageId=" + encodeURIComponent(clientMessageId),
          {
            timeoutMs: 10000,
          },
        );
        if (st.status === "accepted")
          return { ok: true, recovered: true, status: st.message.status, message: st.message };
      } catch {}
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw Error("Your message could not be sent. Please try again.");
}
async function leaveChat(s) {
  try {
    await guestApi(s, "session/end", { method: "POST", body: "{}" });
  } catch {}
  storage.remove("sessionStorage", guestTokenKey(s));
  privateTokens.delete(s);
  csrfToken = "";
}
// EventSource with one-time tickets. On every (re)connect a fresh ticket is
// requested, so no reusable secret ever appears in a URL.
function openStream(getUrl, handlers, { onFatal, onReconnect } = {}) {
  let es = null,
    closed = false,
    delay = 1000,
    timer = null;
  const retry = () => {
    if (closed) return;
    onReconnect?.();
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
  const connect = async () => {
    if (closed) return;
    let url;
    try {
      url = await getUrl();
    } catch (e) {
      if ([401, 403, 423].includes(e.status)) {
        closed = true;
        return onFatal?.(e);
      }
      return retry();
    }
    if (closed) return;
    es = new EventSource(url);
    es.addEventListener("ready", () => {
      delay = 1000;
    });
    for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, fn);
    es.onerror = () => {
      es.close();
      retry();
    };
  };
  connect();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      es?.close();
    },
  };
}
const ticketUrl = async (s, scope) => {
  const d = await guestApi(s, "stream-ticket", {
    method: "POST",
    body: JSON.stringify({ scope }),
    headers: scope === "private" ? privateHeaders(s) : {},
  });
  return eventApi(s) + "/stream?ticket=" + encodeURIComponent(d.ticket);
};
const localeBar = () => '<div class="public-locale">' + window.chatI18n.picker() + "</div>";
const showCenter = (message) => {
  app.innerHTML = localeBar() + '<div class="center">' + esc(message) + "</div>";
};
async function publicPage(s) {
  if (!s) return;
  let event;
  try {
    event = (await api(eventApi(s))).event;
  } catch (e) {
    return showCenter(e.message);
  }
  if (event.chatEnabled === false) return showCenter("Chat is disabled.");
  let session = joinedNow.get(s);
  joinedNow.delete(s);
  try {
    session ||= await loadGuestSession(s);
    if (!session && event.mode === "readonly") {
      session = await joinChat(s, { name: "Guest" });
      joinedNow.delete(s);
    }
  } catch (e) {
    return showCenter(e.message);
  }
  if (!session) return joinForm(s, event);
  let firstTicket = session.ticket || "";
  event = session.event || event;
  const readOnly = event.mode === "readonly",
    privateEnabled = event.privateMessagesEnabled !== false;
  app.innerHTML =
    '<main class="chat-shell public-chat"><div class="chat-head"><div class="chat-title">' +
    logo(event.branding) +
    "<b data-user-content>" +
    esc(event.title) +
    '</b><div class="muted chat-meta">' +
    (readOnly ? "Read-only · You can view the live chat" : "Public chat · " + modeName(event.mode)) +
    '</div></div><div class="chat-actions"><button type="button" class="icon-button" id="search-toggle" aria-expanded="false" aria-controls="chat-search" aria-label="Search messages" title="Search messages"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button>' +
    (privateEnabled
      ? '<a class="to-moderator" href="/private/' +
        encodeURIComponent(s) +
        '" data-nav title="Private message to the moderators">To moderator</a>'
      : "") +
    '</div></div><form class="chat-search" id="chat-search" role="search" hidden><input type="search" name="q" maxlength="100" autocomplete="off" enterkeyhint="search" aria-label="Search messages" placeholder="Search messages…"><button type="button" class="secondary small" id="close-search">Close</button></form><div class="chat-subbar">' +
    window.chatI18n.picker() +
    '<span class="pill" id="capacity">Live chat</span>' +
    (readOnly
      ? ""
      : '<span class="chat-identity muted">Signed in as <b data-user-content>' +
        esc(session.name) +
        '</b></span><button type="button" class="link-button" id="leave-chat">Not you? Leave chat</button>') +
    '</div><div class="pinned-messages" id="pinned-messages"></div><div class="chat-body"><div class="messages" id="messages" aria-live="polite"></div><div class="messages search-results" id="search-results" aria-live="polite" hidden></div><button type="button" class="jump-latest" id="jump-latest" hidden><span>New messages</span> <b id="jump-count"></b></button></div>' +
    (!readOnly
      ? '<div class="notice" id="notice"></div><form class="composer" id="send"><input name="text" maxlength="500" autocomplete="off" aria-label="Public message" placeholder="Write a public message…"><button>Send</button></form>'
      : '<div class="notice" id="notice">This event is read-only.</div>') +
    "</main>";
  const publicBox = document.querySelector("#messages"),
    pinBox = document.querySelector("#pinned-messages"),
    resultsBox = document.querySelector("#search-results"),
    searchForm = document.querySelector("#chat-search"),
    searchToggle = document.querySelector("#search-toggle"),
    jump = document.querySelector("#jump-latest"),
    notice = document.querySelector("#notice");
  const bubble = (m, terms) =>
    '<article class="bubble" data-id="' +
    esc(m.id) +
    '"><strong data-user-content>' +
    highlight(m.author || "", terms) +
    "</strong><p>" +
    highlight(m.text, terms) +
    "</p><time>" +
    time(m.createdAt) +
    "</time></article>";
  // The live list follows new messages only while the reader is at the
  // bottom; someone scrolled up to read keeps their place and gets a
  // "New messages" button. At most MAX_SHOWN messages stay on the page (older
  // ones remain findable with search), so a long, busy event stays fast on
  // phones. While someone reads back, nothing above them is removed (up to
  // MAX_READING); the list is trimmed when they return to the bottom.
  const MAX_SHOWN = 300,
    MAX_READING = 1000;
  let unseen = 0;
  const nearBottom = () => publicBox.scrollHeight - publicBox.scrollTop - publicBox.clientHeight < 80;
  const trim = (limit, keepPlace) => {
    while (publicBox.children.length > limit) {
      const first = publicBox.firstElementChild,
        h = first.offsetHeight;
      first.remove();
      if (keepPlace) publicBox.scrollTop -= h;
    }
  };
  const toBottom = () => {
    trim(MAX_SHOWN, false);
    publicBox.scrollTop = publicBox.scrollHeight;
    unseen = 0;
    jump.hidden = true;
  };
  publicBox.addEventListener("scroll", () => {
    if (nearBottom() && unseen) toBottom();
  });
  jump.addEventListener("click", toBottom);
  const add = (m, initial = false) => {
    if (!m || publicBox.querySelector('[data-id="' + CSS.escape(m.id) + '"]')) return;
    const follow = initial || nearBottom();
    publicBox.insertAdjacentHTML("beforeend", bubble(m));
    if (follow) toBottom();
    else {
      trim(MAX_READING, true);
      unseen++;
      document.querySelector("#jump-count").textContent = unseen > 99 ? "99+" : String(unseen);
      jump.hidden = false;
    }
  };
  // ---- Search in all published messages of this event (server side) ----
  let searchSeq = 0,
    searchTimer = null;
  const showLive = () => {
    resultsBox.hidden = true;
    resultsBox.innerHTML = "";
    publicBox.hidden = false;
    pinBox.classList.remove("searching");
    toBottom();
  };
  const runSearch = async (q, seq, retried = false) => {
    const terms = searchTerms(q);
    try {
      const d = await guestApi(s, "search?q=" + encodeURIComponent(q), { timeoutMs: 10000 });
      if (seq !== searchSeq) return;
      resultsBox.innerHTML =
        '<div class="search-summary"><span>Search results</span> <span class="pill">' +
        (d.more ? d.total.toLocaleString() + "+" : d.total.toLocaleString()) +
        "</span>" +
        (d.total > d.results.length ? '<div class="hint">Showing the 50 most recent results.</div>' : "") +
        "</div>" +
        (d.results.length
          ? d.results.map((m) => bubble(m, terms)).join("")
          : '<div class="empty">No messages found.</div>');
      resultsBox.scrollTop = 0;
    } catch (e) {
      if (seq !== searchSeq) return;
      if (e.status === 429 && !retried) {
        await sleep(800);
        if (seq === searchSeq) return runSearch(q, seq, true);
        return;
      }
      if (e.status === 401) return render();
      resultsBox.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  };
  const onSearchInput = () => {
    const q = searchForm.elements.q.value.trim(),
      seq = ++searchSeq;
    clearTimeout(searchTimer);
    if (searchTerms(q).join("").length < 2) {
      if (q) {
        publicBox.hidden = true;
        resultsBox.hidden = false;
        pinBox.classList.add("searching");
        resultsBox.innerHTML = '<div class="empty">Type at least 2 characters.</div>';
      } else showLive();
      return;
    }
    publicBox.hidden = true;
    resultsBox.hidden = false;
    pinBox.classList.add("searching");
    jump.hidden = true;
    searchTimer = setTimeout(() => runSearch(q, seq), 300);
  };
  const closeSearch = () => {
    searchSeq++;
    clearTimeout(searchTimer);
    searchForm.reset();
    searchForm.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    searchForm.closest(".chat-shell").classList.remove("search-open");
    showLive();
  };
  searchToggle.addEventListener("click", () => {
    if (!searchForm.hidden) return closeSearch();
    searchForm.hidden = false;
    searchToggle.setAttribute("aria-expanded", "true");
    searchForm.closest(".chat-shell").classList.add("search-open");
    searchForm.elements.q.focus();
  });
  searchForm.elements.q.addEventListener("input", onSearchInput);
  searchForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSearchInput();
  });
  searchForm.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeSearch();
  });
  document.querySelector("#close-search").addEventListener("click", closeSearch);
  const renderPins = (pins) => {
    const valid = (pins || []).slice(0, 5);
    pinBox.hidden = !valid.length;
    pinBox.innerHTML = valid
      .map(
        (m) =>
          '<article class="pinned-bubble" style="--pin-color:' +
          esc(m.color || "#111111") +
          '"><div class="pinned-label">Pinned message</div><strong data-user-content>' +
          esc(m.author || "") +
          "</strong><p>" +
          esc(m.text) +
          "</p></article>",
      )
      .join("");
  };
  (session.history || []).forEach((m) => add(m, true));
  renderPins(event.pinnedMessages);
  let firstReady = true;
  document.querySelector("#leave-chat")?.addEventListener("click", async () => {
    stopStream();
    await leaveChat(s);
    joinForm(s, event);
  });
  document.querySelector("#send")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target,
      input = form.elements.text,
      button = form.querySelector("button");
    if (!input.value.trim() || button.disabled) return;
    button.disabled = true;
    notice.textContent = "Sending…";
    try {
      const d = await sendChatMessage(s, { text: input.value, kind: "public" }, {}, () => {
        notice.textContent = "Sending…";
      });
      notice.textContent =
        d.status === "published"
          ? "Your message is now public."
          : "Your message is awaiting moderator approval.";
      input.value = "";
      // Sending means you want to see the conversation: back to the latest.
      if (publicBox.hidden) closeSearch();
      else toBottom();
    } catch (e) {
      notice.textContent = e.message;
      if (e.status === 401) setTimeout(() => render(), 1500);
    } finally {
      button.disabled = false;
    }
  });
  const endAccess = (message) => {
    stopStream();
    notice.textContent = message;
    document.querySelector("#send")?.remove();
  };
  activeStream = openStream(
    () => {
      // First connection uses the ticket from the join; reconnects get a new one.
      if (!firstTicket) return ticketUrl(s, "public");
      const url = eventApi(s) + "/stream?ticket=" + encodeURIComponent(firstTicket);
      firstTicket = "";
      return Promise.resolve(url);
    },
    {
      ready: (ev) => {
        const d = JSON.parse(ev.data);
        (d.history || []).forEach((m) => add(m, firstReady));
        firstReady = false;
        renderPins(d.pins || []);
        document.querySelector("#capacity").textContent = d.connections.toLocaleString() + " connected";
        if (notice.textContent === window.chatI18n.text("Reconnecting…")) notice.textContent = "";
      },
      public: (ev) => add(JSON.parse(ev.data)),
      pins: (ev) => renderPins(JSON.parse(ev.data)),
      remove: (ev) => {
        const sel = '[data-id="' + CSS.escape(JSON.parse(ev.data).id) + '"]';
        publicBox.querySelector(sel)?.remove();
        resultsBox.querySelector(sel)?.remove();
      },
      settings: (ev) => {
        const d = JSON.parse(ev.data);
        if ((d.privateMessagesEnabled !== false) !== privateEnabled || d.mode !== event.mode) render();
      },
      banned: () => endAccess("You no longer have access to this chat."),
      "session-ended": () => {
        stopStream();
        render();
      },
    },
    {
      onFatal: (e) => (e.status === 401 ? render() : endAccess(e.message)),
      onReconnect: () => {
        notice.textContent = "Reconnecting…";
      },
    },
  );
}
function joinForm(s, event) {
  app.innerHTML =
    '<div class="chat-shell"><div class="public-locale">' +
    window.chatI18n.picker() +
    '</div><section class="join">' +
    logo(event.branding) +
    "<h2 data-user-content>" +
    esc(event.title) +
    '</h2><p class="muted">Enter your name to join.</p><form id="join"><label>Name</label><input name="name" maxlength="40" placeholder="Your name" autocomplete="off" required><label>Your language (optional)</label><input name="language" maxlength="40" placeholder="Any language"><small class="hint">You can leave this blank. Messages in any language are accepted.</small><div class="error" id="join-error"></div><button style="width:100%;margin-top:14px">Join chat</button></form></section></div>';
  document.querySelector("#join").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      await joinChat(s, { name: f.name, language: f.language });
      render();
    } catch (e) {
      document.querySelector("#join-error").textContent = e.message;
    }
  };
}
async function privatePage(s) {
  if (!s) return;
  let event, session;
  try {
    event = (await api(eventApi(s))).event;
    session = await loadGuestSession(s, true);
  } catch (e) {
    return showCenter(e.message);
  }
  const backLink =
    '<a class="secondary small action-link" href="/e/' +
    encodeURIComponent(s) +
    '" data-nav>Back to public chat</a>';
  app.innerHTML =
    '<main class="private-window"><header class="private-window-head"><div><span class="pill private-badge">Private</span><h1 data-user-content>' +
    esc(event.title) +
    '</h1><div class="muted">Private conversation with moderators</div></div><div class="toolbar">' +
    window.chatI18n.picker() +
    backLink +
    '</div></header><div id="private-body"></div></main>';
  const bodyBox = document.querySelector("#private-body");
  if (!session) {
    bodyBox.innerHTML =
      '<section class="card"><p class="muted">Join the public chat first to open your private conversation.</p>' +
      backLink +
      "</section>";
    return;
  }
  const canSend = event.privateMessagesEnabled !== false && event.mode !== "readonly";
  const identity =
    '<p class="muted private-identity">Signed in as <b data-user-content>' +
    esc(session.name) +
    '</b> · <button type="button" class="link-button" id="leave-chat">Not you? Leave chat</button></p>';
  const wireLeave = () =>
    document.querySelector("#leave-chat")?.addEventListener("click", async () => {
      stopStream();
      await leaveChat(s);
      navigate("/e/" + encodeURIComponent(s));
    });
  const locked = (message = "") => {
    stopStream();
    privateTokens.delete(s);
    if (session.pinDisabled) {
      bodyBox.innerHTML =
        '<section class="card"><p>Your private conversation is locked. Start a new chat session to continue.</p>' +
        identity +
        "</section>";
      return wireLeave();
    }
    const setting = !session.pinSet;
    bodyBox.innerHTML =
      '<section class="card pin-card"><h2>' +
      (setting ? "Protect your private conversation" : "Enter your PIN") +
      '</h2><p class="muted">' +
      (setting
        ? "Choose a personal PIN or passphrase of at least 6 characters. You need it every time you open this conversation, so other people using this device cannot read it."
        : "Your private conversation is protected with the PIN you chose.") +
      '</p><form id="pin-form"><label>' +
      (setting ? "New PIN or passphrase" : "PIN or passphrase") +
      '</label><input name="pin" type="password" minlength="6" maxlength="64" autocomplete="off" required>' +
      (setting
        ? '<label>Repeat PIN or passphrase</label><input name="repeat" type="password" minlength="6" maxlength="64" autocomplete="off" required>'
        : "") +
      '<div class="error" id="pin-error">' +
      esc(message) +
      '</div><button class="form-actions">' +
      (setting ? "Set PIN and open" : "Open conversation") +
      "</button></form>" +
      identity +
      "</section>";
    wireLeave();
    document.querySelector("#pin-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target)),
        error = document.querySelector("#pin-error");
      if (setting && f.pin !== f.repeat) {
        error.textContent = "The PINs do not match.";
        return;
      }
      try {
        const d = await guestApi(s, setting ? "private/pin" : "private/unlock", {
          method: "POST",
          body: JSON.stringify({ pin: f.pin }),
        });
        session.pinSet = true;
        privateTokens.set(s, d.privateToken);
        unlocked();
      } catch (e) {
        if (e.status === 423) session.pinDisabled = true;
        if (e.status === 423) return locked();
        error.textContent = e.message;
      }
    };
    bodyBox.querySelector("input")?.focus();
  };
  const unlocked = () => {
    bodyBox.innerHTML =
      '<p class="muted private-explainer">Only you and the moderation team can read these messages.</p><div class="private-transcript" id="private-transcript"></div><div class="notice" id="private-notice"></div>' +
      (canSend
        ? '<form class="private-send" id="private-send"><textarea name="text" maxlength="500" aria-label="Private message" placeholder="Write a private message…" required></textarea><button>Send privately</button></form>'
        : '<div class="empty">' +
          (event.mode === "readonly"
            ? "This event is read-only."
            : "Private messages are disabled for this event.") +
          "</div>") +
      '<div class="toolbar private-actions"><button type="button" class="secondary small" id="lock-private">Lock conversation</button></div>' +
      identity;
    wireLeave();
    const box = document.querySelector("#private-transcript"),
      notice = document.querySelector("#private-notice"),
      seen = new Set();
    const add = (m) => {
      if (!m || seen.has(m.id)) return;
      box.querySelector(".empty")?.remove();
      seen.add(m.id);
      const mine = m.type !== "private-reply";
      box.insertAdjacentHTML(
        "beforeend",
        '<article class="private-line ' +
          (mine ? "from-attendee" : "from-moderator") +
          '"><b data-user-content>' +
          esc(mine ? m.author : "Moderator") +
          "</b><p>" +
          esc(m.text) +
          "</p><time>" +
          time(m.createdAt) +
          "</time></article>",
      );
      box.scrollTop = box.scrollHeight;
    };
    document.querySelector("#lock-private").onclick = async () => {
      try {
        await guestApi(s, "private/lock", { method: "POST", body: "{}", headers: privateHeaders(s) });
      } catch {}
      locked();
    };
    activeStream = openStream(
      () => ticketUrl(s, "private"),
      {
        ready: (ev) => {
          const d = JSON.parse(ev.data);
          (d.privateHistory || []).forEach(add);
          if (!seen.size) box.innerHTML = '<div class="empty">Your private conversation is empty.</div>';
          notice.textContent = "";
        },
        private: (ev) => add(JSON.parse(ev.data)),
        "private-locked": () => locked("Locked for your privacy. Enter your PIN to continue."),
        banned: () => {
          stopStream();
          privateTokens.delete(s);
          bodyBox.innerHTML = '<div class="empty">You no longer have access to this chat.</div>';
        },
        "session-ended": () => render(),
      },
      {
        onFatal: (e) =>
          e.status === 403
            ? (bodyBox.innerHTML = '<div class="empty">' + esc(e.message) + "</div>")
            : loadGuestSession(s).then((d) =>
                d ? locked("Locked for your privacy. Enter your PIN to continue.") : render(),
              ),
        onReconnect: () => {
          notice.textContent = "Reconnecting…";
        },
      },
    );
    document.querySelector("#private-send")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = ev.target.elements.text;
      if (!input.value.trim()) return;
      const button = ev.target.querySelector("button");
      if (button.disabled) return;
      button.disabled = true;
      notice.textContent = "Sending…";
      try {
        const d = await sendChatMessage(s, { text: input.value, kind: "private" }, privateHeaders(s));
        // A recovered message carries no text; it arrives on the private stream.
        if (!d.recovered) add(d.message);
        input.value = "";
        notice.textContent = "Your private message has been sent to the moderators.";
      } catch (e) {
        if (e.status === 401) return locked("Locked for your privacy. Enter your PIN to continue.");
        notice.textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
  };
  if (privateTokens.has(s)) unlocked();
  else locked();
}
async function securedPage(type, s) {
  const access = new URLSearchParams(location.search).get("access");
  let me, event;
  if (type === "stage" && access) {
    try {
      event = (await api(eventApi(s))).event;
      return stagePage(event, null, access);
    } catch (e) {
      app.innerHTML = '<div class="center">' + esc(e.message) + "</div>";
      return;
    }
  }
  try {
    const current = await api("/api/me");
    me = current.user;
    csrfToken = current.csrf;
    const d = await api("/api/events");
    event = d.events.find((x) => x.slug === s);
  } catch {
    return login();
  }
  if (!event) {
    app.innerHTML = '<div class="center">Event not found or access denied</div>';
    return;
  }
  if (type === "moderator") return moderatorPage(event, me);
  // The stage screen shows the whole speaker queue: stage accounts and the
  // event owner only (or a secure stage link).
  if (me.role === "moderator") {
    app.innerHTML = '<div class="center">Stage access required.</div>';
    return;
  }
  return stagePage(event, me, "");
}
async function moderatorPage(event, me) {
  const endpoint = eventApi(event.slug),
    canManage = ["owner", "event-owner"].includes(me.role);
  let loaded = await api(endpoint + "/messages"),
    messages = loaded.messages,
    threadStates = loaded.privateThreads || {},
    pins = loaded.pins || [],
    // Team and blocked users are managed by the event owner; a moderator only
    // works on what is assigned to them.
    team = canManage ? (await api(endpoint + "/moderators")).users : [],
    bans = canManage ? (await api(endpoint + "/bans")).bans : [],
    trustProxy = loaded.trustProxy;
  try {
    Object.assign(event, (await api(endpoint + "/settings")).event);
  } catch {}
  let tab = "inbox",
    privateStatus = "open",
    privatePage = 0,
    query = "",
    terms = [],
    assigneeFilter = "";
  // Long lists are shown in steps, so a busy event stays quick on an iPad.
  const STEP = 50,
    shown = { inbox: STEP, archive: STEP };
  const moreButton = (list, total) =>
    total > shown[list]
      ? '<div class="show-more"><button type="button" class="secondary" data-more="' +
        list +
        '">Show more</button><span class="muted">' +
        shown[list].toLocaleString() +
        " / " +
        total.toLocaleString() +
        "</span></div>"
      : "";
  const privateOpen = new Set(),
    isPlatformAdmin = me.role === "owner",
    isOwner = canManage;
  app.innerHTML =
    '<main class="wrap">' +
    header(
      '<a href="/"><button class="secondary small">Events</button></a><button class="secondary small" id="logout">Sign out</button>',
    ) +
    '<div class="dash-head"><div><span class="pill">Moderator console · ' +
    modeName(event.mode) +
    '</span><h1 data-user-content style="margin-top:12px">' +
    esc(event.title) +
    '</h1><div class="muted"><span data-user-content>' +
    esc(me.email) +
    "</span> · " +
    esc(roleName(me.role)) +
    '</div></div><div class="stats"><div class="stat">Limit ' +
    event.capacity.toLocaleString() +
    "</div></div></div>" +
    (canManage
      ? ""
      : '<p class="scope-note">You only see the questions and private conversations that are assigned to you.</p>') +
    '<div class="console-nav"><div class="tabs" role="tablist">' +
    [
      ["inbox", "Inbox"],
      ["private", "Private messages"],
      ["archive", "Published / archive"],
      ["stage", "Stage / cues"],
      ...(canManage
        ? [
            ["team", "Team"],
            ["bans", "Blocked users"],
            ["settings", "Settings"],
          ]
        : []),
    ]
      .map(
        ([id, label]) =>
          '<button class="tab' +
          (id === "inbox" ? " active" : "") +
          '" role="tab" data-tab="' +
          id +
          '"><span>' +
          label +
          '</span><span class="tab-count" data-count="' +
          id +
          '" hidden></span></button>',
      )
      .join("") +
    '</div><div class="console-search" role="search"><input type="search" id="console-search" autocomplete="off" enterkeyhint="search" aria-label="Search messages, names and topics" placeholder="Search messages, names and topics…">' +
    (canManage
      ? '<select id="assignee-filter" aria-label="Filter by moderator"><option value="">All moderators</option><option value="none">Not assigned</option>' +
        team
          .filter((u) => u.role === "moderator")
          .map((u) => '<option data-user-content value="' + esc(u.id) + '">' + esc(u.email) + "</option>")
          .join("") +
        "</select>"
      : "") +
    '</div></div><div id="panel"></div></main>';
  document.querySelector("#logout").onclick = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    csrfToken = "";
    login();
  };
  const refresh = async ({ withBans = true } = {}) => {
    loaded = await api(endpoint + "/messages");
    messages = loaded.messages;
    threadStates = loaded.privateThreads || {};
    pins = loaded.pins || [];
    if (withBans && canManage) bans = (await api(endpoint + "/bans")).bans;
    trustProxy = loaded.trustProxy;
  };
  const topicList = () => [...new Set(team.flatMap((u) => u.topics || []))],
    activeModerators = () => team.filter((u) => u.role === "moderator" && u.active),
    assigneeName = (id) => team.find((u) => u.id === id)?.email || "",
    // Assignment label for the event owner (assigned moderator or none).
    assignPill = (id) =>
      !canManage
        ? ""
        : id && assigneeName(id)
          ? '<span class="pill assign-pill"><span>Assigned to</span> <b data-user-content>' +
            esc(assigneeName(id)) +
            "</b></span>"
          : '<span class="pill assign-pill unassigned">Not assigned</span>',
    // Owner only: choose a moderator, then "Forward".
    forwardControls = (current, scope) =>
      '<div class="forward"><label>Forward to moderator</label><div class="forward-row"><select data-assignee aria-label="Forward to moderator"><option value="">Select moderator</option>' +
      activeModerators()
        .map(
          (u) =>
            '<option data-user-content value="' +
            esc(u.id) +
            '"' +
            (current === u.id ? " selected" : "") +
            ">" +
            esc(u.email) +
            (u.topics?.length ? " · " + esc(u.topics.join(", ")) : "") +
            "</option>",
        )
        .join("") +
      '</select><button type="button" class="small" data-' +
      scope +
      '="assign">Forward</button>' +
      (current
        ? '<button type="button" class="secondary small" data-' +
          scope +
          '="unassign">Remove assignment</button>'
        : "") +
      "</div>" +
      (activeModerators().length ? "" : '<div class="hint">Add a moderator in Team first.</div>') +
      "</div>",
    assigneeOk = (id) => !assigneeFilter || (assigneeFilter === "none" ? !id : id === assigneeFilter),
    isBlocked = (participantId) =>
      Boolean(participantId && bans.some((x) => x.participantId === participantId));
  const pinControls = (m) => {
    if (m.status !== "published" || m.type !== "question") return "";
    const pin = pins.find((x) => x.id === m.id);
    return (
      '<div class="pin-controls"><label>Pin color <input type="color" data-pin-color value="' +
      esc(pin?.color || "#f0c000") +
      '"></label><button class="secondary small" data-act="pin">' +
      (pin ? "Save color" : "Pin at top of chat") +
      "</button>" +
      (pin ? '<button class="secondary small" data-act="unpin">Unpin</button>' : "") +
      "</div>"
    );
  };
  const participantControls = (m) =>
    (m.participantId
      ? isBlocked(m.participantId)
        ? '<span class="pill">Participant blocked</span>'
        : '<button class="danger small" data-act="ban">Block participant</button>'
      : "") +
    (m.ipAvailable ? '<button class="danger small" data-act="ban-ip">Block IP address</button>' : "");
  // Topic and "Forward to moderator" for the owner; the topic for a moderator.
  const routingBlock = (m) =>
    isOwner
      ? '<div class="assignment"><div><label>Topic / area</label><input data-topic list="topic-list" value="' +
        esc(m.topic || "") +
        '" placeholder="e.g. Delta works or infrastructure"></div>' +
        forwardControls(m.assignedTo || "", "act") +
        "</div>"
      : m.topic
        ? '<div class="muted assignment-summary"><span data-user-content>' +
          highlight(m.topic, terms) +
          "</span></div>"
        : "";
  const questionCard = (m) => {
    const routing = routingBlock(m);
    const buttons =
      m.type === "private"
        ? '<span class="pill">Private conversation</span>'
        : '<button class="small" data-act="publish">Publish</button><button class="secondary small" data-act="stage">Send to stage</button>';
    return (
      '<article class="question" data-q="' +
      esc(m.id) +
      '"><div class="question-head"><b><span data-user-content>' +
      highlight(m.author, terms) +
      "</span>" +
      (m.language ? ' <span class="pill" data-user-content>' + esc(m.language) + "</span>" : "") +
      ' <span class="pill">' +
      (m.type === "private" ? "Private" : "Public") +
      "</span> " +
      assignPill(m.assignedTo) +
      '</b><span class="muted">' +
      time(m.createdAt) +
      "</span></div><p>" +
      highlight(m.text, terms) +
      "</p>" +
      routing +
      '<div class="question-actions">' +
      buttons +
      '<button class="secondary small" data-act="reject">Reject</button>' +
      participantControls(m) +
      "</div>" +
      pinControls(m) +
      "</article>"
    );
  };
  const wireMessages = (container) =>
    container.querySelectorAll("[data-act]").forEach(
      (b) =>
        (b.onclick = async () => {
          const card = b.closest("[data-q]"),
            m = messages.find((x) => x.id === card?.dataset.q),
            act = b.dataset.act;
          try {
            if (act === "stage-remove" && !confirm("Remove this item from the speaker queue?")) return;
            if (act === "assign" || act === "unassign") {
              const assignedTo = act === "assign" ? card.querySelector("[data-assignee]").value : "";
              if (act === "assign" && !assignedTo) return alert("Select a moderator first.");
              await api(endpoint + "/messages/" + encodeURIComponent(m.id) + "/assign", {
                method: "POST",
                body: JSON.stringify({
                  topic: card.querySelector("[data-topic]")?.value ?? m.topic ?? "",
                  assignedTo,
                }),
              });
            } else if (act === "ban") {
              await api(endpoint + "/ban", { method: "POST", body: JSON.stringify({ messageId: m.id }) });
            } else if (act === "ban-ip") {
              if (
                !confirm(
                  "Block this IP address for the event? Other people sharing the same network may also lose access.",
                )
              )
                return;
              await api(endpoint + "/ban-ip", { method: "POST", body: JSON.stringify({ messageId: m.id }) });
            } else if (act === "pin") {
              await api(endpoint + "/pins", {
                method: "POST",
                body: JSON.stringify({
                  messageId: m.id,
                  color: card.querySelector("[data-pin-color]").value,
                }),
              });
            } else if (act === "unpin") {
              await api(endpoint + "/pins/" + encodeURIComponent(m.id), { method: "DELETE" });
            } else
              await api(endpoint + "/messages/" + encodeURIComponent(m.id) + "/" + act, {
                method: "POST",
                body: "{}",
              });
            await refresh();
            draw();
          } catch (e) {
            alert(e.message);
          }
        }),
    );
  const privateThreads = () => {
    const ids = new Set(
      messages
        .filter((m) => ["private", "private-reply"].includes(m.type))
        .map((m) => m.participantId || m.targetParticipantId)
        .filter(Boolean),
    );
    return [...ids]
      .map((id) => {
        const rows = messages
          .filter(
            (m) =>
              (m.participantId === id || m.targetParticipantId === id) &&
              ["private", "private-reply"].includes(m.type),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = rows.at(-1);
        return {
          id,
          messages: rows,
          last,
          status: threadStates[id]?.status || "open",
          updatedAt: threadStates[id]?.updatedAt || last?.createdAt || "",
        };
      })
      .filter((t) => t.messages.length)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };
  const teamCard = (u) => {
    const canRemove = isOwner && u.role !== "owner" && (u.role !== "event-owner" || isPlatformAdmin),
      canEdit = canRemove && (isPlatformAdmin || !u.shared);
    let controls = "";
    if (canEdit) {
      controls =
        '<form class="edit-team-form" data-user="' +
        esc(u.id) +
        '"><label>Email address</label><input name="email" type="email" required value="' +
        esc(u.email) +
        '"><div class="row"><div><label>Role</label><select name="role"><option value="moderator" ' +
        (u.role === "moderator" ? "selected" : "") +
        '>Moderator</option><option value="stage" ' +
        (u.role === "stage" ? "selected" : "") +
        ">Stage monitor</option>" +
        (isPlatformAdmin
          ? '<option value="event-owner" ' +
            (u.role === "event-owner" ? "selected" : "") +
            ">Event owner (this chat only)</option>"
          : "") +
        '</select></div><div><label>New password (optional)</label><input name="password" type="password" minlength="12" placeholder="Leave blank to keep current"></div></div><label>Topics / areas</label><input name="topics" value="' +
        esc((u.topics || []).join(", ")) +
        '" placeholder="Delta works, Infrastructure"><label class="check-label"><input type="checkbox" name="active" ' +
        (u.active ? "checked" : "") +
        '> Account active</label><div class="toolbar"><button class="secondary small">Save account</button><button type="button" class="danger small" data-remove-user="' +
        esc(u.id) +
        '">Remove from this chat</button></div></form>';
    } else if (canRemove && u.shared && !isPlatformAdmin) {
      controls =
        '<div class="hint">This login is shared with another event. Only the platform admin can change its login or access settings here.</div><form class="edit-topics-form" data-user="' +
        esc(u.id) +
        '"><label>Topics / areas for this chat</label><input name="topics" value="' +
        esc((u.topics || []).join(", ")) +
        '" placeholder="Delta works, Infrastructure"><div class="toolbar"><button class="secondary small">Save topics</button><button type="button" class="danger small" data-remove-user="' +
        esc(u.id) +
        '">Remove from this chat</button></div></form>';
    }
    return (
      '<article class="team-member"><div class="row"><div><b data-user-content>' +
      highlight(u.email, terms) +
      '</b></div><span class="pill">' +
      esc(roleName(u.role)) +
      (u.active ? "" : " · Disabled") +
      "</span></div>" +
      (u.topics?.length
        ? '<div class="muted">Topics: <span data-user-content>' + esc(u.topics.join(", ")) + "</span></div>"
        : "") +
      controls +
      "</article>"
    );
  };
  // What each tab lists, filtered by the search query.
  const hit = (m) => matchesAll(terms, m.author, m.text, m.topic, m.language);
  const lists = {
    inbox: () =>
      messages.filter(
        (m) => m.status === "pending" && m.type === "question" && hit(m) && assigneeOk(m.assignedTo),
      ),
    private: () =>
      privateThreads().filter(
        (t) =>
          (privateStatus === "all" || t.status === privateStatus) &&
          assigneeOk(threadStates[t.id]?.assignedTo) &&
          (!terms.length ||
            matchesAll(
              terms,
              t.messages.find((m) => m.participantId === t.id)?.author,
              ...t.messages.map((m) => m.text),
            )),
      ),
    archive: () =>
      messages.filter(
        (m) =>
          ["published", "withdrawn"].includes(m.status) &&
          m.type === "question" &&
          hit(m) &&
          assigneeOk(m.assignedTo),
      ),
    announcements: () => pins.filter((m) => m.type === "announcement" && hit(m)),
    stage: () =>
      messages.filter(
        (m) =>
          m.stageState === "queued" &&
          hit(m) &&
          (m.type === "question" ? assigneeOk(m.assignedTo) : !assigneeFilter),
      ),
    replies: () => messages.filter((m) => m.type === "stage-reply" && hit(m)),
    team: () => team.filter((u) => matchesAll(terms, u.email, roleName(u.role), ...(u.topics || []))),
    bans: () => bans.filter((b) => matchesAll(terms, b.name, b.by)),
  };
  const tabCounts = () => {
    const counts = terms.length
      ? {
          inbox: lists.inbox().length,
          private: lists.private().length,
          archive: lists.archive().length + lists.announcements().length,
          stage: lists.stage().length + lists.replies().length,
          team: lists.team().length,
          bans: lists.bans().length,
        }
      : {
          inbox: lists.inbox().length,
          private: privateThreads().filter((t) => t.status === "open").length,
        };
    document.querySelectorAll("[data-count]").forEach((el) => {
      const n = counts[el.dataset.count];
      el.hidden = n === undefined || (!terms.length && !n);
      el.textContent = n > 999 ? "999+" : String(n ?? "");
    });
    document.querySelector(".console-nav").classList.toggle("searching", terms.length > 0);
  };
  const draw = () => {
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("active", x.dataset.tab === tab);
      x.setAttribute("aria-selected", String(x.dataset.tab === tab));
    });
    document.querySelector(".console-search").hidden = tab === "settings";
    tabCounts();
    const p = document.querySelector("#panel");
    if (tab === "inbox") {
      const pending = lists.inbox();
      p.innerHTML =
        '<section class="card"><h2>Moderation queue <span class="pill">' +
        pending.length +
        "</span></h2>" +
        (isOwner
          ? '<datalist id="topic-list">' +
            topicList()
              .map((t) => '<option data-user-content value="' + esc(t) + '">')
              .join("") +
            "</datalist>"
          : "") +
        '<div class="queue">' +
        (pending.slice(0, shown.inbox).map(questionCard).join("") ||
          (terms.length
            ? '<div class="empty">No matching messages.</div>'
            : '<div class="empty">No messages to review.</div>')) +
        "</div>" +
        moreButton("inbox", pending.length) +
        '<p class="hint">Publish to the public chat, or send a question to the speaker queue. Published questions remain in the archive.</p></section>';
      wireMessages(p);
    } else if (tab === "private") {
      const threads = privateThreads(),
        filtered = lists.private(),
        pageSize = 20,
        pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      privatePage = Math.min(privatePage, pageCount - 1);
      const visible = filtered.slice(privatePage * pageSize, (privatePage + 1) * pageSize);
      const threadCard = (t) => {
        const last = t.last,
          who = last.author || "Attendee",
          attendee = t.messages.find((m) => m.participantId === t.id)?.author || "Attendee";
        return (
          '<details class="private-thread-card" data-thread-card="' +
          esc(t.id) +
          '" ' +
          (privateOpen.has(t.id) || (terms.length && filtered.length <= 5) ? "open" : "") +
          '><summary class="private-thread-summary"><div class="private-summary-main"><b data-user-content>' +
          highlight(attendee, terms) +
          "</b>" +
          assignPill(threadStates[t.id]?.assignedTo) +
          '<span class="muted">' +
          esc(statusName(t.status)) +
          " · " +
          t.messages.length +
          " messages · " +
          time(last.createdAt) +
          '</span><span class="thread-preview" data-user-content>' +
          highlight(last.text, terms) +
          '</span></div></summary><div class="private-thread-content">' +
          (isOwner ? forwardControls(threadStates[t.id]?.assignedTo || "", "thread") : "") +
          '<div class="muted">Last message by <span data-user-content>' +
          esc(who) +
          '</span></div><div class="private-transcript">' +
          t.messages
            .map(
              (m) =>
                '<div class="private-line ' +
                (m.type === "private-reply" ? "from-moderator" : "from-attendee") +
                '"><b data-user-content>' +
                esc(m.author || "Attendee") +
                "</b><p>" +
                highlight(m.text, terms) +
                "</p><time>" +
                time(m.createdAt) +
                "</time></div>",
            )
            .join("") +
          '</div><form class="private-reply-form" data-participant="' +
          esc(t.id) +
          '"><textarea name="text" placeholder="Write a private reply…" required></textarea><div class="question-actions"><button>Send private reply</button><button type="button" class="secondary small" data-thread-action="' +
          (t.status === "open" ? "close" : "reopen") +
          '" data-participant="' +
          esc(t.id) +
          '">' +
          (t.status === "open" ? "Close conversation" : "Reopen conversation") +
          "</button></div></form></div></details>"
        );
      };
      p.innerHTML =
        '<section class="card"><div class="row"><div><h2>Private conversations <span class="pill">' +
        threads.filter((t) => t.status === "open").length +
        " " +
        statusName("open") +
        '</span> <span class="pill">' +
        threads.filter((t) => t.status === "closed").length +
        " " +
        statusName("closed") +
        '</span></h2><p class="muted">New attendee messages reopen a closed conversation. The newest activity appears first.</p></div></div><div class="private-tools"><select id="private-status"><option value="open" ' +
        (privateStatus === "open" ? "selected" : "") +
        ">" +
        statusName("open") +
        '</option><option value="closed" ' +
        (privateStatus === "closed" ? "selected" : "") +
        ">" +
        statusName("closed") +
        '</option><option value="all" ' +
        (privateStatus === "all" ? "selected" : "") +
        '>All conversations</option></select></div><div class="private-inbox">' +
        (visible.map(threadCard).join("") || '<div class="empty">No matching private conversations.</div>') +
        "</div>" +
        (filtered.length > pageSize
          ? '<div class="private-pager"><button type="button" class="secondary small" data-private-page="-1" ' +
            (privatePage === 0 ? "disabled" : "") +
            '>Previous</button><span class="muted">Page ' +
            (privatePage + 1) +
            " / " +
            pageCount +
            " · " +
            filtered.length +
            ' conversations</span><button type="button" class="secondary small" data-private-page="1" ' +
            (privatePage >= pageCount - 1 ? "disabled" : "") +
            ">Next</button></div>"
          : "") +
        "</section>";
      const select = p.querySelector("#private-status");
      select.onchange = () => {
        privateStatus = select.value;
        privatePage = 0;
        draw();
      };
      p.querySelectorAll("[data-private-page]").forEach(
        (button) =>
          (button.onclick = () => {
            privatePage = Math.max(
              0,
              Math.min(pageCount - 1, privatePage + Number(button.dataset.privatePage)),
            );
            draw();
          }),
      );
      p.querySelectorAll("[data-thread-card]").forEach((card) =>
        card.addEventListener("toggle", () => {
          if (card.open) privateOpen.add(card.dataset.threadCard);
          else privateOpen.delete(card.dataset.threadCard);
        }),
      );
      p.querySelectorAll(".private-reply-form").forEach(
        (form) =>
          (form.onsubmit = async (ev) => {
            ev.preventDefault();
            const input = form.elements.text;
            if (!input.value.trim()) return;
            try {
              await api(endpoint + "/messages/private", {
                method: "POST",
                body: JSON.stringify({ participantId: form.dataset.participant, text: input.value }),
              });
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
      p.querySelectorAll("[data-thread]").forEach(
        (button) =>
          (button.onclick = async () => {
            const card = button.closest("[data-thread-card]"),
              assignedTo =
                button.dataset.thread === "assign" ? card.querySelector("[data-assignee]").value : "";
            if (button.dataset.thread === "assign" && !assignedTo) return alert("Select a moderator first.");
            try {
              await api(
                endpoint + "/conversations/" + encodeURIComponent(card.dataset.threadCard) + "/assign",
                {
                  method: "POST",
                  body: JSON.stringify({ assignedTo }),
                },
              );
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
      p.querySelectorAll("[data-thread-action]").forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              await api(
                endpoint +
                  "/conversations/" +
                  encodeURIComponent(button.dataset.participant) +
                  "/" +
                  button.dataset.threadAction,
                { method: "POST", body: "{}" },
              );
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
    } else if (tab === "archive") {
      const archived = lists.archive(),
        announcementPins = lists.announcements();
      // While searching, only matching announcements are listed (no form), so
      // the results are at the top.
      const searching = terms.length > 0;
      const announcementList =
        announcementPins
          .map(
            (m) =>
              '<article class="question announcement-item"><div class="question-head"><b data-user-content>' +
              esc(m.author || "Moderator") +
              '</b><span class="muted">' +
              time(m.createdAt) +
              "</span></div><p data-user-content>" +
              highlight(m.text, terms) +
              '</p><button class="secondary small" type="button" data-unpin-announcement="' +
              esc(m.id) +
              '">Unpin</button></article>',
          )
          .join("") || '<div class="empty">No pinned announcements.</div>';
      p.innerHTML =
        (searching && !announcementPins.length
          ? ""
          : '<section class="card"><h2>Pinned announcements</h2>' +
            (searching
              ? ""
              : '<p class="muted">Write an announcement to pin at the top of the public chat.</p><form id="announcement-form" class="announcement-form"><textarea name="text" maxlength="500" required placeholder="Announcement text…"></textarea><label class="announcement-color">Pin color <input type="color" name="color" value="#111111"></label><button>Post and pin announcement</button><div class="error" id="announcement-error"></div></form>') +
            '<div class="queue">' +
            announcementList +
            "</div></section>") +
        '<section class="card"><div class="section-head"><div><h2>Published questions and archive</h2><p class="muted">Withdraw, republish, send questions to speakers, pin key messages, and manage participant access.</p></div>' +
        (isOwner
          ? '<a href="' + endpoint + '/export"><button class="secondary">Export full chat CSV</button></a>'
          : "") +
        "</div>" +
        (isOwner
          ? '<datalist id="topic-list">' +
            topicList()
              .map((t) => '<option data-user-content value="' + esc(t) + '">')
              .join("") +
            "</datalist>"
          : "") +
        '<div class="queue">' +
        (archived
          .slice()
          .reverse()
          .slice(0, shown.archive)
          .map(
            (m) =>
              '<article class="question" data-q="' +
              esc(m.id) +
              '"><div class="question-head"><b><span data-user-content>' +
              highlight(m.author, terms) +
              "</span> " +
              (m.language ? '<span class="pill" data-user-content>' + esc(m.language) + "</span>" : "") +
              ' <span class="pill">' +
              (m.status === "published" ? "Published" : "Withdrawn") +
              "</span>" +
              (m.stageState ? '<span class="pill">Stage: ' + esc(statusName(m.stageState)) + "</span>" : "") +
              " " +
              assignPill(m.assignedTo) +
              '</b><span class="muted">' +
              time(m.createdAt) +
              "</span></div><p>" +
              highlight(m.text, terms) +
              "</p>" +
              routingBlock(m) +
              '<div class="question-actions">' +
              (m.status === "published"
                ? '<button class="secondary small" data-act="withdraw">Withdraw from public chat</button>'
                : '<button class="small" data-act="publish">Republish</button>') +
              '<button class="secondary small" data-act="stage">' +
              (m.stageState === "queued" ? "On speaker queue" : "Send to stage") +
              "</button>" +
              participantControls(m) +
              "</div>" +
              pinControls(m) +
              "</article>",
          )
          .join("") ||
          (terms.length
            ? '<div class="empty">No matching messages.</div>'
            : '<div class="empty">No published messages yet.</div>')) +
        "</div>" +
        moreButton("archive", archived.length) +
        "</section>";
      const announcementForm = document.querySelector("#announcement-form");
      if (announcementForm)
        announcementForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const input = ev.target.elements.text;
          if (!input.value.trim()) return;
          try {
            await api(endpoint + "/announcements", {
              method: "POST",
              body: JSON.stringify({ text: input.value, color: ev.target.elements.color.value }),
            });
            await refresh();
            draw();
          } catch (e) {
            document.querySelector("#announcement-error").textContent = e.message;
          }
        };
      p.querySelectorAll("[data-unpin-announcement]").forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              await api(endpoint + "/pins/" + encodeURIComponent(button.dataset.unpinAnnouncement), {
                method: "DELETE",
              });
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
      wireMessages(p);
    } else if (tab === "stage") {
      const replies = lists
          .replies()
          .slice(-30)
          .reverse()
          .map(
            (m) =>
              '<div class="question"><p>' +
              highlight(m.text, terms) +
              '</p><span class="muted"><span data-user-content>' +
              esc(m.author) +
              "</span> · " +
              time(m.createdAt) +
              "</span></div>",
          )
          .join(""),
        queued = lists.stage();
      p.innerHTML =
        '<div class="split"><section class="card"><h2>Speaker queue <span class="pill">' +
        queued.length +
        '</span></h2><p class="muted">The speaker can scroll this list on an iPad, select a question, and mark it read. Sent questions stay in the archive.</p><div class="queue">' +
        (queued
          .map(
            (m) =>
              '<article class="question" data-q="' +
              esc(m.id) +
              '"><span class="pill">' +
              (m.type === "cue" ? "Stage cue" : "Question") +
              "</span><p>" +
              highlight(m.text, terms) +
              '</p><button class="danger small" data-act="stage-remove">Remove from speaker queue</button></article>',
          )
          .join("") || '<div class="empty">Nothing waiting for the speaker.</div>') +
        '</div><form id="cue"><label>Send a note to the speaker</label><textarea name="text" maxlength="500" required placeholder="Message for the speaker…"></textarea><button style="margin-top:10px">Add stage cue</button></form>' +
        (isOwner
          ? '<div class="toolbar" style="margin-top:14px"><a href="/stage/' +
            encodeURIComponent(event.slug) +
            '" target="_blank" rel="noreferrer"><button class="secondary small">Open stage login</button></a><button class="secondary small" id="make-stage-link">Create secure stage link + QR</button></div><div id="stage-link-result"></div>'
          : "") +
        '</section><section class="card"><h2>Private messages from stage</h2><div class="queue">' +
        (replies || '<div class="empty">No messages yet.</div>') +
        "</div></section></div>";
      document.querySelector("#cue").onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          await api(endpoint + "/stage", {
            method: "POST",
            body: JSON.stringify({ text: ev.target.text.value, type: "cue" }),
          });
          ev.target.reset();
          await refresh();
          draw();
        } catch (e) {
          alert(e.message);
        }
      };
      document.querySelector("#make-stage-link")?.addEventListener("click", async () => {
        const box = document.querySelector("#stage-link-result");
        box.textContent = "Creating secure link…";
        try {
          const d = await api(endpoint + "/stage-access", { method: "POST", body: "{}" }),
            qr =
              endpoint +
              "/stage-qr?access=" +
              encodeURIComponent(new URLSearchParams(d.url.split("?")[1]).get("access"));
          box.innerHTML =
            '<div class="stage-link-panel"><p>Anyone with this link can open the speaker page. It expires in 12 hours.</p><a href="' +
            esc(d.url) +
            '" target="_blank" rel="noreferrer">Open speaker page</a><button class="secondary small" data-copy="' +
            esc(location.origin + d.url) +
            '">Copy secure link</button><img class="qr-code" alt="QR code for secure speaker page" src="' +
            esc(qr) +
            '"><div class="muted">Scan this QR code with the speaker’s iPad or phone.</div></div>';
        } catch (e) {
          box.textContent = e.message;
        }
      });
      wireMessages(p);
    } else if (tab === "team") {
      p.innerHTML =
        '<div class="split"><section class="card"><h2>Team accounts</h2>' +
        (isOwner
          ? '<form id="add-user"><label>Email address</label><input type="email" name="email" required><label>Password (at least 12 characters)</label><input type="password" name="password" minlength="12" required><label>Role</label><select name="role"><option value="moderator">Moderator</option><option value="stage">Stage monitor</option>' +
            (isPlatformAdmin ? '<option value="event-owner">Event owner (this chat only)</option>' : "") +
            '</select><label>Topics / areas for this moderator</label><input name="topics" placeholder="Delta works, Infrastructure"><div class="hint">Comma-separated. The event owner can assign questions to the moderator responsible for each area.</div><button style="margin-top:12px">Add account</button><div class="error" id="user-error"></div></form>'
          : '<p class="muted">The event owner manages accounts and topic responsibilities.</p>') +
        '</section><section class="card"><h2>Team accounts</h2><div id="team-list">' +
        (lists.team().map(teamCard).join("") ||
          (terms.length
            ? '<div class="empty">No matching accounts.</div>'
            : '<div class="empty">No team accounts yet.</div>')) +
        "</div></section></div>";
      document.querySelector("#add-user")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          await api(endpoint + "/moderators", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(ev.target))),
          });
          team = (await api(endpoint + "/moderators")).users;
          draw();
        } catch (e) {
          document.querySelector("#user-error").textContent = e.message;
        }
      });
      p.querySelectorAll(".edit-team-form").forEach(
        (form) =>
          (form.onsubmit = async (ev) => {
            ev.preventDefault();
            const f = Object.fromEntries(new FormData(form));
            f.active = form.elements.active.checked;
            try {
              await api(endpoint + "/moderators/" + encodeURIComponent(form.dataset.user), {
                method: "PATCH",
                body: JSON.stringify(f),
              });
              team = (await api(endpoint + "/moderators")).users;
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
      p.querySelectorAll(".edit-topics-form").forEach(
        (form) =>
          (form.onsubmit = async (ev) => {
            ev.preventDefault();
            try {
              await api(endpoint + "/moderators/" + encodeURIComponent(form.dataset.user), {
                method: "PATCH",
                body: JSON.stringify({ topics: form.elements.topics.value }),
              });
              team = (await api(endpoint + "/moderators")).users;
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
      p.querySelectorAll("[data-remove-user]").forEach(
        (button) =>
          (button.onclick = async () => {
            if (!confirm("Remove this account from this chat?")) return;
            try {
              await api(endpoint + "/moderators", {
                method: "DELETE",
                body: JSON.stringify({ userId: button.dataset.removeUser }),
              });
              team = (await api(endpoint + "/moderators")).users;
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
    } else if (tab === "bans") {
      p.innerHTML =
        '<section class="card"><h2>Blocked users <span class="pill">' +
        bans.length +
        '</span></h2><p class="muted">Blocked attendees cannot reconnect or send messages in this event. Unblocking here restores access.</p><p class="hint">' +
        (trustProxy
          ? "IP blocking is enabled through the proxy."
          : "IP blocking is unavailable until TRUST_PROXY is enabled for the reverse proxy.") +
        '</p><div class="queue">' +
        (lists
          .bans()
          .map(
            (b) =>
              '<article class="team-member"><div class="row"><div><b data-user-content>' +
              highlight(b.name, terms) +
              "</b>" +
              (b.kind === "ip" ? " · IP address" : " · User") +
              '<div class="muted"><span>Blocked</span> ' +
              time(b.at) +
              " · <span data-user-content>" +
              esc(b.by || "Moderator") +
              "</span> · " +
              b.messageCount +
              ' <span>saved messages</span></div></div><button class="secondary small" data-unblock="' +
              esc(b.id) +
              '">Unblock user</button></div></article>',
          )
          .join("") ||
          (terms.length
            ? '<div class="empty">No matching blocked users.</div>'
            : '<div class="empty">No blocked users.</div>')) +
        "</div></section>";
      p.querySelectorAll("[data-unblock]").forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              await api(endpoint + "/bans/" + encodeURIComponent(button.dataset.unblock), {
                method: "DELETE",
              });
              await refresh();
              draw();
            } catch (e) {
              alert(e.message);
            }
          }),
      );
    } else {
      p.innerHTML =
        '<section class="card"><h2>Chat and moderation settings</h2><form id="settings"><label>Event name</label><input name="title" value="' +
        esc(event.title) +
        '"><label>Logo URL (HTTPS, optional)</label><input name="logo" type="url" value="' +
        esc(event.branding?.logo || "") +
        '" placeholder="https://client.example.com/logo.png"><div class="row"><div><label>Participant limit</label><input name="capacity" type="number" min="1" max="20000" value="' +
        event.capacity +
        '"></div><div><label>Chat mode</label><select name="mode"><option value="moderated" ' +
        (event.mode === "moderated" ? "selected" : "") +
        '>Moderated</option><option value="readonly" ' +
        (event.mode === "readonly" ? "selected" : "") +
        '>Read-only</option><option value="open" ' +
        (event.mode === "open" ? "selected" : "") +
        '>Open</option></select><small class="hint">Moderated: approve messages first. Read-only: attendees only view. Open: public messages appear immediately.</small></div></div><label>Blocked words/phrases</label><textarea name="blockedWords" placeholder="Enter comma-separated words or phrases">' +
        esc((event.blockedWords || []).join(", ")) +
        '</textarea><div class="hint">Messages containing one of these terms are stopped before publication or moderation. Separate entries with commas or new lines.</div><label class="check-label"><input type="checkbox" name="chatEnabled" ' +
        (event.chatEnabled ? "checked" : "") +
        '> Chat enabled</label><label class="check-label"><input type="checkbox" name="privateMessagesEnabled" ' +
        (event.privateMessagesEnabled !== false ? "checked" : "") +
        '> Allow private messages to moderators</label><div class="hint">When disabled, attendees can still read their existing private conversation history.</div><div class="toolbar" style="margin-top:15px"><button>Save settings</button><a href="' +
        endpoint +
        '/export"><button type="button" class="secondary">Export full chat CSV</button></a><button type="button" class="secondary" id="copy-embed" data-copy="<iframe src=&quot;' +
        location.origin +
        "/e/" +
        esc(event.slug) +
        '&quot; style=&quot;width:100%;height:650px;border:0&quot; title=&quot;Live chat&quot;></iframe>">Copy embed code</button></div><div class="hint" style="margin-top:16px">Public link: <a href="/e/' +
        encodeURIComponent(event.slug) +
        '" target="_blank">' +
        location.origin +
        "/e/" +
        encodeURIComponent(event.slug) +
        "</a></div></form></section>";
      document.querySelector("#settings").onsubmit = async (ev) => {
        ev.preventDefault();
        const form = ev.target,
          f = Object.fromEntries(new FormData(form));
        if (
          f.mode === "open" &&
          event.mode !== "open" &&
          !confirm("Open mode makes every public attendee message visible immediately. Continue?")
        )
          return;
        try {
          const d = await api(endpoint + "/settings", {
            method: "PATCH",
            body: JSON.stringify({
              ...f,
              chatEnabled: form.elements.chatEnabled.checked,
              privateMessagesEnabled: form.elements.privateMessagesEnabled.checked,
              branding: { logo: f.logo },
            }),
          });
          Object.assign(event, d.event);
          event.blockedWords = f.blockedWords
            .split(/[\n,]/)
            .map((x) => x.trim())
            .filter(Boolean);
          alert("Settings saved");
        } catch (e) {
          alert(e.message);
        }
      };
    }
  };
  document.querySelectorAll(".tab").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        draw();
        b.scrollIntoView({ block: "nearest", inline: "nearest" });
      }),
  );
  document.querySelector("#panel").addEventListener("click", (ev) => {
    const more = ev.target.closest("[data-more]");
    if (!more) return;
    shown[more.dataset.more] += STEP;
    draw();
  });
  document.querySelector("#assignee-filter")?.addEventListener("change", (ev) => {
    assigneeFilter = ev.target.value;
    shown.inbox = shown.archive = STEP;
    privatePage = 0;
    draw();
  });
  const searchInput = document.querySelector("#console-search");
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = searchInput.value;
      terms = searchTerms(query);
      shown.inbox = shown.archive = STEP;
      privatePage = 0;
      draw();
    }, 150);
  });
  draw();
  // Realtime updates are coalesced: a burst of events triggers one reload
  // instead of one full reload per event. While a moderator is typing in the
  // panel, redrawing is postponed so the text is not lost.
  const es = new EventSource(endpoint + "/stream");
  let refreshTimer = null,
    bansChanged = false,
    drawPending = false;
  const typingInPanel = () => {
    const active = document.activeElement;
    return Boolean(active && active.closest?.("#panel") && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
  };
  const drawWhenIdle = () => {
    if (typingInPanel()) drawPending = true;
    else draw();
  };
  document.querySelector("#panel").addEventListener("focusout", () =>
    setTimeout(() => {
      if (drawPending && !typingInPanel()) {
        drawPending = false;
        draw();
      }
    }, 150),
  );
  const refreshAndDraw = (ev) => {
    if (ev?.type === "ban-change") bansChanged = true;
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const withBans = bansChanged || tab === "bans";
      bansChanged = false;
      try {
        await refresh({ withBans });
        if (["inbox", "private", "archive", "stage", "team", "bans"].includes(tab)) drawWhenIdle();
      } catch {}
    }, 300);
  };
  es.addEventListener("access-revoked", () => {
    es.close();
    location.href = "/";
  });
  for (const eventName of [
    "inbox",
    "public-message",
    "private-message",
    "private-reply",
    "private-thread-status",
    "ban-change",
    "pins",
    "assignment",
    "message-status",
    "stage-status",
  ])
    es.addEventListener(eventName, refreshAndDraw);
  es.addEventListener("settings", (ev) => {
    const next = JSON.parse(ev.data);
    Object.assign(event, next);
    if (tab === "settings") draw();
  });
  // Moderator connections only carry signals; the content is reloaded.
  es.addEventListener("stage-reply", refreshAndDraw);
}
async function stagePage(event, me, access) {
  document.body.dataset.page = "stage";
  let stage = { queue: [], current: null };
  const endpoint = eventApi(event.slug),
    authBody = (body) => JSON.stringify({ ...body, access });
  app.innerHTML =
    '<main class="stage-workspace"><header class="stage-top"><div><div class="stage-label"><span data-user-content>' +
    esc(event.title) +
    '</span> · Speaker questions</div><div class="muted">Choose a question, show it, then mark it as read.</div></div><div class="toolbar">' +
    window.chatI18n.picker() +
    '<button class="secondary small" id="theme-toggle">' +
    (document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode") +
    '</button></div></header><div class="stage-layout"><section class="stage-current card"><div class="row"><h2>Selected question</h2><span class="pill" id="stage-count">0 waiting</span></div><div id="stage-now"><div class="empty">Select a question from the queue.</div></div><form class="stage-reply" id="reply"><input name="text" placeholder="Private message to moderators…" maxlength="500"><button>Send</button></form></section><section class="stage-queue-panel card"><div class="row"><div><h2>Questions to read</h2><p class="muted">Tap a question to display it. Mark it read when you are done.</p></div></div><input type="search" class="stage-filter" id="stage-filter" autocomplete="off" aria-label="Filter questions" placeholder="Filter questions…"><div class="stage-question-list" id="stage-list"></div></section></div></main>';
  let filterTerms = [];
  document.querySelector("#stage-filter").addEventListener("input", (ev) => {
    filterTerms = searchTerms(ev.target.value);
    render();
  });
  const render = () => {
    const current = stage.current,
      currentBox = document.querySelector("#stage-now"),
      list = document.querySelector("#stage-list");
    document.querySelector("#stage-count").textContent = stage.queue.length + " waiting";
    currentBox.innerHTML = current
      ? '<div class="stage-question">' +
        esc(current.text) +
        '</div><div class="stage-meta">' +
        (current.type === "cue" ? "Stage cue" : "Question") +
        " · <span data-user-content>" +
        esc(current.author || "") +
        "</span> · " +
        time(current.createdAt) +
        '</div><div class="question-actions"><button class="stage-mark-read" data-read="' +
        esc(current.id) +
        '">I’ve read this</button></div>'
      : '<div class="empty">Select a question from the queue.</div>';
    const visible = stage.queue.filter((m) => matchesAll(filterTerms, m.text, m.author));
    list.innerHTML = visible.length
      ? visible
          .map(
            (m) =>
              '<article class="stage-question-card ' +
              (current?.id === m.id ? "selected" : "") +
              '"><button class="stage-select" data-show="' +
              esc(m.id) +
              '"><span class="pill">' +
              (m.type === "cue" ? "Cue" : "Question") +
              "</span><span>" +
              highlight(m.text, filterTerms) +
              "</span><small>" +
              time(m.createdAt) +
              '</small></button><button class="secondary stage-read-button" data-read="' +
              esc(m.id) +
              '">Mark read</button></article>',
          )
          .join("")
      : stage.queue.length
        ? '<div class="empty">No matching questions.</div>'
        : '<div class="empty">All caught up. New selected questions appear here automatically.</div>';
  };
  document.addEventListener("click", async function stageActions(ev) {
    const show = ev.target.closest("[data-show]"),
      read = ev.target.closest("[data-read]");
    if (!show && !read) return;
    try {
      const id = (show || read).dataset.show || (show || read).dataset.read;
      await api(endpoint + "/messages/" + encodeURIComponent(id) + "/stage-" + (show ? "show" : "read"), {
        method: "POST",
        body: authBody({}),
      });
    } catch (e) {
      alert(e.message);
    }
  });
  const es = new EventSource(
    endpoint + "/stream" + (access ? "?access=" + encodeURIComponent(access) : "?screen=stage"),
  );
  es.addEventListener("ready", (ev) => {
    const d = JSON.parse(ev.data);
    stage = { queue: d.stage?.queue || [], current: d.stage?.current || null };
    render();
  });
  es.addEventListener("stage-state", (ev) => {
    stage = JSON.parse(ev.data);
    render();
  });
  es.addEventListener("access-revoked", () => {
    es.close();
    location.href = "/";
  });
  document.querySelector("#reply").onsubmit = async (ev) => {
    ev.preventDefault();
    const input = ev.target.elements.text;
    if (!input.value.trim()) return;
    try {
      await api(endpoint + "/stage-reply", { method: "POST", body: authBody({ text: input.value }) });
      input.value = "";
      input.placeholder = "Private message sent";
    } catch (e) {
      alert(e.message);
    }
  };
}
function navigate(url) {
  history.pushState(null, "", url);
  render();
}
window.addEventListener("popstate", () => render());
document.addEventListener("click", (ev) => {
  const link = ev.target.closest("a[data-nav]");
  if (!link || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)
    return;
  ev.preventDefault();
  navigate(link.getAttribute("href"));
});
function render() {
  stopStream();
  document.body.dataset.page = "";
  const { kind, slug } = route();
  return (
    kind === "public"
      ? publicPage(slug)
      : kind === "private"
        ? privatePage(slug)
        : kind === "moderator" || kind === "stage"
          ? securedPage(kind, slug)
          : homePage()
  ).catch((e) => {
    app.innerHTML = '<div class="center">' + esc(e.message) + "</div>";
  });
}
render();
