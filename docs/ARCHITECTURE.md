# Architecture and decisions

This document records what the project is made of, why each choice was made,
and what was deliberately left out. Every section describes what exists in
the repository and runs on the public site today; nothing here is a plan.

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
| Solid but standard | Store filters, sorting and pagination; authentication; homepage blocks, with scroll effects that lead into a scroll-controlled showroom in front of the deals block on a desktop; order history and the account dashboard |
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
                 idempotency_key, cart_hash, failure_reason, expires_at, paid_at
order_items      id, order_id, offer_id, product_id, product_name, seller_name,
                 unit_price_cents, original_unit_price_cents, quantity
payments         id, order_id, provider, provider_reference, status, method,
                 amount_cents, currency, failure_code
simulated_charges id, reference, status, amount_cents, currency, method,
                 failure_code      (the simulated payment provider's own records)
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
| A buyer has at most one unpaid order | partial unique index `orders_one_pending_per_user` on `(user_id) WHERE status = 'pending'` |
| An order is charged at most once | unique `payments.order_id` |
| An order is paid exactly when it has a payment time | check constraint `orders_paid_at_check` |
| The payment provider decides a charge reference once | unique `simulated_charges.reference` |
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

And with the checkout, after reviewing the order tables against what the
flow needs (again as a new migration):

4. `orders` gained `expires_at` (the deadline was only on the keys, so
   "which unpaid orders are overdue" could not be asked directly) and
   `cart_hash` (so a reused idempotency key with a different cart is refused
   instead of silently answered with the old order).
5. Orders and payments gained a `cancelled` status. An unpaid order's
   payment was never attempted, so calling it "failed" would be wrong.
6. `simulated_charges` was added: the gateway needs a memory of its own to
   answer the same reference the same way twice.
7. The plan to let the next buyer's allocation take back overdue keys
   directly was dropped as unsafe: if the first buyer had in fact been
   charged and only the bookkeeping crashed, their keys would have been
   sold twice. See "The rule that makes it safe" below.

## Catalog API (Built)

Public, read-only, and the single source of everything the store shows.

| Endpoint | Returns |
|---|---|
| `GET /api/homepage` | The homepage's blocks in order (see "Homepage") |
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

## Cart, checkout and key delivery (Built)

Requirements: concurrent purchases, duplicate requests and failures mid-way
are handled correctly; simulated payment is separate from inventory
allocation; the backend is the authority on prices, stock, payment status
and who owns a key.

### The cart

The cart lives in the browser (`localStorage`), so guests can use it. An
item is a seller's **offer**, not a product: the buyer chose that seller at
that price. Adding the same offer again raises its quantity.

Nothing in the browser's cart is trusted. `POST /api/cart/quote` (open to
guests) takes offer ids and quantities and answers with names, sellers,
current prices, how many can be bought, the totals, and per line what is
wrong, if anything:

| Issue | Meaning |
|---|---|
| `unavailable` | the offer is gone, switched off or sold out |
| `insufficient_stock` | fewer keys are left than were asked for |
| `quantity_limited` | more than one order may hold (10 per offer) |
| `price_changed` | the price is not the one the buyer was last shown |

The cart page shows each issue in words and the buyer must accept the
updated cart before checking out. Placing an order runs the same quote
again inside the transaction, so an order is never placed at a price or
quantity the buyer did not see.

### States

An order says who owns the keys; its payment says where the money is.

```
order     pending ──> paid         payment succeeded, keys sold to the buyer
             ├──────> failed       payment declined, keys back on sale
             ├──────> expired      not paid before the deadline, keys back on sale
             └──────> cancelled    given up by the buyer, keys back on sale

payment   pending ──> succeeded | failed | cancelled (never charged, never will be)

key       available ──reserve──> reserved ──confirm──> sold
                                    └──────release──> available
```

No state is ever left once reached, except `pending` and `reserved`.
`SettleOrder` is the only code that moves an order out of `pending`.
The database enforces what it can: the status values, "paid exactly when
`paid_at` is set", one payment per order, one order per buyer and
idempotency key, and the three consistent shapes of a key row.

