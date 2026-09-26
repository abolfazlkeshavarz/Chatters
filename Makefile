.PHONY: help env preflight secrets vapid up lan certs https tunnel down restart build logs ps clean db-shell backend-shell \
        test backend-test frontend-test backend-build frontend-install frontend-build \
        bootstrap check-ports nginx nginx-config install-docker mirrors mirrors-go mirrors-npm \
        build-images load-images up-prebuilt \
        update-backend update-frontend migrate build-backend build-frontend \
        restart-backend restart-frontend logs-backend logs-frontend \
        build-images-backend build-images-frontend update-backend-prebuilt update-frontend-prebuilt

COMPOSE = docker compose

# Host port used by "make lan". Override: make lan LAN_PORT=9000
LAN_PORT ?= 8080

# Host port for "make https".
HTTPS_PORT ?= 8443

COMPOSE_HTTPS = docker compose -f docker-compose.yml -f docker-compose.https.yml

# Mirrors for a network where the real Go/npm registries are slow or blocked
# (e.g. some Iranian ISPs). Used by "make mirrors" (host toolchain, for local
# `go`/`npm` commands) and offered interactively by "make bootstrap" (Docker
# build args, via GOPROXY/NPM_REGISTRY in .env — see .env.example).
GO_PROXY := https://package-mirror.liara.ir/repository/go/
NPM_REGISTRY_MIRROR := https://package-mirror.liara.ir/repository/npm/

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  VPS quick start (from scratch, or alongside another project): make bootstrap"
	@echo "  VPS quick start (manual):  make env -> make secrets -> edit .env -> make up"
	@echo "  Local quick start (phone testing, no domain):  make lan  /  make https"
	@echo ""

## --- Setup ---

env: ## Create .env from .env.example if it does not exist yet
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo ".env created - now run 'make secrets' to fill in the generated values"; \
	else \
		echo ".env already exists"; \
	fi

# Invoked as "bash <relative path>" rather than through the script's shebang:
# relying on the shebang breaks when the checkout path contains a space, which
# is common on Windows.
secrets: env ## Generate JWT_SECRET and VAPID keys into .env (only fills empty values)
	@bash scripts/gen-secrets.sh

# Falls back to the built image so this also works on a server that has no Go
# toolchain, which is the normal case when images are built elsewhere.
vapid: ## Print a fresh Web Push VAPID key pair
	@if command -v go >/dev/null 2>&1; then \
		cd Chatters && go run ./cmd/server -vapid; \
	elif docker image inspect chatters-backend:latest >/dev/null 2>&1; then \
		docker run --rm chatters-backend:latest -vapid; \
	else \
		echo "Needs either Go, or the chatters-backend image (./scripts/load-images.sh)."; exit 1; \
	fi

## --- VPS deployment ---

bootstrap: ## Full zero-to-deployed setup on a fresh (or shared) Ubuntu/Debian VPS
	@bash scripts/bootstrap-vps.sh

check-ports: ## Check whether ports 80/443 are free, or already used by another project
	@bash scripts/check-ports.sh

nginx: ## Configure host nginx + Let's Encrypt for this app's subdomain (needs sudo)
	@bash scripts/setup-nginx.sh

nginx-config: ## Print the nginx config that would be installed, without changing anything
	@RENDER_ONLY=1 bash scripts/setup-nginx.sh

install-docker: ## Install Docker Engine + Compose v2 plugin (needs sudo/root)
	@test "$$(id -u)" = "0" || { echo "This command must be run with sudo: sudo make install-docker"; exit 1; }
	@install -m 0755 -d /etc/apt/keyrings
	@curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	@chmod a+r /etc/apt/keyrings/docker.asc
	@. /etc/os-release && echo "deb [arch=$$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $$VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
	@apt-get update
	@apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	@systemctl enable --now docker
	@echo "Docker installed."
	@docker compose version

mirrors: mirrors-go mirrors-npm ## Set Go/npm to use the Liara mirrors, for this user's host toolchain
	@echo ""
	@echo "Go and npm mirrors set for local commands (go build, npm install, etc)."
	@echo "For the Docker build to use them too, set GOPROXY/GOSUMDB/NPM_REGISTRY in .env"
	@echo "(bootstrap-vps.sh offers to do this for you), then: make build"

mirrors-go: ## Set the Go modules mirror for the current user's host toolchain
	@if ! command -v go >/dev/null 2>&1; then echo "go is not installed; skipped."; exit 0; fi
	go env -w GOPROXY=$(GO_PROXY),direct
	go env -w GOSUMDB=off
	@echo "go mirror set: $(GO_PROXY)"

mirrors-npm: ## Set the npm registry mirror (global, for the current user)
	@if ! command -v npm >/dev/null 2>&1; then echo "npm is not installed; skipped."; exit 0; fi
	npm config set registry $(NPM_REGISTRY_MIRROR) --global
	@echo "npm mirror set: $(NPM_REGISTRY_MIRROR)"

## --- Building elsewhere (for a server too small to build on) ---

build-images: ## [dev machine] Build images and pack them into dist/ to carry to the server
	@bash scripts/build-images.sh

load-images: ## [server] Load the image bundle copied from your machine
	@bash scripts/load-images.sh

# HTTP_PORT is unset for compose on purpose: a stray export in the shell would
# otherwise override .env and silently ignore whatever port it says.
preflight: env ## Check the host port in .env is free (and not shadowed by the shell)
	@bash scripts/preflight.sh

up-prebuilt: env preflight ## [server] Start the stack from already-loaded images, never building
	env -u HTTP_PORT $(COMPOSE) up -d --no-build --wait
	@$(COMPOSE) ps

