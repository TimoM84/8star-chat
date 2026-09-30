# 8star Chat

8star Chat is a white-label event chat designed to run beside a livestream. It has separate screens for attendees, moderators, and speakers.

## Features

- Create events with a participant limit and public, private, or moderated chat.
- Let attendees optionally identify their language. Any language is accepted; there is no language list or language filter.
- Review public questions before publishing. Published questions remain in the archive and can be withdrawn or republished.
- Assign questions to moderators by topic or area, such as Delta works or infrastructure.
- Add moderator accounts and assign each moderator one or more areas of responsibility.
- Reply privately to attendees, block participants, and send selected questions or stage cues to the speaker screen.
- Create a unique speaker link that expires after 12 hours, with a QR code for quick access.
- Export all event messages as a CSV, including private, pending, published, withdrawn, and rejected messages.
- Configure blocked words or phrases in the event's **Settings** tab. Entries can be separated by commas or new lines; matching attendee messages are stopped before moderation.
- Switch between light and dark themes, copy iframe embed code, and open the public chat directly from the event list.

## Deploy in Dockhand

Create a Compose stack in Dockhand and paste the Compose file below into its editor. The build context points to the GitHub release tag, so Docker can find the Dockerfile even when Dockhand's own stack folder does not contain the app files.

```yaml
services:
  8star-chat:
    build:
      context: https://github.com/TimoM84/8star-chat.git#v0.2.0
      dockerfile: Dockerfile
    image: 8star-chat:0.2.0
    restart: unless-stopped
    ports:
      - "9876:3000"
    environment:
      PORT: "3000"
      DATA_DIR: /data
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in Dockhand}
      DEFAULT_MAX_USERS: ${DEFAULT_MAX_USERS:-10000}
      MAX_MESSAGE_LENGTH: ${MAX_MESSAGE_LENGTH:-500}
      ROOM_PUBLISH_PER_SECOND: ${ROOM_PUBLISH_PER_SECOND:-5}
      FRAME_ANCESTORS: ${FRAME_ANCESTORS:-*}
    volumes:
      - 8star_chat_data:/data

volumes:
  8star_chat_data:
```

Set `ADMIN_PASSWORD` in Dockhand to a unique password of at least 12 characters. Set `ADMIN_EMAIL` to the owner email. `FRAME_ANCESTORS` controls which livestream page origins may embed the chat; set it to the relevant origin or origins (space-separated), for example `https://live.example.com https://www.example.com`. The default `*` allows embedding from any origin.

Deploy the stack after the `v0.2.0` GitHub release exists. The app is reachable at `https://onlinechat.8star.nl/` when that domain's reverse proxy points to port `9876`. Configure the proxy for long-lived Server-Sent Events connections without buffering.

The named volume `8star_chat_data` holds event, account, and message data. Keep a separate backup. The CSV export is available in the moderator console under **Published / archive** and **Settings**. Export it before removing the stack or its volume.

Changing `ADMIN_PASSWORD` after the first run does not change the owner password already stored in the data volume.

## Routes

- `/` — administration and event list
- `/e/<event-slug>` — attendee chat iframe
- `/moderator/<event-slug>` — moderator console
- `/stage/<event-slug>` — speaker screen
- `/health` — health check

Example iframe:

```html
<iframe
  src="https://onlinechat.8star.nl/e/annual-conference-2026"
  style="width:100%;height:650px;border:0"
  title="Live chat">
</iframe>
```

## First use

1. Sign in with the owner account configured in Dockhand.
2. Create an event and open its public chat from the event list.
3. Open the moderator console. Add moderators and enter the topics each moderator handles.
4. Assign questions by topic in the inbox. Review later from **Published / archive** and export the complete message history as CSV.
5. Add blocked words or phrases in **Settings**. Changes take effect for new attendee messages.
6. Use **Stage / cues** to send content to speakers or create a temporary speaker link and QR code.

## Capacity and limitations

This is an initial functional version and has not been validated as a commercial production service. Data is stored in a JSON file in one container and active connections are handled by one Node.js process. It does not include clustering, shared session storage, automated backups, password recovery, email invitations, a comprehensive audit trail, or independent load testing. The configured connection limit does not prove the server can reliably handle that many attendees. Load-test the final server, reverse proxy, and network before promising capacity for 10,000 users.