### Three steps, two requests

```
POST /api/orders              1. Reserve   one transaction: re-price the cart,
                                           create the pending order and payment,
                                           hold the keys until the deadline
                                           (10 minutes)

POST /api/orders/{id}/pay     2. Charge    no transaction open: ask the gateway
                              3. Record    one transaction: lock the order row,
                                           then keys, payment and order change
                                           together
```

Step 1 and steps 2 to 3 are separate requests so that a reservation is a
real, visible thing: the buyer sees the order with a countdown, chooses how
to pay, and can leave. No database lock is ever held while waiting for the
gateway.

| Class | Knows about | Does not know about |
|---|---|---|
| `QuoteCart` | offers, prices, stock | orders, payments |
| `InventoryAllocator` | keys: reserve, confirm, release | payments |
| `PaymentGateway` (interface), `SimulatedPaymentGateway` | charging or cancelling a reference | orders, keys |
| `PlaceOrder` | step 1 | how a payment works |
| `SettleOrder` | steps 2 and 3, expiry, recovery | how keys are chosen |

### The rule that makes it safe

**The gateway decides a reference once.** The reference is the order's
public id. The first `charge` or `cancel` for it fixes the outcome; every
later call, of either kind, returns that same outcome and does nothing.
(In the simulated gateway this is a unique index and
`INSERT ... ON CONFLICT DO NOTHING`; real providers offer the same through
idempotency keys and cancellable payments.)

**An order leaves `pending` only on the gateway's recorded decision.** Keys
are released only after the gateway has confirmed that no money can move
(declined or cancelled), and sold only after it confirmed that money did.
So expiry does not simply take an overdue order's keys back: it first
cancels the reference at the gateway. If the buyer was charged a moment
earlier, the cancel loses, the gateway says "charged", and the order is
completed as paid instead.

The simulated gateway has no card form. The buyer picks one of three test
cards with fixed outcomes (approved, declined, insufficient funds), so no
card data is ever asked for or stored.

### What happens when things go wrong

| Situation | Outcome |
|---|---|
| Two buyers want the last key at the same moment | Keys are selected with `FOR UPDATE SKIP LOCKED`: one transaction locks the key, the other skips it, finds too few and is told so (HTTP 409 with a fresh quote) without waiting. |
| Double click, retry, or the same request twice at once | The browser sends one `Idempotency-Key` per cart. The unique index lets one order exist; every copy of the request gets that order. The same key with a different cart is refused (422). |
| "Pay" pressed several times | The page shares the one request in flight; if several arrive anyway, each asks the gateway about the same reference (one charge), then waits for the order row lock and finds the order already settled. |
| Price or stock changed since the cart was shown | Step 1 re-prices from the database. Nothing is reserved and the answer carries the new quote (409). |
| Payment declined | Keys released, order failed, payment failed (402). Stock is back immediately. Trying again is a new order. |
| Buyer never pays | The order expires at its deadline: reference cancelled at the gateway, keys released, order expired. |
| Buyer goes back and changes the cart | Starting another checkout cancels the buyer's earlier pending order first, so they are never blocked by their own reservation; a quote counts keys held by the buyer's own pending order as available to them. |
| One buyer's checkouts overlap | The database allows one pending order per buyer (a partial unique index, `orders_one_pending_per_user`), so two can never both exist. The same cart checked out again, under any key, **is** the checkout in progress and is answered with that order. A different cart that arrives while the first request is still saving loses at the index, having held nothing, and is answered 409 `checkout_in_progress`; it never cancels the order that got there first, whose buyer has already been told it exists. Only a request that could see the earlier order when it started (the buyer went back and changed the cart) gives that order up. |
| Two payments touch the same products or sellers | Paying raises a sales counter on each product and seller, which locks those rows. Every payment takes them in the same order (products by id, then sellers by id), so one payment can only wait for another, never deadlock with it. Recording a decision is also retried up to three times if the database reports a deadlock anyway; it re-reads the order under its lock, so repeating it is safe. |
| Crash after step 1 | A pending order with held keys. The buyer can still pay until the deadline; otherwise it expires as above. |
| Crash after the charge, before recording it | The gateway knows. The next touch records it: the buyer retrying, the buyer opening the order, or the expiry clean-up (whose cancel loses to the charge). The buyer gets the keys even if they never come back. |
| Crash while recording | The transaction rolls back completely. Same as the previous row. |
| Pay and cancel (or expiry) at the same moment | The gateway reference is decided once, so exactly one wins, and every request reports that same result. |

