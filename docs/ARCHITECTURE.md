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
games            id, slug, title, description, cover_image_url, type, release_date
products         id, slug, name, game_id, platform_id, region_id, sales_count
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

### Games, products, sellers and offers

- A **game** is the title itself (or a DLC, gift card or subscription): its
  description, cover, type and release date, stored once.
- A **product** is one sellable variant of a game, as on Eneba: that game on
  one platform for one region ("Elden Ring Steam Key GLOBAL"). It has no
  price and repeats none of the game's details. A game is sold at most once
  per platform and region (unique constraint).
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
- **Games and products are separate tables.** The first version kept
  everything on the product, so the same description and cover were repeated
  for every platform and region. Splitting them costs one join and removes the
  duplication; it also gives the product page its list of "the same game on
  other platforms and regions" for free.
- **A product still stores its `name`** ("Elden Ring Steam Key GLOBAL")
  although it is derived from the game, platform and region. It is built in
  one place (`Product::displayName`), never typed, and kept as a column
  because the trigram search index needs a single text column to index.
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
| A game is sold at most once per platform and region | unique `(game_id, platform_id, region_id)` |
| A game with variants, or a platform or region in use, cannot be deleted | foreign keys |
| Statuses and game types are from a known list | check constraints |

### Changes from the model first proposed

Two additions made to meet the checkout requirements below, and one made
with the catalog:

1. `license_keys` gained a `reserved` state and `reserved_until`.
2. A `payments` table was added instead of payment columns on `orders`.
3. `games` was split out of `products` (see above). Done as a new migration,
   not by editing the first ones, because those had already run in production.

## Catalog API (Built)

Public, read-only, and the single source of everything the store shows.

| Endpoint | Returns |
|---|---|
| `GET /api/filters` | Platforms, regions and types with product counts; the current price range; the sort orders and page sizes the list accepts |
| `GET /api/products` | A page of products with the best price, stock flag and number of sellers. Filters: `platform`, `region`, `type` (comma-separated), `min_price`, `max_price` (cents). `sort`: `popular`, `price_asc`, `price_desc`, `newest`. `page`, `per_page` (24 by default, 48 at most). |
| `GET /api/products/{slug}` | The product, its game's details, every active offer with its seller, and the game's other variants |

How it behaves:

- **One definition of "can be bought".** An offer is sellable when the seller
  has it switched on and it has a key that is neither reserved nor sold
  (`Offer::scopeSellable`). A product's price is its cheapest sellable offer
  (`Product::scopeWithBestOffer`). The list, the filters' price range and the
  product page all use these two, so they cannot disagree.
- **Sold out** means no sellable offer: `in_stock` is false and `price` is
  null. Such products stay visible, come after available ones in every sort
  order, and never match a price filter.
- **Offers on a product page**: purchasable ones first, cheapest first, so
  the first row is always the price the list showed.
- **Validation**: an unknown platform, region, type or sort, a negative or
  inverted price range, or a page size above the maximum is a 422 with a
  message per field. An empty value (`platform=`) means "no filter". A page
  past the end is an empty list.
- **Money** is `{amount_cents, currency, original_amount_cents,
  discount_percent}`; the frontend only formats it.
- **Key codes never leave the checkout.** No catalog response contains one.
- **Cost**: the list runs five queries whatever the page size (count, page,
  and one each for games, platforms, regions); the product page runs ten.

**Typed responses.** Each shape is defined by a Laravel resource class.
`web/src/contracts` holds one example response per endpoint, generated from
the seeded catalog. `CatalogContractTest` fails if the API stops returning
exactly those; the frontend's TypeScript types are checked against the same
files. `make contracts` regenerates them after an intended change.

**Performance.** Measured on the seeded catalog (71 products) and on a
scratch dataset 170 times larger (12,000 products, 60,000 offers, 249,000
keys), on a laptop:

| Request | 71 products | 12,000 products |
|---|---|---|
| List, default sort | 5 ms | 117 ms |
| List, platform + region + price range | 5 ms | 25 ms |
| List, page 400 of 500 | n/a | 335 ms |
| Filters | 2 ms | 52 ms |
| Product page | 5 ms | 4 ms |

The query plan uses the two indexes built for this: `(product_id,
price_cents)` on offers to find the cheapest offer per product, and the
partial index on available keys, read index-only. The unfiltered list at the
larger size is slower because the best price of every product is worked out
before sorting, once for the count and once for the page. That is the known
limit of computing prices on read; storing the best price on the product
(and keeping it in sync when offers or keys change) is the step to take if
the catalog ever grows that large.

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

## Authentication (Built; awaiting proof on the deployed site)

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

