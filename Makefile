.PHONY: help env secrets vapid up lan certs https tunnel down restart build logs ps clean db-shell backend-shell \
        test backend-test frontend-test backend-build frontend-install frontend-build \
        bootstrap check-ports install-docker mirrors mirrors-go mirrors-npm

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
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'
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

vapid: ## Print a fresh Web Push VAPID key pair
	cd Chatters && go run ./cmd/vapid

## --- VPS deployment ---

bootstrap: ## Full zero-to-deployed setup on a fresh (or shared) Ubuntu/Debian VPS
	@bash scripts/bootstrap-vps.sh

check-ports: ## Check whether ports 80/443 are free, or already used by another project
	@bash scripts/check-ports.sh

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

## --- Docker deployment ---

up: env ## Build images if needed and start the whole stack in the background
	$(COMPOSE) up -d --build

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
