# Chatters — Help & Deployment Guide

Chatters is a real-time messenger:

- **Backend** — Go (Gin), REST + WebSocket, PostgreSQL, JWT auth. [Chatters/](Chatters)
- **Frontend** — React (Create React App), installable as a PWA. [frontend/](frontend)
- **Reverse proxy** — nginx serves the React build and proxies `/login`, `/register`, `/api/*` and `/healthz` to the backend.

Features: direct and group chats, file attachments, three-state delivery receipts, an admin panel, opt-in end-to-end encryption, and push notifications.

---

## Quick start

Requires [Docker](https://docs.docker.com/get-docker/) with Compose v2. `make` is optional — every target is a one-line `docker compose` command.

```bash
make env && make secrets
```

That creates `.env` and fills in a random `JWT_SECRET` and a Web Push key pair. **Then open `.env` and set `ADMIN_USERNAME` / `ADMIN_PASSWORD`** — this is the account you will sign in with.

```bash
make up
```

Open **http://localhost** (or whatever `HTTP_PORT` you set).

Useful commands:

```bash
make logs
```

```bash
make ps
```

```bash
make down
```

`make clean` also deletes the database and uploaded files. `make help` lists everything.

---

## Configuration

All settings live in `.env` (see [.env.example](.env.example)).

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **yes** | Signs login tokens. The backend refuses to start in production without it. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Database credentials. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | recommended | Creates or promotes the first administrator on boot. Idempotent — it never overwrites an existing password. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | Web Push. Without them the app works normally but cannot notify a closed tab. Generate with `make vapid`. |
| `ALLOWED_ORIGINS` | no | Extra browser origins allowed to call the API. Same-origin is always allowed, so this is only needed when the SPA and API are on different hostnames. |
| `TRUSTED_PROXIES` | no | CIDRs whose `X-Forwarded-For` is believed. Defaults to the private ranges, which covers the bundled nginx. |
| `MAX_UPLOAD_BYTES` | no | Upload cap, default 20 MiB. Keep in step with `client_max_body_size` in [frontend/nginx.conf](frontend/nginx.conf). |
| `HTTP_PORT` | no | Host port nginx binds to. Default 80. |

The database schema is created and updated by migrations that run on every boot ([Chatters/internal/db/migrate.go](Chatters/internal/db/migrate.go)). There is no separate migration step and no init script to drift out of sync — a fresh container and a long-lived production database take the same path.

---

## Deploying to a server

1. Install Docker and Compose, clone the repo.
2. `make env && make secrets`, then edit `.env`: set `POSTGRES_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
3. `make up`.
4. Put HTTPS in front of it. **This matters for more than privacy:** service workers, push notifications and Web Crypto all require a secure context, so notifications and secure chat will not work over plain HTTP (except on `localhost`).

The simplest route is host nginx + certbot in front of the container port — [nginx/chatters](nginx/chatters) is a working reference for that, and [README.md](README.md) documents a full non-Docker VPS install.

Health endpoint for load balancers: `GET /healthz` → `{"status":"ok"}`.

---

## Admin panel

Sign in as the bootstrapped administrator and the **🛠️ مدیریت** tab appears. From there you can:

- see totals for users, chats and messages,
- search, create and delete users,
- reset a password,
- promote and demote administrators.

Guard rails: you cannot delete your own account, remove your own admin rights, or demote/delete the last remaining administrator.

Self-service signup is **disabled** — the login screen used to say "ظرفیت ها پر شد", so accounts are created from the admin panel instead. To reopen public registration, set `REGISTRATION_OPEN = true` in [frontend/src/App.js](frontend/src/App.js:14) and rebuild.

> **Resetting a password destroys that user's encryption identity.** Their private key is wrapped with their old password, which nobody — including the server — can recover. They get a fresh key on next sign-in and can no longer read their existing encrypted messages. The admin UI states this before you confirm.

---

## End-to-end encryption

Encryption is **per conversation and opt-in**. In a normal chat, press **🔒 Secure chat**. From that point the conversation opens on a separate secure page, and new messages are readable only by its members.

### How it works

| Layer | Mechanism |
|---|---|
| Identity | ECDH P-256 key pair, generated in the browser |
| Private key storage | Wrapped with AES-GCM under a PBKDF2-SHA256 key (310k iterations) derived from the account password; the server stores an opaque blob |
| Message body | Fresh AES-256-GCM key per message |
| Key distribution | That key is wrapped separately for each recipient using ECIES — an ephemeral ECDH pair plus HKDF-SHA256 |

The unlocked private key is cached in IndexedDB as a **non-extractable** `CryptoKey`: the browser will use it for key agreement but will not hand the bytes back to JavaScript, so a script-injection bug cannot copy it out.

The server stores ciphertext plus one wrapped key per recipient. It holds nothing that can decrypt anything — the admin panel can count encrypted messages but never read them. Push notifications for these chats say only "🔒 New encrypted message".

### Limits you should know about

- **Key substitution.** The server distributes public keys, so a malicious server could hand you its own key and sit in the middle. Open **Verify** in a secure chat and compare the safety number with the other person over a channel you already trust. This is the same caveat every messenger has.
- **Attachments are not encrypted**, so the file button is hidden in secure chats. Encrypting them properly is a separate piece of work; hiding the button is deliberate rather than pretending the padlock covers files.
- **History is not retroactive.** Messages sent before encryption was switched on stay readable.
- **Encryption cannot be switched off** once enabled — otherwise a compromised account could silently downgrade a conversation. Start a new chat instead.
- **Changing your password issues a new key.** Existing secure messages stay readable only on devices that still hold the old key.
- **Group chats are supported** (the message key is wrapped per member), but a member added later cannot read earlier messages.

---

## Message delivery states

Your own messages are coloured by how far they have got. There are no tick marks — the bubble itself is the indicator.

| Colour | State | Meaning |
|---|---|---|
| **White** | `sent` | Stored on the server. The recipient has no live connection, so it has not reached their device. |
| **Blue** | `delivered` | The recipient is connected and has the message, but has not opened the chat. |
| **Green** | `seen` | The recipient has the chat open and has read it. |

Incoming messages keep the neutral grey bubble regardless of state.

A message only ever moves forwards. Status updates can arrive out of order — a reconnect can re-run the delivery sweep just after a read receipt — so both the server and the client refuse to move a message back to an earlier state.

What advances each step:

- **delivered** — set when the recipient's WebSocket connects, which is also when a backgrounded phone wakes up. Being connected is deliberately *not* treated as having read the message.
- **seen** — set when the recipient actually opens the conversation, returns to an already-open one, or receives a message while looking at it.

In a **group chat**, delivered and seen mean *at least one* other member, not all of them. Per-recipient receipts would need a row per member per message, which this app does not store.

Colour is not an accessible signal on its own, so each of your messages also carries a hidden text label (`Sent` / `Delivered` / `Read`) for screen readers, and the same text appears on hover.

---

## Notifications and PWA

Chatters is installable and uses Web Push.

Turn notifications on in **👤 پروفایل → 🔔 Notifications**. This requires `VAPID_*` keys on the server and HTTPS.

**On iPhone and iPad, notifications only work if the app is added to the Home Screen** (iOS 16.4+). In a normal Safari tab, iOS does not expose the Push API at all. Tap Share → *Add to Home Screen*, then open Chatters from there. The Profile page detects this and says so rather than failing silently.

Android and desktop Chrome/Edge/Firefox work in a regular tab, though installing still gives a better experience.

To try this from a phone against a local checkout, see [Testing on a phone](#testing-on-a-phone) — plain HTTP will not do, because service workers need a secure context.

---

## Reconnection behaviour

The reported bug — *"after switching to another app and back, I have to close and reopen Chatters to receive new messages"* — had three separate causes, all fixed:

1. **The server tracked one connection per user.** When a phone woke from background it opened a new socket; moments later the old socket's read loop finally noticed it was dead and unregistered — deleting the *new* connection from the map. The user then looked offline to the server until the app was fully restarted. Connections are now tracked as a set per user and unregistering only removes that specific socket.
2. **Neither side had a keepalive.** Dead sockets were never detected. There is now a protocol-level ping from the server with a read deadline, plus an application-level heartbeat from the browser that forces a reconnect when the server stops answering.
3. **The client never reconnected.** It now reconnects with exponential backoff and jitter, and immediately when the tab becomes visible, the network returns, or the page is restored from the back/forward cache — which is exactly the app-switch case. On every reconnect it refetches the conversation, so anything sent during the gap is merged in rather than lost.

A banner appears while the connection is down, so this state is visible instead of silent.

---

## Testing on a phone

Browsers gate Web Crypto, service workers and the Push API behind a **secure context**. `localhost` counts as one; a LAN address like `192.168.1.5` does not. So how you serve the app decides which features you can exercise.

| | `make lan` | `make https` | `make tunnel` |
|---|---|---|---|
| Sign-in, chats, unread counts, delivery colours | yes | yes | yes |
| Secure (end-to-end encrypted) chats | **no** | yes | yes |
| Push notifications, PWA install | **no** | yes | yes |
| Setup needed on the phone | none | install a certificate | none |
| Reachable from the internet | no | no | **yes, while running** |

A crucial detail if you are tempted to shortcut this: **a self-signed certificate you click past does not work.** Browsers refuse to register a service worker when certificate validation fails, even after you accept the warning — so notifications would silently never arrive and it would look like an app bug. The certificate has to be genuinely trusted.

### Plain HTTP — quickest, limited

```bash
make lan
```

Binds to all interfaces and prints the URLs for a phone on the same Wi-Fi. `make lan LAN_PORT=9000` for a different port.

Sign-in degrades rather than failing: encryption key setup is skipped with a console warning and normal chats carry on. Good enough for testing message flow, unread counts and delivery colours.

### HTTPS on your network — full features, stays local

One-time setup. Install [mkcert](https://github.com/FiloSottile/mkcert), which creates a certificate authority your machine trusts:

```bash
brew install mkcert nss
```

(Windows: `choco install mkcert`. Linux: `apt install libnss3-tools` plus the release binary.)

Then issue a certificate covering this machine's addresses:

```bash
make certs
```

```bash
make https
```

That prints `https://<your-ip>:8443`. Use `make https HTTPS_PORT=9443` for a different port.

**The phone must trust the CA**, or the page will not load and service workers will not register. `make certs` prints the path to `rootCA.pem` — get that file onto the device (AirDrop, email it to yourself, or serve it over `make lan`) and then:

- **Android** — Settings → Security → Encryption & credentials → Install a certificate → CA certificate. Android warns loudly; that is expected for a private CA.
- **iOS/iPadOS** — open the file to install the profile, then Settings → General → VPN & Device Management to install it, **and then** Settings → General → About → Certificate Trust Settings and switch it on. The second step is separate and easy to miss — without it the certificate stays untrusted.

The certificate and key land in `certs/`, which is git-ignored. Never commit them.

### Public tunnel — full features, nothing to install

```bash
make up
```

```bash
make tunnel
```

Prints a `https://<random>.trycloudflare.com` URL with a publicly trusted certificate. Nothing to install on the phone, which makes this by far the easiest route on iOS.

The trade-off: **your development instance is reachable from the internet for as long as the tunnel runs.** The hostname is random and it dies on Ctrl-C, but do not leave it running unattended, and do not use real credentials you care about.

### Notifications specifically

Turn them on per device in **👤 پروفایل → 🔔 Notifications**. Requires `VAPID_*` keys on the server — `make secrets` generates them.

**On iPhone and iPad you must add the app to the Home Screen first** (iOS 16.4+). iOS does not expose the Push API to an ordinary Safari tab at all, no matter how good your certificate is. Share → *Add to Home Screen*, open Chatters from that icon, then enable notifications. The Profile page detects this and explains it rather than failing silently.

Android and desktop browsers work in a regular tab.

---

## Testing

```bash
make test
```

runs both suites. Individually:

```bash
cd Chatters && go vet ./... && go test ./...
```

```bash
cd frontend && CI=true npm test -- --watchAll=false
```

There is also an integration suite that drives the real HTTP and WebSocket API against a running stack — user management, access control, the encryption protocol, session invalidation and rate limiting:

```bash
ADMIN_PASSWORD=your_admin_password BASE_URL=http://localhost node scripts/integration-test.mjs
```

It deliberately reimplements the client side of the encryption protocol rather than importing the app's module, so the two implementations agreeing is real evidence the wire format is right.

The suite finishes by deliberately tripping the login rate limiter, which is held in memory. Running it twice in a row therefore fails early with `401 missing token`, because the second run's sign-in is still throttled. Restart the backend between runs:

```bash
docker compose restart backend
```

To run the Go tests under the race detector (needs a Linux toolchain):

```bash
docker run --rm -v "$PWD/Chatters:/src" -w /src golang:1.24-alpine sh -c "apk add --no-cache gcc musl-dev && go test -race ./..."
```

---

## Local development without Docker

**Backend** — Go 1.24+, PostgreSQL running locally:

```bash
cd Chatters && go run ./cmd/server
```

It connects to `postgres://postgres:admin@localhost:5432/messenger` by default and creates the schema itself. Override with `DATABASE_URL`, or the `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_SSLMODE` variables.

**Frontend** — Node 18+:

```bash
cd frontend && npm install && npm start
```

`package.json` sets `"proxy": "http://localhost:8080"`, so the dev server forwards `/login`, `/register` and `/api/*` (including the WebSocket) to a locally running backend.

---

## Project structure

```
Chatters/                  Go backend (module "messenger")
  cmd/server/               entrypoint
  cmd/vapid/                Web Push key generator
  internal/auth/             JWT signing, single-use WebSocket tickets
  internal/config/           environment configuration
  internal/db/               connection, migrations, admin bootstrap
  internal/handlers/         REST handlers
  internal/middleware/       auth, admin gate, rate limiting, CORS, headers
  internal/push/             Web Push delivery
  internal/validate/         input validation
  internal/websocket/        hub, client pumps, upgrade handler

frontend/
  src/api/                   typed wrappers around the REST API
  src/crypto/                 end-to-end encryption + key storage
  src/hooks/useChat.js        load, live update, reconnect resync, send
  src/components/             message list, composer, modals
  src/pages/                  Login, Register, ChatList, Chat, SecureChat,
                              Profile, Admin, Home
  src/services/websocket.js   reconnecting socket client
  public/sw.js                service worker (push + offline shell)
  nginx.conf                  routing inside the frontend container

nginx/                     reference config for a bare-metal VPS deploy
scripts/                   secret generation, integration tests
docker-compose.yml         db + backend + frontend
Makefile                   shortcuts for everything above
```

---

## Troubleshooting

**`make up` fails: "port is already allocated"** — something else is on `HTTP_PORT`. Change it in `.env`.

**Backend exits with "JWT_SECRET must be set"** — run `make secrets`, or set it manually in `.env`.

**"origin not allowed"** — the browser's `Origin` did not match the request's `Host`. If you terminate TLS or proxy on a non-default port, make sure your proxy forwards the real Host header (`proxy_set_header Host $http_host;` — note `$host` drops the port and will cause exactly this).

**Notifications button says the browser is unsupported** — on iOS, add the app to the Home Screen first. Everywhere else, check the site is served over HTTPS and that `VAPID_*` keys are set.

**Secure chat says "your encryption key is not available on this device"** — the key is unlocked at sign-in. Sign out and back in. After an admin password reset this is expected, and old encrypted messages will not come back.

**Messages stop arriving** — look for the reconnection banner. If it stays up, check `make logs` for the backend and confirm your proxy forwards the `Upgrade`/`Connection` headers for `/api/ws` (see [frontend/nginx.conf](frontend/nginx.conf)).

---

## Security notes

Fixed in this codebase, and covered by tests:

- `AddMember` had **no authorisation at all** — any authenticated user could add anyone to any chat. It now requires membership and rejects direct chats.
- The WebSocket accepted messages for **any** chat id without checking membership.
- Upload filenames were attacker-controlled and could escape the upload directory (`x_../../etc/passwd` survives `filepath.Base`). Names are now reduced to a single safe component and the final path is re-checked against the upload root.
- The download handler interpolated the filename straight into `Content-Disposition`, allowing header injection.
- The WebSocket upgrader accepted **every** origin, letting any site open an authenticated socket for a logged-in visitor.
- CORS reflected every origin.
- The long-lived JWT travelled in the WebSocket URL, where it lands in proxy logs and browser history. Replaced with single-use tickets that expire in seconds.
- JWTs had no algorithm pinning (`alg: none` confusion) and no revocation — a password change or account deletion left existing tokens valid for up to 72 hours.
- The hub read and wrote its client map from multiple goroutines without a lock, which crashes Go outright.
- The server's filesystem paths were exposed to clients in message payloads.
- No rate limiting on `/login`, no password or email validation, and user enumeration through response timing.
- Gin trusted every proxy, so `X-Forwarded-For` could be forged to bypass rate limiting.

Still worth doing: encrypting attachments, moving rate-limit state to Redis if you run more than one backend replica, and adding key-change alerts to secure chats.