There is no refund state because the case that would need one (charged, but
the keys were given to someone else) cannot arise: an order's keys are
never released while a charge for it could still succeed.

### Recovery after a successful payment

The one dangerous gap is "the gateway charged, and we did not record it"
(the process died, or the response was lost). The order is still `pending`,
its keys still held, and the gateway holds the truth. Three things close
the gap, whichever comes first, and all three go through the same
`SettleOrder::apply()` under the order's row lock, so they cannot double up:

| Who | When | How |
|---|---|---|
| The buyer retries "Pay" | at once | The charge is asked again with the same reference; the gateway answers "already charged"; the result is recorded. |
| The buyer comes back | any later visit | Opening the order, or the order history, asks the gateway what it decided (`reconcile`) and records it. |
| Nobody comes back | at the order's deadline | The clean-up tries to cancel the reference, the gateway answers "already charged", and the order is completed instead of expired. |

Reconciling is safe to repeat and safe to run from several tabs at once:
a tested case opens the same charged order from six processes together and
it is completed once. If the gateway cannot be asked at that moment, the
buyer still sees the order as it stands; the failure is logged, nothing is
decided, and the keys stay held until the gateway has answered.

### What a real deployment would move to a background worker

Everything above is correct without one. Three things are only *timely*
with one, and two would be needed by a real payment provider:

| Today | With a worker and a real provider |
|---|---|
| Overdue orders are settled by the next request that reads stock or orders. With no visitors, held keys stay held past the deadline (never sold twice, just not for sale). | `orders:expire` every minute from a scheduler. |
| A charged order whose buyer never returns is completed at its deadline, by the same clean-up, so up to 10 minutes late. | A reconciliation job a few seconds after any payment whose result was not recorded. |
| The clean-up calls the gateway from inside another visitor's page request. Harmless with the simulated gateway, which is a local table. | Gateway calls belong in a queue with retries and back-off; a provider outage must not slow down or break browsing. |
| The gateway answers at once, in the request. | Real providers also report results later (3-D Secure, bank delays) through webhooks: an endpoint that verifies the provider's signature and feeds the same `apply()`. |
| A persistently failing order is logged on every clean-up. | Alerting on orders pending past their deadline, and a way for staff to settle one by hand. |
| Keys are shown on the order page only. | Delivery by email, sent from a queue after the order is paid. |

### Expiry without a background worker

The free hosting tier runs no scheduler. Requests that show or take stock
(product list and page, cart quote, orders) first settle overdue orders
(`ReleaseExpiredReservations`): one small indexed query when there is
nothing to do, which is nearly always. Opening an order settles that order.
`php artisan orders:expire` does the same for a host that has cron.

### Who can see what

Every order route needs a signed-in user and looks the order up through
that user's own orders, by a random public id: someone else's order answers
"not found", exactly like one that does not exist. License keys appear in
one place only, the single-order response, and only once the order is paid.
The order history, the account totals, quotes and pending orders never
contain a key.

The browser holds on to none of it past the session. Orders and keys are
kept in memory only, under the buyer's id, and are discarded the moment the
person at the keyboard may have changed: on signing in, up or out, and
whenever any request is answered 401. The order pages ask for and draw
their data only once the server has confirmed who is signed in; while that
is being checked, or if the check fails, they show that instead. Pressing
Back after signing out therefore finds a sign-in prompt, not the previous
buyer's orders. The cart is not personal and is kept.

