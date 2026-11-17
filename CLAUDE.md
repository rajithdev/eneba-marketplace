# Working notes for AI sessions in this repository

Eneba internship assignment: an Eneba-style marketplace. Read
`docs/ARCHITECTURE.md` before changing anything; it holds the agreed design,
scope and the reasons behind them.

## Rules for this project

- **The whole conversation is published.** The assignment requires the full AI
  chat history. Never ask for, repeat or write secrets (API keys, passwords,
  database URLs) in chat. Secrets go in `.env` files, which are not committed.
- **Nothing is pushed or deployed, and no account or paid resource is created,
  without the author's explicit approval.**
- **Save the conversation at the end of every working session:** `make ai-log`.
  Never write or edit files in `docs/ai-log/` by hand, and never delete
  anything under `docs/ai-log/raw/`.
- **Work incrementally.** One feature at a time; after each, report what was
  created, issues met and test results, then wait for review.
- **The author must be able to explain every line.** Prefer plain, conventional
  Laravel and React. No extra layers (repositories, DDD, microservices).
- A few features in depth beat many thin ones. Check the scope table before
  adding anything not listed there.

## Environment

- PHP and Composer are not installed on the host (the macOS account is not an
  administrator, so Homebrew cannot install them). Everything PHP runs in
  Docker: `docker compose run --rm api <command>`, or the `make` shortcuts.
- PostgreSQL runs in Docker on host port 5434. Tests use the separate
  `eneba_test` database and need real PostgreSQL (trigram search, row locks).
- Node 22 runs on the host for `web/`.

## Commands

- `make test`: backend tests, style check, frontend lint, type check and tests
- `make dev`: database, API on :8000, frontend on :5173
- `make fresh`: rebuild the schema
- `make prod-check`: run the production build locally and verify it end to end (including buying a key)
- `make audit`: must pass before every push (no secrets or private files tracked)
