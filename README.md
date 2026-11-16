# Eneba-style marketplace

A marketplace for digital game keys, built for the Eneba internship
assignment: a store with filters and search, a homepage assembled from
backend-defined blocks, product pages comparing offers from several sellers,
and a checkout that delivers a digital key.

**Status: foundation.** The project structure, development environment, data
model and its tests are in place. Features are being added one at a time.

| | |
|---|---|
| Live URL | not deployed yet |
| Design and decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Hosting plan and verified free-tier limits | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| AI conversation history | [docs/ai-log/](docs/ai-log/README.md) |

## Stack

- **Frontend** (`web/`): React, TypeScript, Vite, React Router, TanStack Query, Tailwind
- **Backend** (`api/`): Laravel 13 on PHP 8.4, REST
- **Database**: PostgreSQL 17

## Repository layout

```
api/                  Laravel REST API
  app/Models, app/Enums
  database/migrations the data model
  database/factories  test data builders
  tests/              PHPUnit tests (run against real PostgreSQL)
web/                  React single-page app
docs/                 architecture, deployment plan, AI conversation log
scripts/ai-log/       saves the AI conversation history into docs/ai-log
docker-compose.yml    local PostgreSQL and PHP
```

## Running it locally

Requirements: Docker and Node.js 22. PHP and Composer are not needed on your
machine; they run inside a container.

```bash
make setup
```

```bash
make dev
```

`make setup` builds the PHP image, installs dependencies, creates `api/.env`
and runs the migrations. `make dev` starts the database, the API on
http://localhost:8000 and the frontend on http://localhost:5173.

## Tests and checks

```bash
make test
```

Runs the backend tests (PHPUnit against a separate `eneba_test` PostgreSQL
database), the backend code-style check, and the frontend lint, type check
and tests.

Other commands: `make migrate`, `make fresh` (drop and recreate all tables),
`make ai-log` (save the AI conversation history), `make down`.

## Scope

A few features are built in depth rather than everything thinly: the
product and seller-offer model, search, and checkout with key delivery.
What was cut and why is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#scope).
