# Deploying Chatters from Zero

A complete walkthrough from a freshly created server to a working HTTPS deployment with notifications.

Every command is meant to be run in order. Where you must substitute your own value it is written in `UPPERCASE`.

- **Target OS:** Ubuntu 22.04 or 24.04 LTS (Debian 12 works with the same commands)
- **Time:** about 30 minutes
- **Result:** Chatters on `https://YOUR_DOMAIN`, auto-renewing certificate, automatic restart on reboot

For day-to-day usage, features and configuration reference, see [HELP.md](HELP.md).

---

## Before you start

You need three things:

1. **A server** with a public IP. 2 GB RAM is the practical minimum *if you build on the server* — the JavaScript build alone wants roughly 1.5 GB. A smaller or single-core box is fine as long as you build the images on your own machine and copy them across instead, which is usually the better approach anyway; see [Appendix A](#appendix-a--low-memory-servers-and-building-elsewhere).
2. **A domain name** you control.
3. **A DNS `A` record** pointing your domain at the server's IP, created *before* you request a certificate.

Check DNS has propagated before continuing:

```bash
dig +short YOUR_DOMAIN
```

That must print your server's IP. If it prints nothing, wait and try again — certificate issuance will fail otherwise.

> **Why HTTPS is not optional here.** End-to-end encryption uses the Web Crypto API and notifications use service workers. Browsers expose neither outside a secure context. Over plain HTTP, Chatters runs but secure chat and notifications are permanently unavailable.

> **Already running another Docker project on this server?** This walkthrough already assumes host nginx as the shared entry point, which is exactly what makes that work — but if that other project currently publishes 80/443 itself, it needs to move behind the same proxy first. See [Appendix C](#appendix-c--deploying-alongside-other-projects); `./scripts/bootstrap-vps.sh` detects this automatically and walks through it.

---

## Part 1 — Secure the server

SSH in as root:

```bash
ssh root@YOUR_SERVER_IP
```

Update everything:

```bash
apt update && apt upgrade -y
```

### Create a non-root user

Running the deployment as root is unnecessary risk.

```bash
adduser chatters
```

You will be prompted for a password. Then grant sudo:

```bash
usermod -aG sudo chatters
```

Copy your SSH key across so you can log in as the new user:

```bash
rsync --archive --chown=chatters:chatters ~/.ssh /home/chatters/
```

**Open a second terminal** and confirm you can log in before closing the root session — locking yourself out here is easy and annoying:

```bash
ssh chatters@YOUR_SERVER_IP
```

### Harden SSH

Once key login works, disable password authentication:

```bash
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/; s/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
```

```bash
sudo systemctl restart ssh
```

### Firewall

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 80/tcp
```

```bash
sudo ufw allow 443/tcp
```

```bash
sudo ufw --force enable
```

> **Important — Docker bypasses UFW.** Docker writes its own iptables rules, so a container that publishes a port to `0.0.0.0` is reachable from the internet *even though UFW says it is blocked*. This guide avoids that entirely by binding the app container to `127.0.0.1` only, so nothing but the host's own nginx can reach it. Do not change that binding without understanding this.

---

## Part 2 — Install Docker

Install from Docker's official repository rather than Ubuntu's (which ships an old version without Compose v2):

```bash
sudo apt install -y ca-certificates curl gnupg git
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Let your user run Docker without sudo:

```bash
sudo usermod -aG docker $USER
```

**Log out and back in** for the group change to take effect, then verify:

```bash
docker run --rm hello-world
```

Make sure Docker starts on boot (this plus `restart: unless-stopped` in the compose file is what brings Chatters back after a reboot — no systemd unit needed):

```bash
sudo systemctl enable --now docker
```

---

## Part 3 — Get the code

```bash
sudo mkdir -p /opt/chatters && sudo chown $USER:$USER /opt/chatters
```

```bash
git clone https://github.com/abolfazlkeshavarz/Chatters.git /opt/chatters
```

```bash
cd /opt/chatters
```

Everything from here runs in `/opt/chatters`.

---

## Part 4 — Configure

Create `.env` and generate the secrets:

```bash
make env && make secrets
```

`make secrets` fills in a random `JWT_SECRET` and a Web Push (VAPID) key pair. It never overwrites a value that is already set, so it is safe to re-run.

> If `make` is not installed: `sudo apt install -y make`. Without it, run `cp .env.example .env` then `bash scripts/gen-secrets.sh`.

Now edit the rest by hand:

```bash
nano .env
```

Set these four values:

```ini
# A strong database password — anything long and random.
POSTGRES_PASSWORD=A_LONG_RANDOM_PASSWORD

# The administrator account, created automatically on first boot.
ADMIN_USERNAME=YOUR_ADMIN_NAME
ADMIN_PASSWORD=A_STRONG_ADMIN_PASSWORD
ADMIN_EMAIL=you@YOUR_DOMAIN
```

And change the port line so the container is **only** reachable from the host:

```ini
HTTP_PORT=127.0.0.1:8082
```

That is the Docker-bypasses-UFW protection from Part 1. The host's nginx will be the only thing talking to it.

Generate a good database password with:

```bash
openssl rand -base64 32
```

### What the important settings mean

| Setting | Notes |
|---|---|
| `JWT_SECRET` | Signs login tokens. Generated for you. The backend **refuses to start** in production if it is missing, still the placeholder, or shorter than 32 characters. |
| `POSTGRES_PASSWORD` | Only ever used inside the Docker network — the database is never published to the host. Still, make it strong. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Creates this administrator on boot, or promotes the account if it already exists. It **never overwrites an existing password**, so leaving it in `.env` is safe. |
| `VAPID_*` | Web Push keys. Generated for you. Without them the app works but cannot notify a closed tab. |
| `HTTP_PORT` | Where the app container listens on the host. Keep the `127.0.0.1:` prefix. |
| `ALLOWED_ORIGINS` | Leave empty. Same-origin requests are always allowed; this is only for split-domain setups. |

Lock the file down — it holds every secret you just generated:

```bash
chmod 600 .env
```

---

## Part 5 — First start

Build and start everything:

```bash
make up
```

The first build takes a few minutes (it compiles the Go backend and builds the React app). Watch it come up:

```bash
docker compose ps
```

You want all three services `Up`, with `db` and `backend` marked `(healthy)`:

```
NAME                  STATUS
chatters-backend-1    Up 30 seconds (healthy)
chatters-db-1         Up 40 seconds (healthy)
chatters-frontend-1   Up 28 seconds
```

Confirm the app answers locally:

```bash
curl http://127.0.0.1:8082/healthz
```

Expected: `{"status":"ok"}`

Check the backend created the schema and your admin account:

```bash
docker compose logs backend | head -20
```

You should see `bootstrap: created administrator "YOUR_ADMIN_NAME"` and `listening on :8080`. The database schema is created and updated automatically on every boot — there is no separate migration step to run.

> Nothing is reachable from the internet yet. That is expected — nginx comes next.

---

## Part 6 — HTTPS

The design: host-level nginx owns ports 80/443 and is the *only* thing that does. It terminates TLS and reverse-proxies to the Chatters container over loopback. This is what makes running several projects on one server straightforward — each just gets its own subdomain and its own loopback port; see [Appendix C](#appendix-c--deploying-alongside-other-projects) once you have more than one.

```bash
sudo ./scripts/setup-nginx.sh
```

It installs nginx and certbot if needed, asks for the subdomain and a contact email, and then:

1. Writes an HTTP-only site so certbot's webroot challenge has something to answer.
2. Requests the certificate.
3. Rewrites the site for HTTPS, pointed at the loopback port from `HTTP_PORT` in `.env`.
4. Registers a `--deploy-hook` so certbot's own renewal (already scheduled by the package) reloads nginx automatically when the certificate renews.

Every reload is preceded by `nginx -t`; if the generated config fails that check it is removed again before reloading, rather than risking every other site on the box over one bad config.

Non-interactive:

```bash
DOMAIN=YOUR_DOMAIN LETSENCRYPT_EMAIL=you@example.com sudo -E ./scripts/setup-nginx.sh
```

### Confirm it works

```bash
curl -s https://YOUR_DOMAIN/healthz
```

Expected: `{"status":"ok"}`

Then open **https://YOUR_DOMAIN** in a browser. You should get the Chatters sign-in screen with a padlock in the address bar.

Want to see what it's going to write before running it for real?

```bash
make nginx-config
```

---

## Part 7 — First sign in

Sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` you set in Part 4.

You will see a third tab, **🛠️ مدیریت** (Administration). From there:

- **+ New user** creates accounts. Self-service signup is deliberately disabled, so this is how people get in.
- **Reset** sets a new password for someone.
- **Promote / Demote** manages administrators.

Give each person a temporary password and have them change it in **👤 پروفایل**.

> **Two things worth knowing before you use Reset.** It takes effect immediately — the user's existing sessions stop working at once rather than lingering. And it destroys their end-to-end encryption identity: their private key is wrapped with their old password, which nobody, including the server, can recover. They get a fresh key on next sign-in and can no longer read their existing encrypted messages. The panel warns you before confirming.

### Change the admin password

The password from `.env` was typed in plaintext into a file. Change it now in **👤 پروفایل → تغییر رمز عبور**.

`ADMIN_PASSWORD` in `.env` never overwrites an existing account, so your new password survives restarts and rebuilds.

---

## Part 8 — Notifications

`make secrets` already generated the VAPID keys, so push works server-side. Each user enables it for themselves in **👤 پروفایل → 🔔 Notifications**.

**On iPhone and iPad this only works from the Home Screen.** iOS does not expose the Push API to a normal Safari tab at all. Users must open the site in Safari, tap **Share → Add to Home Screen**, then launch Chatters from that icon and enable notifications there. The Profile page detects this and explains it rather than silently failing.

Android and desktop browsers work in an ordinary tab.

Messages in encrypted chats produce a content-free notification ("🔒 New encrypted message") — the server holds no key that could decrypt them, so there is nothing else it could show.

---

## Part 9 — Backups

Two things carry state: the Postgres database and the uploaded-files volume. Back up both.

Create a backup script:

```bash
sudo mkdir -p /opt/backups && sudo chown $USER:$USER /opt/backups && nano /opt/chatters/backup.sh
```

```bash
#!/usr/bin/env bash
# Backs up the Chatters database and uploaded files, keeping 14 days.
set -euo pipefail

cd /opt/chatters

STAMP=$(date +%F_%H%M)
DEST=/opt/backups
mkdir -p "$DEST"

# Database. -T because cron has no TTY. The credentials are read from the
# container's own environment rather than by sourcing .env, which would break
# on any password containing a space or a quote.
#
# --clean --if-exists matters: the backend recreates the schema on every boot,
# so a restore always lands in a database that already has the tables. Without
# these flags every CREATE TABLE fails as "already exists" and the data for
# those tables is silently skipped - you get a restore that reports success
# and returns almost nothing.
docker compose exec -T db sh -c \
  'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "$DEST/db_$STAMP.sql.gz"

# Uploaded files, read straight out of the named volume.
docker run --rm \
  -v chatters_uploads:/data:ro \
  -v "$DEST":/backup \
  alpine tar czf "/backup/uploads_$STAMP.tar.gz" -C /data .

find "$DEST" -name '*.gz' -mtime +14 -delete
echo "backup complete: $STAMP"
```

```bash
chmod +x /opt/chatters/backup.sh
```

Run it once to confirm it works:

```bash
/opt/chatters/backup.sh && ls -lh /opt/backups
```

Schedule it nightly at 03:00:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/chatters/backup.sh >> /var/log/chatters-backup.log 2>&1") | crontab -
```

> A backup on the same machine only protects against mistakes, not against losing the machine. Copy `/opt/backups` off the server periodically — `rsync`, `rclone` to object storage, or your provider's snapshots.

### Restoring

Stop the app first, so nothing is writing while the tables are replaced. Leave the database running:

```bash
cd /opt/chatters && docker compose stop backend frontend
```

Restore the database:

```bash
gunzip -c /opt/backups/db_STAMP.sql.gz | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

`ON_ERROR_STOP=1` makes psql abort on the first error instead of ploughing on and leaving you with a half-restored database that looks fine.

Restore the uploaded files:

```bash
docker run --rm -v chatters_uploads:/data -v /opt/backups:/backup alpine tar xzf /backup/uploads_STAMP.tar.gz -C /data
```

Start the app again:

```bash
docker compose start backend frontend
```

Then confirm the data really came back before you walk away:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM users"'
```

> **Test your restore before you need it.** Take a backup, run through the steps above on a scratch server, and check the row counts match. A backup you have never restored is a guess.

---

## Part 10 — Updating

```bash
cd /opt/chatters && ./backup.sh && git pull && make up
```

`make up` rebuilds and restarts. Database migrations run automatically on boot, so there is no separate step.

Confirm afterwards:

```bash
docker compose ps && curl -s https://YOUR_DOMAIN/healthz
```

### Rolling back

```bash
cd /opt/chatters && git log --oneline -10
```

```bash
git checkout COMMIT_HASH && make up
```

If the bad version changed the database, restore the backup you took before updating.

---

## Part 11 — Everyday operations

| Task | Command |
|---|---|
| Service status | `docker compose ps` |
| Follow all logs | `make logs` |
| Backend logs only | `docker compose logs -f backend` |
| Restart everything | `make restart` |
| Stop (keeps data) | `make down` |
| Start again | `make up` |
| Database shell | `make db-shell` |
| Shell in the backend | `make backend-shell` |
| Disk usage | `docker system df` |
| Reclaim space from old images | `docker image prune -a` |

> `make clean` deletes the database and all uploaded files. It is not a restart — do not reach for it when you mean `make down`.

### Health monitoring

Point your uptime monitor at:

```
https://YOUR_DOMAIN/healthz
```

It returns `{"status":"ok"}`, or `503` with `{"status":"degraded"}` if the database is unreachable. It exposes nothing else.

---

## Troubleshooting

**`origin not allowed` on every request**

Your proxy is sending the wrong Host header. It must be `proxy_set_header Host $http_host;` — `$host` drops the port and fails the same-origin check. Fix it, then `sudo nginx -t && sudo systemctl reload nginx`.

**Backend container restarts in a loop**

```bash
docker compose logs backend | tail -30
```

- `JWT_SECRET must be set...` — run `make secrets`, or set a value of 32+ characters.
- `database connection failed` — check `db` is healthy with `docker compose ps`, and that `POSTGRES_PASSWORD` in `.env` matches what the database was first created with. If you changed it after the first boot, the old password is baked into the data volume; either restore the old value or `make clean` and restore from backup.

**Messages only arrive after reloading the page**

The WebSocket is not getting through the proxy. Confirm `Upgrade`/`Connection` headers and the long `proxy_read_timeout` are present in your nginx site, then reload nginx. A "Reconnecting…" banner stuck on screen is the same symptom.

**Notifications button says unsupported**

On iOS, add the app to the Home Screen first (Part 8). Elsewhere, confirm the site is HTTPS and that `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set in `.env` — then `make up` to apply.

**Secure chat: "your encryption key is not available on this device"**

The key unlocks at sign-in. Sign out and back in. After an admin password reset this is expected, and older encrypted messages will not come back.

**Uploads fail on larger files**

`client_max_body_size` in the host nginx must be at least as large as `MAX_UPLOAD_BYTES` in `.env`. Both default to 20 MiB.

**Build killed during `make up`**

Out of memory — the frontend build needs ~1.5 GB. Either build on your own machine and copy the images over, or add swap: see [Appendix A](#appendix-a--low-memory-servers-and-building-elsewhere).

**Certificate renewal failing**

```bash
sudo certbot renew --dry-run
```

Port 80 must stay open and reachable — certbot uses it to prove domain control. Do not remove the `ufw allow 80/tcp` rule.

---

## Appendix A — Low-memory servers, and building elsewhere

Building the images needs real resources: the React build alone wants roughly 1.5 GB of RAM, and the Go build is CPU-bound. A small VPS — one core, 1 GB — will be slow at best, and the frontend build can get OOM-killed outright.

Two ways around it. **Building elsewhere is the better one** if you have any reasonably specced machine to hand, because the server then never compiles anything at all.

### Option 1 — Build on your own machine, ship the images (recommended)

Works from Windows, macOS or Linux; all it needs is Docker. No registry account, no external service — a single tarball you copy across.

**On your machine**, from the project root:

```bash
make build-images
```

That builds both images for `linux/amd64` (override with `PLATFORM=linux/arm64` if your server is ARM), checks they really came out as that architecture, and packs them into `dist/chatters-images.tar.gz` — about **64 MB**. It works on a fresh clone with no `.env`, using a throwaway one just to satisfy Compose and deleting it afterwards; nothing from it is baked into the images.

**Copy it over:**

```bash
scp dist/chatters-images.tar.gz YOUR_USER@YOUR_SERVER:/opt/chatters/
```

**On the server:**

```bash
cd /opt/chatters && ./scripts/load-images.sh
```

It loads both images and refuses if their architecture does not match the server — that mismatch is worth catching here, because it otherwise loads perfectly happily and only fails later at container start with a bare `exec format error`, which is a miserable thing to debug remotely.

Then start it. First-time setup (creates `.env`, checks ports, prompts for the admin account) — it detects the loaded images and skips building automatically:

```bash
./scripts/bootstrap-vps.sh
```

Or, if `.env` already exists from a previous deploy:

```bash
make up-prebuilt
```

`up-prebuilt` passes `--no-build`, so a missing image fails loudly instead of silently starting a build the server cannot finish.

**Updating later** is the same three steps: `make build-images` on your machine, `scp`, then `./scripts/load-images.sh && make up-prebuilt` on the server.

**About the base images:** `postgres` and `redis` are pulled from Docker Hub on the server rather than bundled, since they need no building. If you run the attendance system on the same box, `postgres:16-alpine` is *already there* — it uses the identical image — so only `redis:7-alpine` (~15 MB) is a new pull. If the server cannot reach Docker Hub at all, bundle them too:

```bash
INCLUDE_BASE=1 make build-images
```

### Option 2 — Add swap and build on the server anyway

If you would rather not involve a second machine, give the server enough memory to finish the build:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

Make it survive reboots:

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Confirm:

```bash
free -h
```

Building will be slow — swap is orders of magnitude slower than RAM — but it will finish.

---

## Appendix B — Security checklist

Work through this once the site is live.

- [ ] SSH password authentication disabled, key login confirmed working
- [ ] `ufw status` shows only 22, 80 and 443
- [ ] `HTTP_PORT=127.0.0.1:8082` in `.env` — the container is not published to `0.0.0.0`
- [ ] `chmod 600 .env`
- [ ] `JWT_SECRET` is 32+ random characters, not the placeholder
- [ ] `POSTGRES_PASSWORD` changed from `change_me`
- [ ] Admin password changed in the app, not just in `.env`
- [ ] HTTPS working, HTTP redirects to it, `certbot renew --dry-run` passes
- [ ] Backups running and `/opt/backups` has files in it
- [ ] Backups copied somewhere off this server
- [ ] Uptime monitor pointed at `/healthz`

Verify the container is genuinely not exposed — from your **local** machine, not the server:

```bash
curl --max-time 5 http://YOUR_SERVER_IP:8082/healthz
```

This must **fail** (timeout or connection refused). If it returns `{"status":"ok"}`, the container is published to the internet and bypassing your firewall: fix `HTTP_PORT` in `.env` and run `make up`.

Keep the host patched:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Appendix C — Deploying alongside other projects

The design for this: **one host-level nginx owns ports 80/443 and is the only thing that ever does.** Every project — Chatters, and anything else on the box — runs in Docker bound to a loopback port and gets its own subdomain and its own nginx server block. Nothing but that one nginx is reachable from the internet.

This is what Part 6 already sets up for Chatters alone. Adding a second project is the same shape again: give it a loopback port, give it a subdomain, give it a server block.

### Adding Chatters to a server that already has another project

If ports 80/443 are already free — nothing on the box yet, or the other project is *already* behind a host nginx of its own — just follow the [main walkthrough](#part-4--configure) normally; `HTTP_PORT=127.0.0.1:8082` in `.env` and `sudo ./scripts/setup-nginx.sh` add Chatters as one more site.

If something else currently publishes 80/443 directly — most often another project's own containerized web server, `ports: ["80:80", "443:443"]` in its `docker-compose.yml` — that has to move behind the shared proxy too, since only one process can hold those ports:

```bash
sudo ./scripts/bootstrap-vps.sh
```

It detects this automatically (checks *who* holds 80/443, not just whether they're free) and prints the exact steps, which come down to:

1. **In the other project's `docker-compose.yml`**, change its web service from publishing 80/443 to a loopback port instead:

   ```diff
   -  ports:
   -    - "80:80"
   -    - "443:443"
   +  ports:
   +    - "127.0.0.1:8081:80"
   ```

   Recreate it: `docker compose up -d` (from that project's directory).

2. **Give it its own nginx site**, the same shape Chatters gets — `sudo ./scripts/setup-nginx.sh` writes this pattern; for a project that isn't Chatters, copy the site file it produces (`/etc/nginx/sites-available/chatters`) as a template and point `proxy_pass` at that project's loopback port instead.

3. **Move its certificate under the shared nginx**, or issue a fresh one for it the same way `setup-nginx.sh` does — one certbot install serves any number of domains; each is independent.

4. Run `sudo ./scripts/setup-nginx.sh` for Chatters itself.

Every project ends up structurally identical: its own container(s), its own loopback port, its own nginx site, its own certificate. None of them are reachable except through the one host nginx.

### Why not let each project run its own containerized nginx on 80/443?

Because only one can. That is a hard OS-level constraint, not a Chatters opinion — two processes cannot bind the same port regardless of whether either is containerized. The host-owns-80/443 pattern above is the standard way around it: exactly one thing terminates TLS and does the port binding, and every application, containerized or not, sits behind it on a port nothing outside the machine can reach.

---

## What is running

```
Internet
   │  443 (TLS, Let's Encrypt)
   ▼
host nginx ──────────────► 127.0.0.1:8082
   │  (one more site block per project, if you host others too)
   ▼
                    ┌───────────────────────┐
                    │  frontend container   │  nginx: serves the React build,
                    │                       │  proxies /api, /login, /register
                    └───────────┬───────────┘
                                │ (docker network, not published)
                ┌───────────────┼───────────────┐
                ▼                               ▼
    ┌───────────────────┐           ┌───────────────────┐
    │  backend container │  ───────▶│  redis container   │  shared state, so
    │  Go: REST+WebSocket │           │  (optional; falls  │  the design also
    └──────────┬─────────┘           │  back to in-process │  scales past one
               │                     │  if absent)         │  backend replica
               ▼                     └────────────────────┘
    ┌───────────────────┐
    │  db container      │  PostgreSQL
    └────────────────────┘

Volumes: chatters_db_data (database), chatters_uploads (attachments)
```

Only the host's nginx is exposed. The application, the database, redis and the uploads are all reachable only from inside the Docker network.