### Tests

PostgreSQL integration tests (`tests/Feature/Checkout`) cover: quotes and
each issue; placing orders, snapshots, idempotency and its payload check;
approved, declined, late and cancelled payments; who may read what; and
every crash point above, including a failure injected half way through
step 3, a gateway that cannot be reached, and a sold key never being sold
again. `CheckoutConcurrencyTest` runs real parallel processes, each with
its own database connection: eight buyers for three keys, the same request
six times at once, "Pay" six times at once, a charged order reconciled
from six tabs at once, pay against cancel, one buyer starting six different
checkouts at once (one pending order survives), and two orders that share
products and sellers in opposite line order, paid together with the overlap
forced (it deadlocked before the fixed lock order). A migration test shows
that adding the one-pending-order rule first settles a buyer's extra unpaid
orders the way a new checkout would.

Two of these do not rely on timing at all. They fix the interleaving: the
first request inserts its order and pauses with its transaction open; the
second starts only then, cannot see that order, and its insert is made to
wait by the index; the first commits only once the database reports that
wait (`pg_locks`). The winner's order must come through untouched (still
pending, its keys held, nothing cancelled at the gateway) while the loser
is refused, or, for the same cart, given the winner's order. The first
version of the rule failed both: the loser cancelled the winner and took
its place.

The frontend tests cover the cart store, revalidation notices, the order
page in each state, duplicate presses, the countdown, and what a signed-out
browser shows: Back after signing out, a session check that is pending or
has failed, a 401 arriving mid-session, and a second account using the same
browser. `make prod-check` buys a key through the production build, and
`make verify ... PURCHASE=1` does the same against a deployment. Neither
prints a key: keys are compared by fingerprint.

## Authentication (Built)

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

- The API issues no tokens. A request that carries an `Authorization: Bearer`
  header is treated as carrying none: it is a visitor, or the signed-in
  session it also has. (Sanctum would otherwise look the token up in a table
  this project does not create, and answer 500.)

Verification: PHPUnit tests replay the real session cookie between requests,
and `scripts/deploy/verify-deployment.mjs` runs the whole flow against a
running site, locally against the production build and against the public
address. The open question when this was designed, whether Vercel's rewrite
passes cookies through unchanged, was settled by that run: it does, and the
session works in Safari and in private windows because the cookie is
first-party.

### Input no browser would send

Every request is validated, and what fails validation is the caller's
mistake (422), not a server error. A release review found four ways to get
a 500 from outside, now closed and covered by `MalformedInputTest`: a price
filter larger than the price column can hold, a query string that is not
valid UTF-8, a list where the sign-in rate limiter expected an email, and
the bearer token above. The API host's firewall refuses some of these
before the application sees them (403), which is also a controlled answer.

## Account (Built)

`/account` is the sign-in form for a visitor and a dashboard for a buyer,
built only on what the API offers. Signed out, every account address shows
the sign-in form in place (with a heading for what was asked for), and
signing in shows that page; `/account/register` is the sign-up form.
Signed in, a sidebar (a row of four tabs on a phone) leads to:

| Page | Shows | From |
|---|---|---|
| Overview | totals, the latest orders, the latest keys | `GET /api/account/summary`, `GET /api/orders`, `GET /api/orders?status=paid` |
| My orders (`/account/orders`) | every order with its date, reference, total, order and payment status; a filter by status | `GET /api/orders?status=...` |
| My game keys (`/account/keys`) | one card per product of a paid order, its keys hidden | `GET /api/orders?status=paid`, then `GET /api/orders/{id}` on "Reveal" |
| Profile (`/account/profile`) | name and email; sign out | `GET /api/auth/me` |

Two read-only additions to the API made the dashboard possible without
counting in the browser (which would be wrong past the first page of
orders):

- `GET /api/account/summary`: the buyer's number of orders, of paid
  orders, of orders awaiting payment, of keys delivered, and the total
  spent. Counts and a sum, from the buyer's own orders only; never a key.
  Like the order history, it first settles the buyer's pending orders.
