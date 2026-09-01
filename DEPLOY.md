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

> **Already running another Docker project on this server?** Ports 80/443 can only belong to one thing at a time, so the walkthrough below — which has Chatters own them directly — does not apply as-is. Skip to [Appendix C](#appendix-c--deploying-alongside-another-project) instead; `make bootstrap` there detects the conflict automatically and adapts.

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
HTTP_PORT=127.0.0.1:8080
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
curl http://127.0.0.1:8080/healthz
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

The host's nginx terminates TLS and forwards to the container.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create the site config:

```bash
sudo nano /etc/nginx/sites-available/chatters
```

Paste this, replacing `YOUR_DOMAIN`:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN www.YOUR_DOMAIN;

    # Must match MAX_UPLOAD_BYTES in .env (20 MiB by default). If this is
    # smaller, uploads fail at the outer proxy before reaching the app.
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # $http_host, NOT $host. $host strips the port, which breaks the
        # backend's same-origin check and makes every request fail with
        # "origin not allowed".
        proxy_set_header Host              $http_host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for live messaging. Without these the WebSocket handshake
        # fails and the app falls back to never receiving anything in real time.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Chat sockets are long-lived; the 60s default would cut them hourly.
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

Enable it and drop nginx's default placeholder site:

```bash
sudo ln -sf /etc/nginx/sites-available/chatters /etc/nginx/sites-enabled/chatters && sudo rm -f /etc/nginx/sites-enabled/default
```

Check the syntax before reloading:

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

Now request the certificate. Certbot edits the config above to add TLS and a redirect from port 80:

```bash
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

Choose **redirect** when asked whether to force HTTPS.

Verify auto-renewal is armed:

```bash
sudo systemctl status certbot.timer
```

Test the renewal path without actually renewing:

```bash
sudo certbot renew --dry-run
```

### Confirm it works

```bash
curl -s https://YOUR_DOMAIN/healthz
```

Expected: `{"status":"ok"}`

Then open **https://YOUR_DOMAIN** in a browser. You should get the Chatters sign-in screen with a padlock in the address bar.

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
- [ ] `HTTP_PORT=127.0.0.1:8080` in `.env` — the container is not published to `0.0.0.0`
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
curl --max-time 5 http://YOUR_SERVER_IP:8080/healthz
```

This must **fail** (timeout or connection refused). If it returns `{"status":"ok"}`, the container is published to the internet and bypassing your firewall: fix `HTTP_PORT` in `.env` and run `make up`.

Keep the host patched:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Appendix C — Deploying alongside another project

For a server that already runs a different project in Docker — its own `docker-compose.yml`, its own containers, quite possibly its own dockerized nginx already sitting on ports 80/443.

**The one thing that actually matters here is ports.** Everything else Compose does — container names, networks, volumes — is already namespaced by project name, so a second, differently-named project on the same Docker daemon cannot collide with the first one by accident. Ports are the exception: they are a single shared, host-wide resource, and two processes — containerized or not, related or not — cannot both bind :80.

### The automated path

```bash
git clone https://github.com/abolfazlkeshavarz/Chatters.git /opt/chatters
```

```bash
cd /opt/chatters
```

```bash
./scripts/bootstrap-vps.sh
```

It installs Docker if it is not already there (harmless to run even when it is — Docker itself happily hosts any number of independent compose projects side by side), asks for your domain and an admin username, then checks `ports 80 and 443`:

- **Free** — Chatters binds them directly, same as the [main walkthrough](#part-6--https). This is the case where nothing else is on the box yet.
- **Already in use** — the actual point of this appendix. It picks the first free port from 8091 up, binds Chatters to `127.0.0.1:THAT_PORT` (never `0.0.0.0` — never reachable from the internet directly), deploys, and **prints the exact nginx server block and certbot command** to wire your domain into whatever already owns 80/443. It does not edit that other project's files itself — you paste in what it prints.

You can run the same port check on its own at any time:

```bash
make check-ports
```

### What "wire it in" means, concretely

Say Chatters ends up on `127.0.0.1:8091` and your domain is `chat.example.com`. Two things need to happen on whatever already owns 80/443 — most often that other project's own containerized nginx, matching the `web` + `certbot` pattern several Docker project templates use:

**1. A new server block**, proxying the whole domain to Chatters:

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8091;
        proxy_http_version 1.1;

        # $host, not a variant that strips the port: Chatters checks that a
        # request's Origin matches its Host, so this has to be exactly what
        # the browser sees or every request is rejected as cross-origin.
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for live messaging (WebSocket).
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

Chatters does its own internal routing (API, WebSocket, static files) behind this single block — the other project's nginx only needs to be a plain pipe to `127.0.0.1:8091`, not reimplement any of that.

Where exactly this block goes depends on how that project structures its nginx config — check its `docker-compose.yml` for what's mounted into its web/nginx service. `bootstrap-vps.sh` prints this same block with your actual domain and port already filled in, plus the matching plain-HTTP block that redirects to it and answers the ACME challenge.

**2. A certificate for the new domain.** If that other project already runs its own certbot container against a webroot (as the block above assumes), the cheapest way to get one is to reuse it — run this **from that other project's own directory**, so it reuses its existing certbot image and its `/etc/letsencrypt` volume:

```bash
docker compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot --email you@example.com -d chat.example.com --agree-tos --no-eff-email" certbot
```

(Adjust the webroot path if that project uses a different one — check its nginx config for the `location /.well-known/acme-challenge/` block.) Its regular `certbot renew` — already scheduled for its own domain — renews this one too from then on: `certbot renew` renews everything it finds under `/etc/letsencrypt/live/`, not just the domain it was first set up for. Nothing extra to maintain.

If that other project does *not* already have its own certbot, or you would rather keep the two fully independent, get the certificate with a one-off standalone certbot run instead — this only needs port 80 free for a few seconds, which is fine even while the other project's nginx is up, since certbot can share the challenge briefly via the webroot method as long as the new domain's plain-HTTP server block (part 1, above) is already in place to serve it:

```bash
sudo apt install -y certbot
```

```bash
sudo certbot certonly --webroot -w /var/www/YOUR_WEBROOT -d chat.example.com
```

Point that path at wherever the plain-HTTP block above serves `/.well-known/acme-challenge/` from, and set up its own renewal (`sudo certbot renew --dry-run` to test, then a cron/systemd timer — `apt install certbot` usually adds one automatically).

### Why not just run Chatters' own nginx on 80/443 instead?

Because something already is. This is not a Chatters limitation — it is true of *any* two independent web-facing Docker projects on one server: exactly one process gets to hold each of those ports, full stop. The pattern above (one edge proxy per port, everything else on `127.0.0.1:*`) is the standard way around that, and it is also exactly what the [main walkthrough](#part-6--https) already does for the single-project case — there, Chatters' own container is the thing on `127.0.0.1:8080` and a host-installed nginx is the edge. Sharing a server just means a *pre-existing* edge does that job instead of a fresh one, for both projects at once.

---

## What is running

```
Internet
   │  443 (TLS, Let's Encrypt)
   ▼
host nginx ──────────────► 127.0.0.1:8080
                                │
                    ┌───────────┴────────────┐
                    │  frontend container    │  nginx: serves the React build,
                    │                        │  proxies /api, /login, /register
                    └───────────┬────────────┘
                                │ (docker network, not published)
                    ┌───────────┴────────────┐
                    │  backend container     │  Go: REST + WebSocket
                    └───────────┬────────────┘
                                │
                    ┌───────────┴────────────┐
                    │  db container          │  PostgreSQL
                    └────────────────────────┘

Volumes: chatters_db_data (database), chatters_uploads (attachments)
```

Only the host's nginx is exposed. The application, the database and the uploads are all reachable only from inside the Docker network.
