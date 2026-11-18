# Eneba-style marketplace

A marketplace for digital game keys, built for the Eneba internship
assignment: a store with filters and search, a homepage assembled from
backend-defined blocks, product pages comparing offers from several sellers,
and a checkout that delivers a digital key.

**Status: deployed.** Everything in the assignment works end to end on a
seeded catalog: sign-up and sign-in, a homepage built from backend-defined
blocks, the store (filters, sorting, pagination), typo-tolerant search,
product pages comparing sellers' offers, and the purchase flow (cart,
checkout with a simulated payment, key delivery, order history).

| | |
|---|---|
| Live URL | https://eneba-marketplace-ten.vercel.app |
| Design and decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Hosting plan and verified free-tier limits | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| AI conversation history | [docs/ai-log/](docs/ai-log/README.md) |

## Trying it

Open https://eneba-marketplace-ten.vercel.app. The API runs on a free plan
that sleeps after 15 idle minutes, so the first page may take up to a
minute to fill in (about 25 seconds when measured); the site says so while
it waits. After that it is fast.

1. **Browse.** The homepage is built from blocks the API returns. "Store"
   and the category links under the header list every product; filter by
   type, platform, region or price, and change the order.
2. **Search.** Type in the header from any page. Misspellings work: try
   `mincraft` or `eldn ring`. Enter opens the full results.
3. **Compare offers.** Open a product. Each row under "Offers from sellers"
   is a different seller's price for the same key; "Add to cart" on a row
   picks that seller.
4. **Register.** Open the cart and choose "Sign in to check out", then
   "New here? Create an account". Any name, any email address in a valid
   format (nothing is sent to it) and a password of 8 characters or more.
   You return to the cart signed in.
5. **Pay.** "Proceed to checkout" holds your keys for 10 minutes and shows
   three test cards. No card details are asked for and no money moves.

   | Test card | What happens |
   |---|---|
   | ending 4242 | Payment approved; the order page shows your key |
   | ending 0002 | Declined by the bank; nothing is charged, the keys go back on sale |
   | ending 9995 | Declined for insufficient funds; same outcome |

   Letting the timer run out, or "Cancel and return to cart", also releases
   the keys.
6. **See your keys again.** "Orders" in the header (or Account, "Your
   orders and keys") lists every order; a paid one opens to its keys. Sign
   out and press Back: the orders are gone from the screen.

The keys are made-up codes that unlock nothing.

Screenshots of the store and product pages are in
[docs/screenshots](docs/screenshots).

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
| `make prod-check` | Builds the production image and frontend, runs them locally with production settings, and runs every deployment check against them, including buying a key |
| `make audit` | Fails if a secret or private file is tracked by Git |
| `make verify URL=… API_URL=…` | Runs the end-to-end checks against a deployed address (add `PURCHASE=1` to also buy one key) |
| `make contracts` | Regenerates the example API responses in `web/src/contracts` from the backend tests |
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

**Homepage**

- The layout is rows in the database, and there is no admin screen for
  them: changing the homepage means editing `homepage_blocks` or `banners`
  directly. The seeder fills an empty layout once and never touches it again.
- Four kinds of block exist (banners, best sellers, deals, featured). The
  banners are a static arrangement, not a rotating carousel.
- "Deals" has no matching store filter yet, so that block has no "see all".
- Nothing is cached; the homepage costs 15 small queries per visit.

**Cart and checkout**

- Payment is simulated. There is no card form: the buyer picks one of three
  test cards with a fixed outcome (approved, declined, insufficient funds).
  No money moves and no real keys are sold; the keys are made-up codes.
- The cart is kept in the browser, not on the server: it does not follow a
  buyer to another device, and signing out does not empty it.
- Keys are held for 10 minutes once checkout starts. There is no background
  worker on the free tier, so overdue orders are settled by the next request
  that looks at stock or orders (`php artisan orders:expire` exists for a
  host with cron). Search suggestions and the filter counts skip that step,
  so they can show an expired hold as "sold out" until the next page load.
- A buyer has one checkout in progress at a time, enforced by the database.
  Checking out the same cart again returns that checkout; checking out a
  changed cart cancels the earlier unpaid order. Two different carts sent
  at the same instant: the first is kept, the second is asked to try again. One order holds at
  most 10 of an offer and 20 different offers. Several accounts could still
  hold stock between them for 10 minutes at a time; nothing limits how many
  accounts one person creates.
- One payment attempt per order. After a decline the buyer checks out again,
  which creates a new order.
- There are no refunds, invoices, taxes, emails or seller payouts, and a
  paid order cannot be cancelled.
- With a real payment provider the expiry clean-up would call the provider
  from inside ordinary page requests; it should move to a scheduled job
  (see "What a real deployment would move to a background worker" in
  `docs/ARCHITECTURE.md`).
- The seeded keys are made-up codes generated by the public seeder, so they
  are not secret in the way real keys would be. The API still treats them
  as if they were: a key appears only in its buyer's paid order.

**Search**

- Small typos are understood ("mincraft", "eldn ring", "witchr"). Swapped
  letters in short words ("zleda") and a letter missing from a very short
  word ("rng") are not.
- Abbreviations and nicknames ("gta", "rdr2", "fifa") find nothing: only the
  words in a product's name are searched, not descriptions.
- Accents are not folded: "pokemon" would not find "Pokémon".
- A one- or two-letter search only matches the start of a word, and the
  header suggests nothing below two characters.
- The API host's firewall refuses text that looks like an attack (for
  example `1 OR 1=1`) before it reaches the application, so such a search
  shows "This search could not be run" instead of "no results". It also reads
  the page address sent with every request, so the filter panel does not
  load on that page either. Ordinary punctuation, quotes included, is
  searched for as text.

