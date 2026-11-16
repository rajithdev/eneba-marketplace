# Eneba-style marketplace

A marketplace for digital game keys, built for the Eneba internship
assignment: a store with filters and search, a homepage assembled from
backend-defined blocks, product pages comparing offers from several sellers,
and a checkout that delivers a digital key.

**Status: deployed.** Sign-up and sign-in work end to end, and the catalog
API (products, seller offers, filters) is live with a seeded catalog. The
store and product pages, search, cart and checkout, the homepage and the
Eneba styling are still to come, one at a time.

| | |
|---|---|
| Live URL | https://eneba-marketplace-ten.vercel.app |
| Design and decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Hosting plan and verified free-tier limits | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| AI conversation history | [docs/ai-log/](docs/ai-log/README.md) |

## Stack

- **Frontend** (`web/`): React, TypeScript, Vite, React Router, TanStack Query, Tailwind
- **Backend** (`api/`): Laravel 13 on PHP 8.4, REST
- **Database**: PostgreSQL 18

## Repository layout

```
api/                  Laravel REST API
  app/Models, app/Enums
  database/migrations the data model
  database/data       the curated catalog (games, platforms, regions, sellers)
  database/seeders    loads it; deterministic and safe to re-run
  database/factories  test data builders
  tests/              PHPUnit tests (run against real PostgreSQL)
web/                  React single-page app
  src/contracts/      example API responses, enforced by backend tests
  public/covers/      generated cover images, one per game
docs/                 architecture, deployment plan, AI conversation log
scripts/ai-log/       saves the AI conversation history into docs/ai-log
scripts/catalog/      draws the cover images from the catalog data
scripts/deploy/       local production check and deployment verification
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

Other commands:

| Command | What it does |
|---|---|
| `make prod-check` | Builds the production image and frontend, runs them locally with production settings, and verifies sign-up, sign-in and sign-out end to end |
| `make audit` | Fails if a secret or private file is tracked by Git |
| `make verify URL=…` | Runs the end-to-end checks against a deployed address |
| `make migrate`, `make fresh` | Apply migrations; drop and recreate all tables |
| `make ai-log` | Save the AI conversation history |
| `make down` | Stop the containers |

## Limitations and assumptions

Things a reviewer should know are deliberate, approximate or not done yet.

**Catalog data**

- Titles are real games, named only to say what a key is for. Descriptions
  were written for this project. Release dates and which platforms a title
  is sold on come from general knowledge and were not checked against a
  source; automated checks only catch inconsistencies (a DLC sold where its
  base game is not, a gift card in the wrong currency region, a future date).
- Sellers are invented. Prices, discounts, stock levels and the keys
  themselves are generated from hashes, not real market data. Keys are
  made-up strings that unlock nothing.
- Cover images are abstract pictures drawn by a script, one per game. They
  are not official artwork, on purpose: the project has no licence for that.
- One currency (EUR) throughout, including products for the United States.
- Editions (Standard, Deluxe) are not modelled. A different edition would be
  a separate game entry.

**Catalog behaviour**

- A product's price is worked out from its offers on every request, not
  stored. That is always correct and fast at this size (about 5 ms); at
  12,000 products the unfiltered list took about 120 ms on a laptop. Storing
  the best price would be the next step for a much larger catalog.
- `cover_image_url` is a path such as `/covers/elden-ring.svg`, served by
  the site itself. It means nothing on the API's own address, which visitors
  never use.
- Loading the catalog again (it happens on every deploy) restores offer
  prices to the data files and adds anything missing. It never changes a key
  that exists, a sales count, or whether an offer is switched on. A game
  removed from the data files is not removed from a deployed database.
- There is no search yet; typo-tolerant search is its own phase.

**Authentication**

- Sign-up, sign-in and sign-out only. No email verification, password reset
  or social login.

**Deployment (free tiers)**

- The API sleeps after 15 minutes without traffic; the first request then
  takes about a minute. What a visitor sees during that minute has not been
  observed yet.
- Migrations and catalog loading run when the container starts. The free
  plan has no shell or rollback step, so a faulty migration is corrected by
  a new one. The migration that introduced `games` refuses to run if
  products already exist, and changes nothing in that case.
- Each run of `make verify` leaves one throwaway `deploy-check-…` account
  in the production database.
- An API path ending in a slash is answered by the frontend host with its
  own 404 and never reaches the API.
- Rate limiting by caller relies on a header set by the API host's edge
  network; this was confirmed on the live service.

## Scope

A few features are built in depth rather than everything thinly: the
product and seller-offer model, search, and checkout with key delivery.
What was cut and why is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#scope).
