# Changelog

## Unreleased

### Test tools

- `scripts/loadtest.js`: request connections use a 45 s TCP keep-alive (like Chrome) instead of Node's 1 s. With 8000 attendees on one machine, all streams went quiet at the same moment between two heartbeats, every socket then sent a keep-alive probe each second, the kernel queue overflowed and up to 25% of the test streams were aborted by the kernel (`TCPAbortOnTimeout`). The server and the image are unchanged.

## v0.7.1

### Deployment

- `compose.yaml` builds the image from the repository checkout (`build: .`), so a Dockhand stack "From Git" (repository, tag, `compose.yaml`) builds and deploys in one step; `docker compose up -d --build` does the same for a downloaded release.
- The data volume has the fixed name `8star-chat_8star_chat_data` (the existing production volume), so the data no longer depends on the stack/project name.
- No changes to the application code since v0.7.0.

## v0.7.0

### Behaviour under peak load

- **Measured cause of the v0.6.0 problem:** every accepted message was written to every open stream inside the request. One write to 5,000 streams costs 60–95 ms (almost all in the `writev` system call; a CPU profile showed 13.9 s there during a burst). At 50 messages per second that is more work than one core can do, so requests waited up to 24 s inside the server, the accept queue overflowed, the proxy reported `Connection reset by peer` / `upstream timed out`, and messages accepted late were published while the sender had already given up.
- Live updates to attendees are queued per event and written in batches (at most one write per connection per `FANOUT_INTERVAL_MS`, default 100 ms) in slices, so the server keeps answering requests during delivery. Order is preserved.
- Limits answer immediately: `429` (per attendee, per event) and `503` (overload, storage) with `Retry-After`. Bounded queues: `MAX_PENDING_MESSAGES`, `MAX_PENDING_EVENTS`, `SSE_MAX_BUFFER_KB` (default lowered from 1 MB to 256 kB). Listen backlog 4096 (`LISTEN_BACKLOG`).
- The public message event for attendees only contains what the chat shows (206 instead of 294 bytes for an 80-character message).

### Reliable confirmation

- Messages carry a `clientMessageId`. The same id from the same session never creates a second message (`200` with the original message); a different text with the same id is `409`.
- `GET /api/events/<slug>/messages/status?clientMessageId=…` tells the sending session whether a message was accepted, without returning its text.
- The browser retries after a time-out, lost connection or 5xx with the same id and checks the status first, so a message is never published twice and the sender learns the outcome.
- Messages are written to a journal (`messages-N.journal`, group commit, `fdatasync`) **before** they are confirmed or shown. A confirmed message survives a crash; the journal is replayed at start-up and removed after the next snapshot. `JOURNAL_FSYNC=false` skips the `fdatasync`.

### Joining

- The join answer contains the first stream ticket (one round trip less); the stream then only sends what was published after the join.
- Static files are served with ETags (`304` on revalidation) and gzip/brotli compression.
- Test clients may ask for a shorter session (`sessionMinutes`); never longer than `GUEST_SESSION_HOURS`.

### Interface

- English is the default interface language for everyone; a language chosen with the picker is remembered.
- The send button shows "Sending…" and is disabled while a message is on its way.

### Measuring

- `METRICS_LOG_SECONDS`: one JSON line with counts and timings in the container log (no message text, names, cookies or tokens).
- `scripts/loadtest.js` rewritten: multi-process, browser-like or proxy-like connections, exact accounting of published ids, duplicates, deliveries and recovery, abort-safe session clean-up.
- `scripts/e2e-burst.js`: pass/fail end-to-end burst test. `scripts/probe.js`: measurement preload for any version. `docs/load-testing.md`.

### Compatibility

- Data from v0.6.0 is used as is. Rolling back to v0.6.0 after a clean stop is possible (the snapshot then contains every confirmed message; v0.6.0 ignores the extra `clientKey` field and does not read journal files).
- Clients of v0.6.0 that send without `clientMessageId` still work (without idempotency).

## v0.6.0

### Security and privacy

- Attendee sessions are created by the server and kept in an `HttpOnly` cookie (`Secure; SameSite=None; Partitioned` over HTTPS). Session secrets are stored only as SHA-256 hashes. Client-supplied attendee ids are ignored.
- **Fixed:** in v0.5.0 anyone who knew or guessed an attendee id could read that attendee's private history through `/join`, and every public message in the join/stream history exposed its author's attendee id and IP hash. Both are closed.
- Private conversations require a personal PIN or passphrase (salted scrypt), with a lockout after 5 wrong attempts, a permanent lock after 20, an idle lock after 15 minutes and a **Lock conversation** action. The unlock token only lives in page memory.
- **Not you? Leave chat** ends the attendee session on the server; joining again in the same browser ends the previous session.
- SSE streams for attendees use single-use tickets instead of reusable tokens in the URL. Public streams never carry private messages; private messages use a separate, PIN-protected stream.
- Same-origin check on all state-changing requests and per-session CSRF tokens for staff and attendees. The wildcard CORS preflight response was removed.
- Private messages can no longer be published or sent to the stage through the API.
- Staff e-mail addresses are no longer shown to attendees (announcements and private replies show "Moderator").
- Staff sign-in is rate limited; staff session cookies are `SameSite=Strict`; password checks no longer block the server.
- Container runs with a read-only root filesystem, no capabilities and `no-new-privileges`.

### Interface

- The public message composer no longer has a public/private selector.
- A small **To moderator** action sits in the top-right corner of the public chat (only there). The private conversation opens in the same window, clearly marked as private, with **Back to public chat**, **Lock conversation** and **Leave chat**.
- The chat shows who is signed in on this device.
- The moderator console no longer loses a reply that is being typed when new messages arrive.

### Translations

- **Fixed:** the language columns were shifted: choosing Nederlands showed German, Deutsch showed French and Français showed English.
- **Fixed:** translated text could be translated a second time (e.g. Dutch "of" became "van").
- Reviewed all Dutch, German and French texts for consistent terms (NL "podium" instead of "stage", "gemodereerd", "deelnemers"; DE "Gespräch", "Teilnehmende"), added all new texts and removed unused ones.
- `npm run check:i18n` detects missing, unused and untranslated texts, including server error messages.

### Performance

- Per-event message indexes, incremental connection counting, one shared heartbeat timer, back-pressure limit for slow clients, batched asynchronous state writes, periodic clean-up of expired sessions and rate-limit entries, and coalesced moderator refreshes. Measurements are in the README.

### Deployment

- The Compose file uses a locally built image `8star-chat:0.6.0` and keeps the existing `8star_chat_data` volume; it adds a higher open-files limit, log rotation and a graceful stop. Pending data is written on shutdown.
- New settings: `COOKIE_SECURE`, `ALLOWED_ORIGINS`, `GUEST_SESSION_HOURS`, `PRIVATE_UNLOCK_IDLE_SECONDS` (and advanced: `PIN_LOCK_SECONDS`, `MAX_GUEST_SESSIONS`, `HEARTBEAT_SECONDS`).

### Upgrade notes

- Existing data is kept. Attendees have to join again; private conversations from before v0.6.0 remain visible to moderators but cannot be reopened by attendees, because the old browser-supplied id cannot be trusted.