- `?status=` on `GET /api/orders`: one of the order states, validated
  (anything else is 422).

Keys are still in one response only, the single paid order. The key cards
are drawn from the order history (no keys) with every key masked;
"Reveal" asks for that order and shows the keys of that one product. The
answer stays in memory under the buyer's id like every other order, and
nothing is written to browser storage. A pending order is said to be
awaiting payment, with no keys; declined, expired and cancelled orders
say no keys were delivered and nothing was charged.

The forms check the same rules as the server before sending (required
fields, an email's shape, eight characters for a new password) and show
the server's own message when it disagrees. A failed sign-in is said
above the form, since it is about the email and password together. There
is no social sign-in, password reset or profile editing, because the API
has none; the profile page says that changing details is not available.

When a signed-in session ends without "Sign out" being pressed (it
expired, or ended in another tab, and a request was answered 401), the
sign-in form says that the session has ended; after "Sign out" it says
the buyer has signed out. `/orders`, the history's old address, forwards
to `/account/orders` with its page.

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

## Homepage (Built)

The assignment asks for a homepage of blocks whose content comes from
separate backend services. Here that is separate classes inside the one
Laravel application, each with its own source of data; nothing is deployed
separately.

**The layout is data.** `homepage_blocks` holds one row per block: its
type, position, title, whether it is switched on, and its settings.
`GET /api/homepage` returns the active blocks in position order:

```
{ "data": { "blocks": [
    { "id", "type": "hero_banner",  "title", "link", "data": { "banners":  [...] } },
    { "id", "type": "best_sellers", "title", "link", "data": { "products": [...] } },
    { "id", "type": "deals",        ... },
    { "id", "type": "featured",     ... }
] } }
```

**The content comes from resolvers** (`app/Services/Homepage`).
`BuildHomepage` walks the rows and asks the resolver for each row's type:

| Block type | Resolver | Reads from | Settings |
|---|---|---|---|
| `hero_banner` | `HeroBannerResolver` | the `banners` table | `limit` |
| `best_sellers` | `BestSellersResolver` | products by sales count (raised by every paid order) | `limit` |
| `deals` | `DealsResolver` | products whose best in-stock price is a discount, biggest first | `limit`, `min_discount_percent` |
| `featured` | `FeaturedProductsResolver` | the product slugs listed in the row itself, in that order | `products`, `limit` |

Product blocks return the same product shape, at the same price, as the
store list, show only what can be bought now, and show each game once.
A row's optional `link` setting becomes the block's "see more" link.

So reordering, hiding, retitling or resizing a block, or adding a second
block of an existing type, is a change to a row. A new kind of block is one
resolver class, one line in `BuildHomepage`, and one component.

**The frontend draws what arrives.** `HomePage` maps a block's type to a
component (`HomeBlocks.tsx`) and renders the blocks in the order received.
It contains no product, banner text or section title of its own.

**When something is missing or wrong**

| Situation | Result |
|---|---|
| A block has nothing to show (no banners, no deals) | left out of the response, never sent empty |
| A row has a type no resolver knows | skipped |
| A resolver throws | that block is left out and the error logged; the rest of the page is served |
| A setting makes no sense (`limit: "many"`) | the default is used; limits are kept between 1 and 12 |
| A banner or link points outside the site | dropped (`InternalPath`), so a row cannot turn a button into an outside link |
| A featured slug no longer exists, or is sold out | passed over |
| No active blocks, or the API cannot be reached | the frontend shows a short introduction with a link to the store (and "Try again") |
| The frontend receives a type it does not know | skipped; the rest is drawn |

**Seeding.** `HomepageSeeder` creates the starting layout from
`database/data/homepage.json`, and only when the layout is empty. Later
deployments run it again and change nothing, so edits made in the database
survive. Banner artwork is this project's own generated covers.

**Pictures the frontend chooses.** The API names one cover per game
(`/covers/<game>.svg`, a drawn placeholder). The frontend has better
pictures and shows those instead, keyed by the game in that address
(`web/src/lib/coverArt.ts`): a painted cover wherever a cover is shown
(store and deals cards, the product page, search suggestions, cart and
order lines), and for some games a scene at the top of the best-seller
card, wide artwork behind the featured banner or an illustration in a
promotional tile. Where there is no scene, artwork or illustration the
cover is used, so the blocks stay the backend's: which products and
banners appear, their order, names, prices and links are never chosen
here. `scripts/design/home_art.py` cuts the homepage's pictures out of the
crops they were supplied as.

### The deals block on a desktop: a showroom you scroll into

On a desktop the deals block is introduced by a scroll-controlled shot: the
visitor scrolls down a neon game store into a round showroom where each of
the block's six products hangs on a lit panel. The shot then stays, and the
panels are the cards: pointing at one, pressing it or reaching it with the
keyboard brings up the product's name, discount and price, with **Add to
cart** and **Buy Now**. The code is `web/src/cinematic`; how the frames are
made is in `cinematic/README.md`.

**What it is made of.** 209 WebP frames (16.3 MB) cut from a ten-second
generated video, drawn on a canvas as the page scrolls past a pinned stage.
The video is decoration; nothing is read from it.

**Gliding between frames.** A frame is about nine pixels of scrolling, so
scrolled slowly a sequence of frames is seen for what it is: a still
picture, then a jump. Two things remove that. Every frame of the video is
kept while its camera moves (the first set kept every second one), which
halves each jump. And between two frames the later one is drawn over the
earlier, as solid as the scroll is far along, so the picture passes from
one into the next. Two frames laid over each other look like motion blur
while moving but soft when still, so once scrolling stops the picture is
eased onto the nearest whole frame; the same scroll position therefore
still rests on the same sharp picture whichever way it was reached.

**It stays the backend's block.** The frames know only which game each
panel shows. A panel's product is the one in the API's block for that game,
so names, prices, discounts and stock are the API's, and the backend may
reorder the block freely. If the block ever holds a product that no panel
shows (the ranking changed), the showroom is not used and the ordinary
cards appear.

**Buying.** A card or a panel knows a product's best price but not which
seller's offer it is. Both buttons ask for the product first (the product
page's own request), take its first offer that can be bought, and put that
offer in the cart, exactly as the product page would. Buy Now then opens
the cart, where the server prices it as for any cart. If nothing can be
bought, the product page opens instead.

**Where it does not run.** Phones and tablet-sized windows, reduced motion,
data saving, a 2g connection, little memory, a browser without what is
needed, or frames that cannot be fetched: all get the ordinary block, with
the same products. That is decided at once from the window and the device,
before anything is downloaded, so the page never changes shape later.

**What it costs.** The code for it is fetched only by browsers that will
run it. They fetch 14 frames (1.1 MB) to be ready and the other 195 only
when the section is within two windows' height, the evenly spread ones
first, so the steps get finer everywhere at once. At most 48 MB of decoded
pictures are held, and none while the section is off screen. The frames
are in a folder named for their version, so a later set never collides
with one a browser still holds.

**Checked with** unit tests for the scroll arithmetic, the frame loader,
the rule for when the showroom may be used and the panels' buttons, and
`cinematic/showroom_preview.mjs`, which drives a real browser: every
panel's details at three window widths, the keyboard, both buttons, the
same picture scrolling down and up, and the fallbacks.

### The way down the page: scroll effects

Four small effects tie the homepage's blocks into one journey from the
featured banner to the store. All of them follow the scroll position and
nothing else, so scrolling back up undoes exactly what scrolling down did;
none of them touches scrolling itself, pins anything or moves anything
else on the page.

- **The featured banner has depth.** As the page scrolls, its artwork
  slides down a little inside the banner and grows by up to 12% from the
  foot of the tree, so it travels more slowly than the text, which rises
  and fades. The slide is kept smaller than the room the zoom makes above
  the picture, so the picture is never stretched and never uncovers the
  banner behind it.
- **Best sellers arrive and recede.** Each card starts 32px low, leaning
  9 degrees back and transparent, and stands up into its place as its row
  climbs the window, each a little after the one on its left, its text
  after its picture. Near the top of the window it shrinks slightly and
  dims. The cards are the same links throughout; only `transform` and
  `opacity` are set, and they are removed again when a card is in place.
- **The page dims as the store arrives.** A dark sheet behind the page's
  content goes from clear to the store's own darkness while the store's
  stage comes up the last three quarters of the window, and clears again
  when the stage leaves. With the stage's soft edges, there is then no
  brighter page left around the store to cross a line from.

**How it is built.** No library. `web/src/motion/follow.ts` is one passive
scroll listener and one `requestAnimationFrame` for all effects: in a
frame, every effect first reads positions, then every effect writes
styles. `poses.ts` is the arithmetic (what is drawn at which position),
free of the browser and unit-tested; `home.ts` applies it to the banner
and the row. The dimming and the wave are done by the stage's own loop,
which already runs while the stage is near. With reduced motion none of it runs, and
phones get the first two effects without the stage.

**Checked with** unit tests for the arithmetic and
`cinematic/journey.mjs`, which scrolls the whole page in a real browser at
five window sizes: the same pictures on the way down and back up, no
layout shift and no sideways overflow, every card clickable while it
moves, time between display frames (also with the processor slowed four
times), reduced motion, and a recording of each scroll.

**Cost.** 15 queries however large the catalog: the layout, the banners,
and four per product block (the products, then their games, platforms and
regions), plus the check for overdue reservations. There is no cache: at
this size it would add a way to be stale without a visible gain.

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
- **The store opens below the best sellers along a wave.** The stage comes
  up the window behind a curved edge across the whole width, highest at
  the sides and lowest in the middle, with a thin violet line along it, a
  soft blurred glow and a touch of gold where it turns. The curve is a
  mask on the store's canvas (only below it is the store drawn) and the
  line an SVG over it; both are the same curve, stretched to the window's
  width, 7.5% of it deep (32 to 140px). As the stage rises the curve
  flattens and the line goes out, and both are gone exactly as the stage
  fills the window, which is where the camera starts: the camera, frames
  and pinning are untouched, and the curve replaced the straight fade the
  stage's top edge used to have. The best sellers sit above it, so the
  glow passes behind the cards. Where the store does not run (phones,
  tablets, reduced motion) the deals band's top edge is the same curve,
  standing still.
| `AppShell` | Header, category links, skip link and footer around every page; the slow-server notice |
| `ProductCard` | A product in any grid: the store, search results, homepage blocks |
| `PriceTag` | Every price: amount, struck-through original, percentage, or "Sold out" |
| `FilterPanel` | Checkbox groups and price range, driven by the URL |
| `Pagination` | Page links that keep the other parameters |
| `Notice`, `LoadError`, `ProductGridSkeleton` | Empty, error and loading states |
| `SessionNotice` | What a buyer-only page shows while nobody is confirmed as signed in |
| `HomeBlocks` | One component per homepage block type |
| `OrderLines` | Cover, title and price breakdown shared by the cart and the order page |

**The product page** (`web/src/pages/ProductPage.tsx`, its parts in
`web/src/product`) is a "spotlight": the game's artwork behind its title, a
buy panel beside it, every seller's offer, and the game's other versions.

- *Artwork.* The catalog's covers are 600 x 800, too small to fill a wide
  screen sharply, so none is shown enlarged as it is. The wide picture
  behind the title is deliberately blurred into a wash of the game's
  colours; the cover is shown sharp, at most 300 pixels wide (a
  high-density screen draws that from the full 600). A missing or broken
  cover becomes a panel with the game's first letter.
- *Choosing a seller.* The offers are one group of radio buttons
  (`SellerPicker`): choosing one makes it the buy panel's offer, whose one
  yellow button puts it in the cart. The cheapest is chosen to begin with;
  every seller at the lowest price is marked. Sold-out offers keep their
  price but cannot be chosen. Stock is only "in stock" or "sold out",
  because that is all the API says.
- *Versions.* The panel's platform and region controls (`VersionPicker`)
  list only versions the API returned, each a link to its own page.
  Switching between versions of the same game keeps the page on screen
  while the other loads, with everything that could buy switched off
  until it has.
- *Phones.* The panel follows the title; once its "Add to cart" has
  scrolled away, a slim bar at the foot of the screen (`BuyBar`) keeps the
  chosen offer's price and the button there until the footer comes up.
- *Motion* is CSS only (`product/spotlight.css`): an entrance once, and
  scroll-driven animations for the artwork's drift and each block's
  reveal, which the browser ties to the scroll position (no JavaScript,
  undone exactly by scrolling back). Browsers without them, and visitors
  who prefer reduced motion, get everything in place, still.

**States.** Loading shows skeletons; changing page keeps the current results
dimmed instead of flashing. "No results", "invalid filters", "not found" and
"could not load" are distinct. Requests the server rejected as wrong (4xx)
are not retried; failures that may pass (the free host waking up) are, and
then offer "Try again".

**Design.** Tokens in `web/src/index.css` hold the colours and type read from
eneba.com's computed styles. No animation library; one hover transition,
disabled for visitors who prefer reduced motion.

**One look across pages.** The pages were built in phases, and a release
review found it showed (three sizes of page title, buttons re-declared with
different states). What every page shares is now defined once, in
`components/States.tsx`, and used everywhere: where a page starts, the page
title (30px bold, as on eneba.com), the section title, and the primary and
secondary button at two sizes, including how each looks disabled. The
header's category links and the footer's are the product types reported by
`GET /api/filters`, so they too are the backend's, not the frontend's.

**Failures are described as what they are.** A request can fail because the
free host is still waking up, or because the server answered with an error,
and the page says which (`describeFailure` in `lib/api.ts`): no answer at
all or a gateway's 502/503/504 page reads as "may be waking up"; a JSON 500
reads as a server error; 429 as too many requests. Separately, when any
request has gone four seconds without an answer, the shell shows a notice
that the server may be waking up, and removes it when the answer arrives.
A page that throws while drawing itself is replaced by a message inside the
shell (`PageCrashed`) rather than the router's stack trace.

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

**Image rights.** No publisher artwork is used.

- Game cover art belongs to its publishers. Images from store CDNs or from
  game-database APIs (RAWG, IGDB) are that same publisher artwork; an API key
  grants access to data, not a licence to republish the art. Those sources are
  therefore ruled out. (This is a cautious reading, not legal advice, and the
  APIs' current terms were not re-read for this decision.)
- The cover the API names is an **original image drawn by `scripts/catalog/generate-covers.mjs`**:
  a colour gradient, a few shapes and the title set in type, all computed
  from the game's slug. Nothing is traced or derived from real artwork.
- **One cover per game**, shared by all of its variants: 34 images for 71
  products, served by the frontend host from `web/public/covers`.
- Every game also has a **painted cover** (`web/public/covers/art`), which
  the frontend shows in place of the drawn one. 25 were made and supplied
  by the author as finished pictures. The other nine are built by
  `scripts/catalog/paint-covers.mjs`: three from pictures that are in the
  public domain on Wikimedia Commons (a painting, a NASA and a Library of
  Congress photograph), cropped to the card's shape with the title set in
  type, and six gift cards and subscriptions drawn by the script with no
  logo. Those nine are not the games' artwork and are not derived from it;
  their sources and licences are listed in `docs/COVER_CREDITS.md`, which
  the script writes. `make test-web` fails if a game in the catalog has no
  painted cover.
- `cover_image_url` is an ordinary column, so properly licensed artwork can
  replace a generated cover later without code changes.
- Eneba's logo is not copied. The header uses a plain text wordmark; colours,
  typography and spacing follow eneba.com as the assignment asks.
