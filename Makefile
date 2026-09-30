# ==== Gungi Online — dev helpers ====
# `make` / `make help` shows this list.

.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help setup up build down restart clean fclean re logs logs-server logs-client ps db-shell server-shell client-shell dev install typecheck test

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## First-time setup: create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env — edit the placeholder values before running 'make up'")
	@test -f .env && echo ".env exists"

up: setup ## Build & start the full stack (the subject's single command)
	$(COMPOSE) up --build -d
	@echo "→ https://localhost:8443"

build: ## Build all docker images
	$(COMPOSE) build

down: ## Stop and remove containers
	$(COMPOSE) down

restart: down up ## Restart the full stack

clean: ## Stop containers and remove images built by compose
	$(COMPOSE) down --rmi local

fclean: ## clean + remove volumes (DB data is lost!)
	$(COMPOSE) down --rmi local --volumes

re: fclean up ## Full rebuild from scratch

logs: ## Tail logs of all services
	$(COMPOSE) logs -f

logs-server: ## Tail backend logs
	$(COMPOSE) logs -f server

logs-client: ## Tail frontend logs
	$(COMPOSE) logs -f client

ps: ## Show service status
	$(COMPOSE) ps

db-shell: ## Open psql inside the postgres container
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-gungi} -d $${POSTGRES_DB:-gungi}

server-shell: ## Shell into the server container
	$(COMPOSE) exec server sh

client-shell: ## Shell into the client container
	$(COMPOSE) exec client sh

# ---- local (non-docker) development ----

install: ## npm install for the whole workspace
	npm install

dev: ## Run client + server locally in watch mode
	npm run dev

typecheck: ## Typecheck all workspace packages
	npm run typecheck

test: ## Run all tests
	npm test
