# Changelog

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
