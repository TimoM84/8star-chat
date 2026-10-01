# Load testing 8star Chat

The tools in `scripts/` need only Node.js (≥ 22) and no extra packages.

| Script                 | Purpose                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/loadtest.js`  | Load generator. Joins N attendees, keeps their live streams open, optionally sends messages, reports, and ends every test session. Works against a local server or the public URL.                                                                             |
| `scripts/e2e-burst.js` | Pass/fail test: N connected attendees each send one message at once. Starts a temporary local server unless `--url` is given.                                                                                                                                  |
| `scripts/probe.js`     | Preload module for measuring any server version: `node -r ./scripts/probe.js server.js`. Prints event-loop delay, CPU, memory, open sockets, requests in flight, accept→request and request→response times, and kernel accept-queue overflows once per second. |

Since v0.7.0 the server itself can log metrics: set `METRICS_LOG_SECONDS` (Compose default 60; use 5 during a test). Each line in `docker logs` is one JSON object with event-loop delay, CPU, memory, connections, counters per answer type (`post.201`, `post.429.room`, `post.429.user`, `post.503.overload`, `post.503.storage`, `post.replayed`), time per phase of a message (admission, storage, total), fan-out batches and buffered bytes, journal writes and snapshot count. It contains no message text, names, cookies or tokens.

## Scenarios

```sh
# Join only: how long until N attendees are connected
node scripts/loadtest.js --url https://chat.example.com --event testevent --attendees 5000 --scenario join --workers 4

# Normal traffic: 50 senders spread over 4.5 s
node scripts/loadtest.js --url https://chat.example.com --event testevent --attendees 2000 --scenario stream --senders 50 --duration 4.5

# Peak: every attendee sends one message at the same moment
node scripts/loadtest.js --url https://chat.example.com --event testevent --attendees 5000 --scenario burst --workers 4
```

Options: `--workers` (processes for the generator), `--join-concurrency` (default 200), `--timeout` (ms per request, default 15000), `--settle` (seconds to wait for deliveries, default 10), `--connections browser|fresh` (`browser`: one keep-alive request connection plus one stream connection per attendee, like a browser over HTTP/1.1; `fresh`: a new connection per request, like a reverse proxy without upstream keep-alive), `--tls-resume` (resume the TLS session for the second connection, as browsers do), `--session-minutes` (lifetime of test sessions, default 30), `--no-retry`, `--insecure` (accept a self-signed certificate), `--json file`.

The event must exist and be in **Open** mode for message scenarios, so accepted messages are published and can be counted on the live streams. Test messages are visible in that event's chat.

## Reading the report

- `join.seconds` — from the first join until every attendee's stream was ready. `join.latencyMs` per attendee.
- `posts.statuses` — first answers: `201` accepted, `200` replay of an accepted id, `429` limit, `503` overload (both: nothing stored), `timeout` / `error:…` no answer.
- `placed.uniqueMessageIds` — messages actually published, counted from the live streams (not from HTTP answers).
- `placed.placedButFirstAnswerFailed` — published although the first answer was not a success (e.g. time-out). After recovery (`verify`: status check and retry with the same id, like the browser does) `placed.placedWithoutSuccess` must be 0.
- `placed.duplicates` — the same sender's message published more than once. Must be 0.
- `deliveries` — expected (published × connected attendees) and received SSE deliveries; `fanoutMs` is receive time minus the server's `createdAt` (needs synchronised clocks when the generator runs on another host).
- `disconnects` — streams that closed without the test asking.
- `client` — CPU and event-loop delay of each generator process. If `lagMaxMs` is large, the generator itself was too slow and its time-outs and response times are not reliable: use more `--workers` or another machine.
- `cleanup` — sessions ended at the end.

## Rules for meaningful numbers

1. **Keep the generator off the server's CPU.** A generator on the same host competes with the app; TLS handshakes are expensive for the generator too (measured: ~2.7 ms CPU per full handshake in Node). Compare a run from the app host with a run from another machine before attributing time to the proxy.
2. **Separate the routes.** Run the same scenario against `http://127.0.0.1:9876` on the app host (app only) and against the public URL (proxy, TLS, network). The difference is the route, provided the generator was not the bottleneck in either run.
3. **Watch the proxy host** during the run (`docker stats` for its container, its error log for `worker_connections are not enough`, `upstream timed out`, `Connection reset by peer`).
4. **Check the kernel counters** of the app container before and after (`/proc/net/netstat`, `ListenOverflows`, `ListenDrops`).

## Clean-up and aborting

The generator ends every session it created (`session/end`) at the end of a run, and also on `SIGINT`/`SIGTERM` (stop a container with `docker stop -t 120`). Test sessions are created with a 30-minute lifetime (`--session-minutes`), so even a killed generator leaves nothing behind for long. Messages that were published stay in the event's chat history.
