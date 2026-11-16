# Shortcuts for the commands used every day. PHP runs inside Docker, so each
# backend command is wrapped in "docker compose run".

API = docker compose run --rm api

.PHONY: setup dev down migrate fresh test test-api test-web contracts covers ai-log prod-check audit app-key verify verify-backend vercel-ready

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
	node scripts/deploy/check-vercel-config.mjs
	node scripts/catalog/generate-covers.mjs --check

contracts: ## Regenerate the example API responses in web/src/contracts, then review the diff
	docker compose run --rm -e UPDATE_CONTRACTS=1 api php artisan test --filter=CatalogContractTest
	git status --short web/src/contracts

covers: ## Regenerate the cover images in web/public/covers from the catalog data
	node scripts/catalog/generate-covers.mjs

ai-log: ## Save the AI conversation history into docs/ai-log
	node scripts/ai-log/snapshot.mjs

prod-check: ## Build and run the production stack locally and verify it end to end
	sh scripts/deploy/prod-check.sh

audit: ## Fail if a secret or private file is tracked by Git
	sh scripts/check-no-secrets.sh

app-key: ## Print a new application key. Run in your own terminal; never paste it into a chat.
	@$(API) php artisan key:generate --show

verify: ## Verify a deployment: make verify URL=https://x.vercel.app API_URL=https://y.onrender.com
	node scripts/deploy/verify-deployment.mjs $(URL) $(if $(API_URL),--api-origin=$(API_URL)) --expect-commit=$(shell git rev-parse origin/main)

verify-backend: ## Prove a backend address serves this repository's code: make verify-backend API_URL=https://y.onrender.com
	node scripts/deploy/verify-deployment.mjs $(API_URL) --api-origin=$(API_URL) --expect-commit=$(shell git rev-parse origin/main) --identity-only

vercel-ready: verify-backend ## Is it safe to deploy the frontend? make vercel-ready API_URL=https://y.onrender.com
	node scripts/deploy/check-vercel-config.mjs --expect-origin=$(API_URL)
