# Architecture and decisions

This document records what the project is made of, why each choice was made,
and what was deliberately left out. Sections marked **Built** exist in the
repository today; sections marked **Planned** are agreed designs that the next
increments implement.

## Overview

```
Browser ──> React app (web/)  ──/api/*──>  Laravel REST API (api/)  ──>  PostgreSQL
            static files                   one application                one database
```

- **web/**: React, TypeScript, Vite, React Router, TanStack Query, Tailwind.
- **api/**: Laravel 13 (PHP 8.4), REST, JSON only.
- **PostgreSQL**: required, not interchangeable. Search uses the `pg_trgm`
  extension and checkout uses `SELECT ... FOR UPDATE SKIP LOCKED`.

The browser only ever talks to the frontend's own address. Requests to `/api`
are forwarded to Laravel by a proxy: Vite's dev server locally, a rewrite rule
on the frontend host in production. That one decision removes CORS and makes
cookie-based login possible (see Authentication).

It is one Laravel application, not microservices. The assignment says each
homepage block gets its content "from its own backend service or database";
that is implemented as one service class per block type inside the same
application (see Homepage).

## Scope

The assignment says a few features done extensively beat many done minimally,
and that scope must be justified.

| Depth | Features |
|---|---|
| Deep, with backend tests | Product and seller-offer model, search, checkout with key delivery |
| Solid but standard | Store filters, sorting and pagination; authentication; homepage blocks; order history |
| Cut | Seller accounts and dashboards, admin UI, reviews, wishlist, multiple currencies, emails, refunds UI, server-side rendering, genres, password reset, social login |

Sellers are catalog data: they are seeded, they do not log in.

## Data model (Built)

Migrations are in `api/database/migrations`, one file per area.

```
platforms        id, name, slug
regions          id, name, slug
products         id, slug, name, description, cover_image_url, platform_id,
                 region_id, type, release_date, sales_count
sellers          id, name, slug, rating_percent, sales_count
offers           id, product_id, seller_id, price_cents, original_price_cents,
                 currency, is_active
license_keys     id, offer_id, code, status, order_item_id, reserved_until, sold_at
users            id, name, email, password            (plus Laravel's sessions table)
orders           id, public_id, user_id, status, total_cents, currency,
                 idempotency_key, failure_reason, paid_at
order_items      id, order_id, offer_id, product_id, product_name, seller_name,
                 unit_price_cents, quantity
payments         id, order_id, provider, provider_reference, status,
                 amount_cents, currency, failure_code
homepage_blocks  id, type, title, position, config, is_active
banners          id, title, subtitle, image_url, link_url, cta_label, position, is_active
```

### Products, sellers and offers

- A **product** is one sellable variant, as on Eneba: a title on one platform
  for one region ("Elden Ring Steam Key GLOBAL"). It has no price.
- An **offer** is one seller's price for one product. A seller has at most one
  offer per product (unique constraint). The product page lists every offer so
  the buyer can compare; the cart holds offers, because the buyer chose a seller.
- A **license key** is one unit of an offer's stock.

Decisions and their trade-offs:

- **Stock is not a column.** It is the count of available keys, so the number
  shown can never disagree with what can actually be delivered. The cost is a
  count query instead of reading a number; a partial index keeps that cheap.
- **The cheapest price is computed when queried**, not stored on the product.
  Always correct, and fast at this data size. Storing it would be the next step
  at scale, at the cost of keeping it in sync.
- **Money is whole cents in integer columns**, one currency (EUR). No floats.
- **No parent "game" table** grouping variants of the same title. It would
  enable "other editions of this game" links, which are out of scope.
- **Order lines copy** the product name, seller name and unit price, so order
  history stays correct after later renames or price changes.

### Rules the database enforces

Application code can have bugs; these hold regardless. Each is covered by a
test in `api/tests/Feature/Schema`.

| Rule | Mechanism |
|---|---|
| A seller has one offer per product | unique `(product_id, seller_id)` |
| A price is positive; a "was" price is not below the current price | check constraints |
| The same checkout attempt cannot create two orders | unique `(user_id, idempotency_key)` |
| An order is charged at most once | unique `payments.order_id` |
| A key is available, reserved or sold, and each state is internally consistent (for example, a sold key always belongs to an order line) | check constraint `license_keys_state_check` |
| A key code exists once | unique `code` |
| Statuses and product types are from a known list | check constraints |

### Changes from the model first proposed

Two additions, both made to meet the checkout requirements below:

1. `license_keys` gained a `reserved` state and `reserved_until`.
2. A `payments` table was added instead of payment columns on `orders`.

## Checkout and key delivery (Planned; schema and locking proof Built)

Requirements: handle concurrent purchases, duplicate requests and failures
mid-way correctly; keep simulated payment separate from inventory allocation.

### Three steps, two short transactions

```
1. Reserve   (one DB transaction)   re-price the cart from current offers,
                                    lock and reserve the keys, create the order
                                    and its payment row, both "pending"
2. Charge    (no transaction open)  ask the payment gateway to charge
3. Finalise  (one DB transaction)   success: keys -> sold, payment -> succeeded,
                                             order -> paid
                                    decline: keys -> available, payment and
                                             order -> failed
```

The first proposal ran everything in a single transaction. That is simpler,
but it holds database row locks while waiting for a payment call, and it
cannot represent "the money moved but the order was not saved". Splitting it
costs a `reserved` state and a timeout, and buys correct behaviour in every
failure below.

### Separate responsibilities

| Class | Knows about | Does not know about |
|---|---|---|
| `InventoryAllocator` | keys: reserve, confirm, release | payments |
| `PaymentGateway` (interface) and `SimulatedPaymentGateway` | charging an amount against a reference | keys, orders |
| `PlaceOrder` | the sequence of the three steps | how either of the above works inside |

The simulated gateway accepts documented test card numbers (one succeeds, one
is declined) and never stores card data. A real provider would be another
implementation of the same interface.

### What happens when things go wrong

| Situation | Outcome |
|---|---|
| Two buyers want the last key at the same moment | Step 1 selects keys with `FOR UPDATE SKIP LOCKED`. One transaction locks the key; the other skips it, finds none, and returns "out of stock" (HTTP 409) without waiting. |
| Double click, browser retry, or network retry | The browser sends the same `Idempotency-Key` for one checkout attempt. The unique constraint lets only one order exist; the repeat request returns that order's current result instead of charging again. |
| Price or stock changed since the cart was loaded | Step 1 re-prices from the database. If the total differs from what the buyer saw, nothing is reserved and the response carries the new quote (HTTP 409). |
| Payment declined | Step 3 releases the keys and marks the order failed (HTTP 402). Stock is back immediately. |
| Server dies after reserving, before the payment result | The order stays pending. The reservation expires after `reserved_until` (15 minutes); expired reservations are released the next time stock for that offer is allocated, so no background worker is needed on the free tier. |
| Payment succeeded but step 3 failed | Retrying with the same idempotency key finds the pending order and asks the gateway again using the same reference; the gateway returns the original charge rather than charging twice, and step 3 runs again. If the reservation has expired and the keys are gone, the charge is refunded and the order marked failed. |

### Tests

Built now, in `KeyLockingTest`: two real database connections prove that
simultaneous buyers are never given the same key and that the last key goes to
exactly one of them.

Planned with the checkout increment: successful purchase delivers the right
keys; two concurrent checkouts for the last key (real parallel processes);
duplicate request returns one order and one charge; declined payment releases
keys; expired reservation is reclaimed; crash between charge and finalise
recovers on retry; price change is rejected; a buyer cannot read another
buyer's order or keys.

## Authentication (Decided; wiring started)

Laravel's guidance is cookie-based sessions for a first-party SPA, and it
states that the SPA and API must share the same top-level domain. Our hosts
would be `*.vercel.app` and `*.onrender.com`. Both are on the Public Suffix
List, so browsers treat them as unrelated sites, and a cookie set by the API
would be a third-party cookie: blocked by Safari and by Chrome Incognito.
Pointing the SPA directly at the API with cookies therefore does not work.

| Option | Security | Fits the deployment | Cost |
|---|---|---|---|
| A. Bearer token kept in the browser | Token readable by any injected script; Sanctum tokens do not expire by default. Laravel's docs say not to use this for a first-party SPA. | Yes, anywhere | Lowest |
| **B. Session cookie, API proxied under the frontend's address** | HttpOnly cookie, not readable by scripts; CSRF covered by SameSite=Lax and Laravel's origin check with token fallback | Yes: the browser sees one origin, so the cookie is first-party | A rewrite rule and proxy settings |
| C. Laravel serves the built SPA itself | Same as B | Yes, single service | The whole site, not just the API, is unavailable for about a minute after the free host sleeps |

**Decision: B.** It is the approach Laravel recommends, it works in every
browser, and it keeps the frontend loading instantly while the API wakes.
All routes the browser needs, including Sanctum's CSRF route, live under
`/api`, so a single rewrite rule covers everything.

One thing is not yet proven: the frontend host's documentation does not state
explicitly that `Set-Cookie` passes through its rewrite. This is checked on
the first deployment, in Safari and in a private window, before any feature
depends on it. **Fallback: C**, which needs no proxy at all. Option A stays a
last resort.

Built so far: Sanctum installed; `statefulApi()` enabled; the Vite dev proxy
gives development the same single-origin shape as production.

## Search (Planned; extension and index Built)

One implementation serves both the header search and the store's name filter.

- PostgreSQL `pg_trgm` with a GIN index on `products.name`. Ranking: names that
  start with or contain the query first, then trigram similarity, then
  popularity. Queries under three characters fall back to prefix matching.
- Measured on test data: PostgreSQL's default similarity threshold (0.6)
  misses a single dropped letter in a nine-letter word ("mincraft" scores
  0.58). The search increment sets its own lower threshold.
- Alternative considered: a dedicated search engine such as Meilisearch. Better
  ranking, but a second always-on service and a sync job on a free tier.

## Homepage (Planned; tables Built)

`homepage_blocks` is the layout: which blocks, in what order, with what
settings. Each block type has one service class that fetches its content from
its own source:

| Block type | Service reads from |
|---|---|
| Hero banner | `banners` table |
| Best sellers | products ordered by `sales_count` |
| Deals | offers where the original price is above the current price |
| New releases | products ordered by `release_date` |

`GET /api/homepage` returns the active blocks in order, each with its type,
title and data. The frontend maps a type to a component and skips types it
does not know. Reordering, hiding or adding a block is a database row change;
nothing about the homepage is hardcoded in the frontend.

## Seed data and images (Decided; implemented with the catalog increment)

**Reproducible data.** The catalog is a curated dataset kept as JSON files in
the repository and loaded by seeders. Seeding is deterministic: the same
command produces the same products, offers, prices and keys on any machine.

**Image rights.** No third-party artwork is used.

- Game cover art belongs to its publishers. Images from store CDNs or from
  game-database APIs (RAWG, IGDB) are that same publisher artwork; an API key
  grants access to data, not a licence to republish the art. Those sources are
  therefore ruled out. (This is a cautious reading, not legal advice, and the
  APIs' current terms were not re-read for this decision.)
- Product covers and banners are **original images generated by a script in
  this repository** from the seed data (title, platform, a colour derived from
  the name). We own them outright, they need no attribution, and the site does
  not depend on anyone else's server.
- `cover_image_url` is an ordinary column, so properly licensed artwork can
  replace a generated cover later without code changes.
- Eneba's logo is not copied. The header uses a plain text wordmark; colours,
  typography and spacing follow eneba.com as the assignment asks.

Open point for review: product names are real game titles, used only to say
what a key is for. If that is not wanted, the dataset can use invented titles
instead; nothing else changes.
