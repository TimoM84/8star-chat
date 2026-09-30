# 8star Chat

8star Chat is a white-label event chat designed to run in an iframe beside a livestream. It has separate screens for attendees, moderators, and speakers.

## Features

- Create events with a title, theme, participant limit, and supported languages.
- Enable or disable chat and allow public messages, private messages, or both.
- Hold public questions for moderator approval before publishing them in one or all languages.
- Give multiple moderators and stage users access to an event.
- Review questions by language, reject them, reply privately, or block a participant.
- Send selected questions and stage cues to a separate speaker screen.
- Create temporary speaker-screen links that expire after 12 hours.
- Export an event's messages as CSV and copy its iframe embed code.
- Limit concurrent chat connections, message length, participant send rate, and public publishing rate.

## Deploy with Dockhand

The repository includes a Dockerfile and a Compose file. Create a Git stack in Dockhand with the repository root as the context directory and `compose.yaml` as the Compose file. Enable **Build images on deploy**.

Set these stack environment variables:

- `ADMIN_EMAIL`: the owner account's email address.
- `ADMIN_PASSWORD`: a unique password of at least 12 characters.
- `FRAME_ANCESTORS`: the allowed livestream page origin, for example `https://live.example.com`.

The container listens on port `3000`; Compose publishes it on host port `3088`. Put the service behind an HTTPS reverse proxy for public access. Configure the proxy to support long-lived Server-Sent Events connections without buffering.

Data is stored in the named volume `8star_chat_data`. Back it up separately and set a retention policy before processing real attendee data. Changing `ADMIN_PASSWORD` after the first run does not change the owner password already stored in the volume.

## Routes

- `/` — administration and event list
- `/e/<event-slug>` — attendee chat iframe
- `/moderator/<event-slug>` — moderator console
- `/stage/<event-slug>` — speaker screen
- `/health` — health check

Example iframe:

```html
<iframe
  src="https://chat.example.com/e/annual-conference-2026"
  style="width:100%;height:650px;border:0"
  title="Live chat">
</iframe>
```

## First use

1. Sign in with the owner account configured in the stack.
2. Create an event and copy its public iframe code.
3. Open the moderator console and add moderator or stage accounts.
4. Use **Stage / cues** to send selected content to the speaker screen or create a temporary speaker link.
5. Share the attendee chat URL with viewers. The livestream page remains separate.

## Capacity and limitations

This is an initial functional version and has not been validated as a commercial production service. Data is stored in a JSON file in a single container and active connections are handled by one Node.js process. It does not yet include clustering, shared session storage, automated backups, password recovery, email invitations, a comprehensive audit trail, or independent load testing. The configured connection limit does not prove the server can reliably handle that many attendees. Load-test the final server, reverse proxy, and network before promising capacity for 10,000 users.

The word filter, speaker PIN or QR issuance, configurable moderation roles, detailed audit logging, and retention controls are not included yet.