**Look and feel**

- The look follows Eneba's design language (colours, heavy type, card and
  offer layout, read from eneba.com's own pages) without copying its
  assets. The shapes are the site's own: rounded cards with a thin lit
  edge and a soft glow, where Eneba's are square. The wordmark is a placeholder, and Eneba's typeface is
  not bundled: the system sans-serif is used unless the visitor has it.
- The header has a search box, category links and the cart, but no category
  mega-menu, language or currency switcher, wishlist or cashback, which
  eneba.com has. Product pages have no screenshots, reviews or activation
  guide.
- The store's address uses the API's own parameters, so a price filter
  appears in cents (`min_price=1000` is 10.00).
- Accessibility was checked by hand (keyboard order, focus ring, headings,
  labels, measured contrast), not with an automated audit tool or a screen
  reader.
- Opening a typed address in a tab that was scrolled down can start the new
  page at the old scroll position. Following links inside the site does not.

**Authentication**

- Sign-up, sign-in and sign-out only. No email verification, password reset
  or social login.
- Sign-up says when an email address is already registered, which reveals
  that it is. Sign-in does not reveal which part was wrong.
- A buyer's orders and keys are held in the browser's memory only while
  they are signed in. They are discarded on sign-out, on any "not signed
  in" answer, and whenever the session check fails, so a brief server
  hiccup can replace an order on screen with "we could not check that you
  are signed in" until it is retried.

**Deployment (free tiers)**

- The API sleeps after 15 minutes without traffic. The first request then
  waits for it to start: 25 seconds when measured on 2026-11-17, up to
  about a minute by the host's documentation. Pages show their loading
  state meanwhile and, after four seconds, a notice that the server may be
  waking up.
- Migrations and catalog loading run when the container starts. The free
  plan has no shell or rollback step, so a faulty migration is corrected by
  a new one. The migration that introduced `games` refuses to run if
  products already exist, and changes nothing in that case.
- Each run of `make verify` leaves throwaway `deploy-check-…` accounts in
  the production database (one, or two with `PURCHASE=1`), with any test
  orders they placed. One real key of the seeded stock was consumed by the
  one live test purchase.
- Catalog pages have no rate limit of their own (search suggestions, the
  cart, checkout and sign-in do).
- An API path ending in a slash is answered by the frontend host with its
  own 404 and never reaches the API.
- Rate limiting by caller relies on a header set by the API host's edge
  network; this was confirmed on the live service.

## Scope

A few features are built in depth rather than everything thinly: the
product and seller-offer model, search, and checkout with key delivery.
What was cut and why is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#scope).

Before submission the whole application was reviewed against the
assignment, in a browser at three widths, and by two independent code
reviews. What that found and what was fixed (a privacy leak after sign-out,
two ways to get a server error from outside, a rule only the application
enforced, a possible deadlock between payments, and uneven styling between
pages) is in the conversation log and in the commit history.
