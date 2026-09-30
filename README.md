# 8star Chat

8star Chat is a white-label event chat designed to run beside a livestream. It has separate screens for attendees, moderators, and speakers.

## Features

- Choose one of three chat modes: **Moderated** (approve public messages first), **Read-only** (attendees can view but not send), or **Open** (public attendee messages appear immediately).
- Let each user choose the interface language: English, Dutch, German, or French. Attendees may still optionally enter any language in their own words; this does not restrict the languages they can use in messages.
- Keep published questions in the archive; withdraw or republish them later.
- Assign questions to moderators by topic or area, such as Delta works or infrastructure.
- Open attendee private conversations in a separate page. The moderator console keeps conversations searchable, filterable, closable, and automatically reopens a thread when a new attendee message arrives.
- Optionally enable private messages to moderators in event settings. Attendees can send a private message from the separate conversation page or choose private in the public chat composer.
- Pin up to five published attendee questions, or let any moderator or admin write a standalone announcement pinned above the public chat.
- Block attendees by browser identity or IP address from the inbox or archive, review the blocked list, and restore access when needed. IP blocking also affects other people using the same public IP address.
- Manage moderator and stage accounts, update email addresses, passwords, roles and topic areas, deactivate accounts, or remove them from an event.
- Create an **event owner** account that can manage only its assigned event. Only the platform admin can create events or event owners.
- Send questions from the inbox or archive to the speaker queue without removing them from the public archive.
- Give speakers an iPad-friendly queue where they can select a question to display and mark it as read. Moderators can remove queued items; questions remain in the archive.
- Create a unique speaker link that expires after 12 hours, with a QR code for quick access.
- Export all event messages as a CSV, including private, pending, published, withdrawn, and rejected messages.
- Configure blocked words or phrases in the event's **Settings** tab. Matching attendee messages are stopped before publication or moderation.
- Switch between English, Dutch, German, and French interface text, choose light or dark mode, copy iframe embed code, and open the public chat directly from the event list.

## Deploy in Dockhand

Create a Compose stack in Dockhand and paste the Compose file below into its editor. The build context points to the GitHub release tag, so Docker can find the Dockerfile even when Dockhand's own stack folder does not contain the app files.

```yaml
services:
  8star-chat:
    build:
      context: https://github.com/TimoM84/8star-chat.git#v0.5.0
      dockerfile: Dockerfile
    image: 8star-chat:0.5.0
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
      FRAME_ANCESTORS: "${FRAME_ANCESTORS:-*}"
      TRUST_PROXY: ${TRUST_PROXY:-true}
    volumes:
      - 8star_chat_data:/data

volumes:
  8star_chat_data:
```

Set `ADMIN_PASSWORD` in Dockhand to a unique password of at least 12 characters. Set `ADMIN_EMAIL` to the platform admin email. `FRAME_ANCESTORS` controls which livestream page origins may embed the chat; set it to the relevant origin or origins (space-separated), for example `https://live.example.com https://www.example.com`. The default `*` allows embedding from any origin.

Deploy after the `v0.5.0` GitHub release exists. The app is reachable at `https://onlinechat.8star.nl/` when that domain's reverse proxy points to port `9876`. Configure the proxy for long-lived Server-Sent Events connections without buffering.

The named volume `8star_chat_data` holds event, account, and message data, plus a private key used to create keyed IP hashes for IP blocking (raw IP addresses are not stored). Keep a separate backup. The Compose example enables `TRUST_PROXY` for the reverse-proxy setup. Keep it enabled only when the proxy supplies a trustworthy `X-Forwarded-For` header; otherwise turn it off and IP blocking will be unavailable. IP blocking applies to everyone sharing that public IP, such as people on the same venue Wi-Fi. The CSV export is available in the moderator console under **Published / archive** and **Settings**. Export it before removing the stack or its volume.

Changing `ADMIN_PASSWORD` after the first run does not change the platform admin password already stored in the data volume. Event owner accounts are created by the platform admin from the event's **Team** tab and can access only that event.

## Routes

- `/` — administration and event list
- `/e/<event-slug>` — attendee chat iframe
- `/moderator/<event-slug>` — moderator console
- `/stage/<event-slug>` — speaker question page
- `/private/<event-slug>` — attendee private conversation in a separate page
- `/health` — health check

## First use

1. Sign in with the platform admin account configured in Dockhand.
2. Create an event and choose **Moderated**, **Read-only**, or **Open**.
3. Add moderators and enter the topics each moderator handles. Create an event owner if someone needs to manage this event without access to the platform.
4. Assign questions by topic in the inbox. Send a question from the inbox or archive to **Stage / cues**. The speaker can select it on an iPad and mark it read.
5. Review attendee messages in **Private messages**, reply, and close conversations when resolved. Search and filter them later; new attendee messages reopen a closed thread.
6. Publish moderator announcements from **Published / archive** to pin them above the public chat. Use **Blocked users** to restore attendee access when needed.
7. Add blocked words or phrases and optionally enable private messages in **Settings**.
8. Export the full message history as CSV from **Published / archive** or **Settings**.
9. Remove queued items from **Stage / cues** when the speaker should no longer see them. Use the same tab to create a temporary speaker link and QR code.

## Capacity and limitations

This is an initial functional version and has not been validated as a commercial production service. Data is stored in a JSON file in one container and active connections are handled by one Node.js process. It does not include clustering, shared session storage, automated backups, password recovery, email invitations, a comprehensive audit trail, or independent load testing. The configured connection limit does not prove the server can reliably handle that many attendees. Load-test the final server, reverse proxy, and network before promising capacity for 10,000 users.