How it works:

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`. Everything the browser calls is under `/api`, including
  Sanctum's CSRF route, so one rewrite rule covers it.
- Signing in creates a server-side session (stored in the database) and sends
  its id in an HttpOnly, Secure, SameSite=Lax cookie with no Domain attribute.
  JavaScript never holds a credential.
- The session id is replaced on sign-in (against session fixation) and the
  session is destroyed on the server on sign-out, so a copied cookie stops
  working.
- Only requests whose Origin or Referer is the frontend's address may use the
  session. That address comes from one setting, `FRONTEND_URL`.
- CSRF: Laravel 13 accepts a request that changes data if the browser marks it
  same-origin (`Sec-Fetch-Site`) or if it carries the token from the readable
  `XSRF-TOKEN` cookie. The frontend always sends the token, so both paths work.
- Sign-in and sign-up are rate limited per visitor address, per edge address
  and per email address, so the limits hold even for callers that bypass the
  frontend and forge their address (see DEPLOYMENT.md, "Calling the API host
  directly").
- `GET /api/auth/me` answers `{"data": null}` for a visitor rather than an
  error: "nobody is signed in" is a normal state. Server failures still
  return error statuses and the frontend shows them as failures.

Verification: PHPUnit tests replay the real session cookie between requests;
`scripts/deploy/verify-deployment.mjs` runs the whole flow against a running
site (44 checks, passing against the local production stack). What remains is
the same run against the public address: Vercel's documentation does not say
how a rewrite treats cookies. If it fails there, the cause is diagnosed first
(see DEPLOYMENT.md); option C is the fallback, option A a last resort.

## Search (Built)

One implementation, `Product::scopeSearch` ordered by
`Product::scopeOrderByRelevance`, serves both places a visitor can search:

| Where | Endpoint | Returns |
|---|---|---|
| Header search box, while typing | `GET /api/search/suggestions?q=` | The 6 best matches, in the product-list shape |
| Store, after pressing Enter | `GET /api/products?q=…` | The same search, with filters, sorting and pagination |

Because it is the same query, the suggestions are always the first results
the store would show; a test asserts exactly that.

**What matches.** The text is cleaned once (`SearchTerm`: trimmed, lowercased,
whitespace folded, control characters removed, at most 80 characters and 6
words). Every word must match the product's name, in any order:

| Word length | Matches when |
|---|---|
| 1 or 2 letters | it starts a word in the name ("fc" finds "EA Sports FC 25", not "Trafficker") |
| 3 or more | it appears anywhere in the name, **or** is a near miss of a word in it (a typo) |

"Near miss" is PostgreSQL `pg_trgm` word similarity of at least 0.5. The
threshold was chosen by measurement on this catalog: the default 0.6 misses
ordinary one-letter slips ("mincraft" scores 0.58, "sekro" 0.50); 0.4 starts
matching unrelated titles; 0.5 caught every tested slip with no false match.

**Ranking.** In this order:

1. Tier: (0) the term is the whole name or the game's title; (1) the name
   starts with the term; (2) every word appears in the name; (3) at least one
   word matched only as a near miss.
2. How closely the term resembles the name (similarity score).
3. Products that can be bought before sold-out ones.
4. Popularity (sales count).

So exact and prefix matches always come before fuzzy ones, and popularity
only decides between equally relevant products. An exact match stays first
even when sold out: someone who typed the exact title is looking for it.
"Best match" is the default order while searching; choosing another order
(price, popularity, newest) re-sorts the same matches.

**Keeping it cheap.**

- A fixed number of queries per request (5 for suggestions, 6 for the store).
- Text and word limits; suggestions for fewer than 2 characters are answered
  without touching the database.
- Suggestions are rate limited (120 a minute per visitor, 600 per edge
  address). Rate-limit counters are kept in a local file store: with the
  database store, each suggestion cost 12 extra queries just to be counted.
- The trigram index is used. The typo threshold is a database setting that
  the index-capable operator reads, so each search runs in a short
  transaction that sets it (`FuzzySearch::run`) and it cannot leak into
  another request. At 12,000 products a typo search took 1 to 15 ms in the
  database; a one-letter search matching 7,000 products took about 110 ms.
- `%`, `_` and `\` are escaped, so they match themselves instead of acting
  as wildcards, and everything reaches the database as a bound parameter.

**In the browser.** The header box waits 250 ms after the last keystroke,
asks only from 2 characters, and abandons the request for text that is no
longer in the box. It follows the standard combobox keyboard pattern (arrow
keys, Enter, Escape). Choosing a suggestion opens the product; Enter opens
`/store?q=…`, where the search is one more URL parameter alongside the
filters, so refresh, back and shared links work as for everything else.

**Known limits.** Swapped letters in short words ("zleda") and a letter
missing from a very short word ("rng" for "ring") score too low to match.
Abbreviations ("gta", "rdr2") and synonyms are not understood. Only product
names are searched, not descriptions. Matching is on letters as typed:
accents are not folded. In production the API host's firewall refuses text
that looks like an attack (`1 OR 1=1`) with its own 403 page before the
application sees it; the store says the search could not be run rather than
suggesting the server is starting up.

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

## Store and product pages (Built)

**The URL is the state.** `/store?platform=steam,xbox-live&region=europe&sort=price_asc&page=2`
uses the API's own parameter names. The page reads the address, asks the API
for exactly that, and changes the address when the visitor changes a filter.
There is no second copy of the filters in component state, which is why
refresh, the back button and a shared link all work with no extra code.
Changing a filter or the sort returns to page 1. Page links are real links.

**Nothing about the catalog is in the frontend.** Filter options, their
counts, sort orders and the default sort come from `GET /api/filters`;
products, prices, discounts, availability, sellers and variants come from
the product endpoints. The frontend formats (currency, dates) and lays out.
An address the API rejects (422) is shown as "these filters are not valid"
rather than silently ignored.

**Typed against the contract.** `web/src/lib/catalog.ts` holds the response
types. `web/src/contracts/contracts.test.ts` assigns the recorded example
responses to those types, so the type checker (which runs in the build)
fails if the API's shape and the frontend's types disagree. The page tests
use the same examples as mock data.

**Reusable components** (`web/src/components`):

| Component | Used for |
|---|---|
| `AppShell` | Header, navigation, skip link, footer around every page |
| `ProductCard` | A product in any grid (store now; homepage blocks and search later) |
| `PriceTag` | Every price: amount, struck-through original, percentage, or "Sold out" |
| `FilterPanel` | Checkbox groups and price range, driven by the URL |
| `Pagination` | Page links that keep the other parameters |
| `OfferTable` | Sellers' offers side by side, in the API's order |
| `VariantList` | The same game on other platforms and regions |
| `Notice`, `ProductGridSkeleton` | Empty, error and loading states |

**States.** Loading shows skeletons; changing page keeps the current results
dimmed instead of flashing. "No results", "invalid filters", "not found" and
"could not load" are distinct. Requests the server rejected as wrong (4xx)
are not retried; failures that may pass (the free host waking up) are, and
then offer "Try again".

**Design.** Tokens in `web/src/index.css` hold the colours and type read from
eneba.com's computed styles. No animation library; one hover transition,
disabled for visitors who prefer reduced motion.

**Accessibility.** Landmarks and a skip link; one `h1` per page with no
skipped levels; every control labelled; the result count announced when it
changes; a visible focus ring; offers in a real table with headers. Measured
text contrast is at least 5.1:1 on both pages.

## Seed data and images (Built)

**Curated, version-controlled data.** `api/database/data/games.json` lists
34 titles (26 games, 2 DLCs, 3 gift cards, 3 subscriptions) with their
descriptions, release dates, a base price, and the platform/region variants
each is sold as: 71 products in all. `reference.json` holds the platforms,
regions and eight invented sellers. Titles are real games, used only to say
what a key is for; descriptions were written for this project.

**Deterministic.** `CatalogSeeder` generates the offers, prices and keys.
Nothing is random: each number is computed from a hash of what it describes
(for example product and seller), so the same files give the same catalog on
any machine, and adding a game does not change the others. Three variants
are marked sold out in the data so that state is always present.

**Safe on every deploy.** The container runs the seeder at each start. It
adds what is missing and updates catalog text and seed prices; it never
brings back a key that was sold or reserved, and never resets a sales count.

**Image rights.** No third-party artwork is used.

- Game cover art belongs to its publishers. Images from store CDNs or from
  game-database APIs (RAWG, IGDB) are that same publisher artwork; an API key
  grants access to data, not a licence to republish the art. Those sources are
  therefore ruled out. (This is a cautious reading, not legal advice, and the
  APIs' current terms were not re-read for this decision.)
- Covers are **original images drawn by `scripts/catalog/generate-covers.mjs`**:
  a colour gradient, a few shapes and the title set in type, all computed
  from the game's slug. Nothing is traced or derived from real artwork.
- **One cover per game**, shared by all of its variants: 34 images for 71
  products, served by the frontend host from `web/public/covers`.
- `cover_image_url` is an ordinary column, so properly licensed artwork can
  replace a generated cover later without code changes.
- Eneba's logo is not copied. The header uses a plain text wordmark; colours,
  typography and spacing follow eneba.com as the assignment asks.
