# Shortcuts for the commands used every day. PHP runs inside Docker, so each
# backend command is wrapped in "docker compose run".

API = docker compose run --rm api

.PHONY: setup dev down migrate fresh test test-api test-web ai-log prod-check audit app-key verify

setup: ## First-time setup
	docker compose build api
	$(API) composer install
	test -f api/.env || (cp api/.env.example api/.env && $(API) php artisan key:generate)
	$(API) php artisan migrate
	cd web && npm install

dev: ## Start database, API (localhost:8000) and frontend (localhost:5173)
	docker compose up -d db api
	cd web && npm run dev

down: ## Stop the containers
	docker compose down

migrate: ## Apply new migrations
	$(API) php artisan migrate

fresh: ## Drop every table and rebuild the schema
	$(API) php artisan migrate:fresh

test: test-api test-web ## Run every test and check

test-api:
	$(API) php artisan test
	$(API) ./vendor/bin/pint --test

test-web:
	cd web && npm run lint && npm run typecheck && npm test

ai-log: ## Save the AI conversation history into docs/ai-log
	node scripts/ai-log/snapshot.mjs

prod-check: ## Build and run the production stack locally and verify it end to end
	sh scripts/deploy/prod-check.sh

audit: ## Fail if a secret or private file is tracked by Git
	sh scripts/check-no-secrets.sh

app-key: ## Print a new application key. Run in your own terminal; never paste it into a chat.
	@$(API) php artisan key:generate --show

verify: ## Verify a deployment: make verify URL=https://x.vercel.app API_URL=https://y.onrender.com
	node scripts/deploy/verify-deployment.mjs $(URL) $(if $(API_URL),--api-origin=$(API_URL))