## --- Docker deployment ---

up: env preflight ## Build images if needed and start the whole stack in the background
	env -u HTTP_PORT $(COMPOSE) up -d --build

# HTTP_PORT is set in the shell, which takes precedence over .env, so a
# checkout configured for a localhost-only production bind can still be opened
# from a phone without editing (and later forgetting to revert) .env.
lan: env ## Run reachable from phones on your network, and print the URL
	HTTP_PORT=$(LAN_PORT) $(COMPOSE) up -d --build
	@bash scripts/lan-url.sh $(LAN_PORT)

certs: ## Issue a locally-trusted TLS certificate for phone testing (needs mkcert)
	@bash scripts/gen-certs.sh

# Notifications and end-to-end encryption need a secure context, which a LAN
# address over plain HTTP is not. This serves the same stack over TLS.
https: env ## Run over HTTPS so notifications and secure chat work from a phone
	@if [ ! -f certs/cert.pem ]; then \
		echo "No certificate found. Run 'make certs' first."; exit 1; \
	fi
	HTTP_PORT=$(LAN_PORT) HTTPS_PORT=$(HTTPS_PORT) $(COMPOSE_HTTPS) up -d --build
	@bash scripts/lan-url.sh $(LAN_PORT) $(HTTPS_PORT)

tunnel: ## Expose the running stack on a temporary public HTTPS URL (no cert setup)
	@bash scripts/tunnel.sh

down: ## Stop and remove containers (data volumes are kept)
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

build: ## Rebuild all images without starting them
	$(COMPOSE) build

logs: ## Follow logs from all services
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

clean: ## Stop containers and delete volumes (DESTROYS the database and uploads)
	$(COMPOSE) down -v

db-shell: ## Open psql inside the running database container
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-chatters} -d $${POSTGRES_DB:-messenger}

backend-shell: ## Open a shell inside the running backend container
	$(COMPOSE) exec backend sh

## --- Updating one part (everything else keeps running) ---
#
# For when only one side changed. --no-deps stops compose from recreating the
# database, Redis or the other service, so they keep running untouched and
# nobody else's connection drops. The backend applies pending migrations
# every time it starts, so update-backend is also how a schema change ships.

update-backend: env ## Rebuild and restart ONLY the backend (runs its migrations on start)
	env -u HTTP_PORT $(COMPOSE) up -d --build --no-deps --wait backend
	@$(COMPOSE) ps backend

update-frontend: env ## Rebuild and restart ONLY the web frontend
	env -u HTTP_PORT $(COMPOSE) up -d --build --no-deps --wait frontend
	@$(COMPOSE) ps frontend

# Migrations also run on every backend start; this is for running them on
# their own (e.g. before switching traffic, or to check they apply cleanly).
# Uses the backend image as it is now - run update-backend / build-backend
# first if the migration is new code.
migrate: env ## Apply database migrations only, with the current backend image
	env -u HTTP_PORT $(COMPOSE) run --rm backend -migrate

build-backend: env ## Build the backend image only (nothing is restarted)
	$(COMPOSE) build backend

build-frontend: env ## Build the frontend image only (nothing is restarted)
	$(COMPOSE) build frontend

restart-backend: ## Restart only the backend container, without rebuilding
	$(COMPOSE) restart backend

restart-frontend: ## Restart only the frontend container, without rebuilding
	$(COMPOSE) restart frontend

logs-backend: ## Follow backend logs only
	$(COMPOSE) logs -f backend

logs-frontend: ## Follow frontend logs only
	$(COMPOSE) logs -f frontend

## --- Updating one part, built elsewhere (small servers) ---

build-images-backend: ## [dev machine] Build ONLY the backend -> dist/chatters-backend.tar.gz
	@bash scripts/build-images.sh backend

build-images-frontend: ## [dev machine] Build ONLY the frontend -> dist/chatters-frontend.tar.gz
	@bash scripts/build-images.sh frontend

update-backend-prebuilt: env ## [server] Load chatters-backend.tar.gz and restart only the backend
	@bundle="$$(ls -t chatters-backend.tar.gz dist/chatters-backend.tar.gz 2>/dev/null | head -1)"; \
	if [ -z "$$bundle" ]; then echo "chatters-backend.tar.gz not found - copy it here from 'make build-images-backend'"; exit 1; fi; \
	bash scripts/load-images.sh "$$bundle"
	env -u HTTP_PORT $(COMPOSE) up -d --no-build --no-deps --wait backend
	@$(COMPOSE) ps backend

update-frontend-prebuilt: env ## [server] Load chatters-frontend.tar.gz and restart only the frontend
	@bundle="$$(ls -t chatters-frontend.tar.gz dist/chatters-frontend.tar.gz 2>/dev/null | head -1)"; \
	if [ -z "$$bundle" ]; then echo "chatters-frontend.tar.gz not found - copy it here from 'make build-images-frontend'"; exit 1; fi; \
	bash scripts/load-images.sh "$$bundle"
	env -u HTTP_PORT $(COMPOSE) up -d --no-build --no-deps --wait frontend
	@$(COMPOSE) ps frontend

## --- Tests ---

test: backend-test frontend-test ## Run every test suite

backend-test: ## Go vet plus the backend test suite
	cd Chatters && go vet ./... && go test ./...

frontend-test: ## Frontend test suite (Jest), single run
	cd frontend && CI=true npm test -- --watchAll=false

## --- Local development (no Docker) ---

backend-build: ## Build the backend binary
	cd Chatters && go build -o chatters-server ./cmd/server

frontend-install: ## Install frontend dependencies
	cd frontend && npm install

frontend-build: ## Production build of the frontend
	cd frontend && npm run build
