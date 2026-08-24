.PHONY: help env secrets vapid up down restart build logs ps clean db-shell backend-shell \
        test backend-test frontend-test backend-build frontend-install frontend-build

COMPOSE = docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

## --- Setup ---

env: ## Create .env from .env.example if it does not exist yet
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo ".env created — now run 'make secrets' to fill in the generated values"; \
	else \
		echo ".env already exists"; \
	fi

secrets: env ## Generate JWT_SECRET and VAPID keys into .env (only fills empty values)
	@./scripts/gen-secrets.sh

vapid: ## Print a fresh Web Push VAPID key pair
	cd Chatters && go run ./cmd/vapid

## --- Docker deployment ---

up: env ## Build images if needed and start the whole stack in the background
	$(COMPOSE) up -d --build

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
