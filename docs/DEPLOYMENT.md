# Deployment

**Status: live. Database (Neon), API (Render) and frontend (Vercel) are
deployed, and authentication is verified end to end through the public
address.**

| | |
|---|---|
| Site | https://eneba-marketplace-ten.vercel.app |
| API (reached by visitors only through the site's `/api`) | https://eneba-marketplace-api-pylw.onrender.com |

| Part | Host | Why |
|---|---|---|
| React app | Vercel (Hobby) | Static hosting that does not sleep; documented reverse-proxy rewrites with a stated timeout |
| Laravel API | Render (web service, Docker, Frankfurt; created on the free plan, on a paid instance of 0.5 CPU and 512 MB since 2026-11-19) | The only host checked that runs a Docker container free with no documented card requirement. The plan is chosen in Render's dashboard: the free one sleeps after 15 idle minutes, a paid instance does not |
| PostgreSQL | Neon (Free, AWS Frankfurt) | No expiry; `pg_trgm` available |

```
Browser ── https://<project>.vercel.app ──┬─ static files (the React app)
                                          └─ /api/*  ── rewrite ──> https://eneba-marketplace-api-pylw.onrender.com ──> Neon
```

The browser only ever talks to the Vercel address. That is what makes the
login cookie a first-party cookie (see Authentication in ARCHITECTURE.md).

## Configuration files

| File | What it controls |
|---|---|
| `render.yaml` | The API service: Docker build, region, health check, every environment variable. The plan is left out on purpose, so a push keeps whichever plan the dashboard has set. Secrets are marked `sync: false` and typed into Render's dashboard. |
| `api/Dockerfile` (stage `prod`) | The production image: Apache, PHP 8.4, no dev packages |
| `api/docker/entrypoint.sh` | Start-up: listen on Render's port, refuse unsafe settings, cache config, run migrations |
| `web/vercel.json` | Forwards `/api/*` to the confirmed Render address (a placeholder until one is confirmed); serves the app for every other path; switches off proxy caching for `/api`; says how long a browser may keep built scripts, showroom frames and covers. Checked by `scripts/deploy/check-vercel-config.mjs`. |

## Readiness checks

Run on 2026-11-16. Commands: `make test`, `make prod-check`, `make audit`.

### Production-safety of the configuration

| Area | Setting | How it was checked |
|---|---|---|
| CORS | Only the frontend's address is allowed; credentials are never allowed cross-origin. (Same-origin requests through the proxy do not use CORS at all.) | `ProductionConfigTest` |
| Sanctum session | Only requests whose Origin/Referer is the frontend may use the session. Derived from one variable, `FRONTEND_URL`. | `ProductionConfigTest`, `AuthenticationTest`, production check |
| Session cookie | HttpOnly, Secure, SameSite=Lax, path `/`, no Domain attribute (bound to one host), stored server-side in the database | production check reads the real `Set-Cookie` headers |
| CSRF | A request that changes data needs either the browser's same-origin marker or the token header. Forged cross-site requests get HTTP 419. | production check |
| Trusted proxies | Only `X-Forwarded-Proto` is believed (so Laravel knows the visitor used HTTPS). The forwarded host and client address are not: a direct caller can forge them. | `ProductionConfigTest`; production check sends forged headers |
| `APP_URL`, `FRONTEND_URL` | Both are the Vercel address (see below). The container refuses to start if either is missing, not https, or has a path. | `entrypoint.sh`; production check |
| Redirects | The API never redirects: no login-page redirect for signed-out callers, no trailing-slash redirect | `AuthenticationTest`, `ProductionConfigTest`, production check |
| Database TLS | `DB_SSLMODE=verify-full` with the system certificate bundle: encrypted, and the server's certificate must be valid for its host name | tested from the production image against a TLS-enabled Postgres (below) |
| Debug mode | The container refuses to start in production with `APP_DEBUG=true` or without `APP_KEY` | `entrypoint.sh`; production check asserts debug is off |
| Caching | API responses carry `Cache-Control: no-cache, private`; the rewrite also opts out of proxy caching | `ProductionConfigTest`, production check |
| Health check | `/api/health` starts no session and runs no database query | `ProductionConfigTest` |

Database TLS, measured from the production image:

| Server | Setting | Result |
|---|---|---|
| TLS enabled | `sslmode=require` | connected, TLS 1.3 |
| TLS enabled, untrusted certificate | `verify-full` + system bundle | refused: certificate verify failed |
| No TLS | `require` or `verify-full` | refused: server does not support SSL |

So an unencrypted or impersonated database connection cannot happen silently.
The successful `verify-full` connection to Neon's publicly trusted certificate
could not be tested locally. It is now proven on the live service: it runs
with `DB_SSLMODE=verify-full`, its migrations ran at start-up, and it serves
database-backed sessions.

### PostgreSQL 18

The Neon project runs PostgreSQL 18. Verified on 18.7:

- All migrations apply; the whole backend suite (60 tests) passes, including
  the trigram search test and the two-connection key-locking test.
- The migrations were run on 17 and on 18 and every column, constraint, index
  and extension compared: 122 columns, 43 indexes and `pg_trgm` 1.6 are
  identical. The only difference is cosmetic: PostgreSQL 18 records each
  NOT NULL rule as a named constraint in its catalog (77 of them); the rules
  themselves are the same.
- The production image (PostgreSQL client library 17) passes all 44
  end-to-end checks against a PostgreSQL 18 server.

No migration, index or constraint needed changing. The local database
container was moved from 17 to 18 so development and tests match production.

### Production build, run locally

`make prod-check` builds the frontend as Vercel will (`npm ci && npm run build`),
builds the production API image, runs it on a separate database, puts a
stand-in for Vercel's proxy in front, and runs
`scripts/deploy/verify-deployment.mjs` against it.

The container's environment is read from `render.yaml` itself
(`scripts/deploy/render-env.mjs`), with local stand-ins only for the five
values typed into Render's dashboard and for the database's name, user and
TLS mode. So if `render.yaml` ever lacks a variable the code needs, this check
fails locally, before a deployment does.

`render.yaml` provides 23 variables: 18 with fixed values and 5 typed into the
dashboard (`APP_KEY`, `FRONTEND_URL`, `APP_URL`, `DB_HOST`, `DB_PASSWORD`).
Render sets `PORT` itself. Every variable in the file is read by the code, and
every variable the start script insists on is in the file.

Start-up behaviour, observed with the production image:

| Situation | What happens |
|---|---|
| Normal start | Log shows "Configuration cached", "Routes cached", "Running migrations", then Apache starting |
| Wrong database password or host at start | The container exits with the database's error message in the log, so the deploy fails visibly. The password is not printed. |
| Database unreachable while running | Affected requests get a JSON 500 with only "Server Error"; the cause is in the log; `/api/health` keeps answering |

Result: **44 of 44 checks passed** (frontend served, deep links, API through
the same origin, cookie attributes, CSRF rejection, sign-up, sign-in, sign-out,
server-side session destruction, and direct calls to the API host with forged
headers). The same flow was also done by hand in a
real browser against that stack: sign up, reload (still signed in), sign out;
the session cookie was not visible to page scripts.

### Secrets and private data

`make audit` passes: no environment files, keys or raw transcripts are
tracked; no tracked file contains a key, token, database URL or database host;
no personal email address; ignore rules cover `.env*`, `docs/ai-log/raw/` and
`.vercel/`; the Docker image excludes `.env` files. Git history (4 commits at
the time of the check) was scanned for keys and database URLs: none. Commits
use GitHub's private no-reply address.

## `APP_URL` and `FRONTEND_URL`

Both are set to the **Vercel address** (`https://<project>.vercel.app`), not
to the API's own `onrender.com` address.

| Variable | What it decides | Why the Vercel address |
|---|---|---|
| `FRONTEND_URL` | Which origin may use the login session (compared with the browser's `Origin`/`Referer` header), and the one origin CORS allows | The browser is on the Vercel address, so that is what those headers say |
| `APP_URL` | The root of every link the API generates | Visitors reach the API at `https://<project>.vercel.app/api`; they never see the Render address |

Three problems this setup could have had, found by probing the production
image directly, and how each is closed:

| Problem found | Fix |
|---|---|
| A request with a trailing slash was redirected to `http://<api-host>:10000/…`, an unreachable internal address, because Apache only knows its internal port | The redirect rule is removed; Laravel's router serves the path either way |
| A signed-out request to a protected route with a browser's `Accept: text/html` crashed with HTTP 500, because Laravel tried to redirect to a login page that does not exist | Signed-out callers always get 401; nothing redirects |
| With all proxy headers trusted, a forged `X-Forwarded-Host` changed the links the API generated | Only `X-Forwarded-Proto` is believed; links are built from `APP_URL` |

Cookies are unaffected by which host Laravel thinks it is on: the session
cookie has no Domain attribute, so the browser binds it to the host it talked
to (the Vercel address), and its Secure flag is an explicit setting rather
than derived from the request. CSRF validation does not use either variable.

## Calling the API host directly

The Render address is public, so anyone can call the API without going
through the frontend. What that gains them:

| Concern | Result |
|---|---|
| Using someone else's session | Not possible. A visitor's cookie is bound to the Vercel host and is never sent to the Render host. |
| CSRF | Unchanged. A request that changes data still needs the token or the browser's same-origin marker (HTTP 419 otherwise). |
| Signing in without the frontend | Refused (HTTP 400) unless the request claims the frontend's origin. A script can claim it, but then it is simply a client signing in with valid credentials. |
| Forging the host | No effect; links come from `APP_URL`. |
| Forging the client address to dodge rate limits | Sign-in and sign-up are limited three ways per minute: 10 per claimed visitor address, 60 per edge address, 10 per email address. The claimed address is accurate through the frontend (Vercel overwrites it) and forgeable directly; the edge address is written by Render's edge network on every request and is the real caller on a direct call. A direct caller inventing addresses is therefore held by the edge limit, and guessing one account by the email limit. |

No shared secret between Vercel and the API is needed for this, which keeps
the first deployment simple. The one assumption behind it was checked on the
live service rather than taken on trust: a request carrying a forged
`CF-Connecting-IP` header is refused by Render's edge network before it
reaches the API (HTTP 403), and on ordinary requests the header holds the
real connecting address whatever `X-Forwarded-For` claims. `make verify`
repeats this check on every run.

## Live verification

First run on 2026-11-16 against the public site, with the API at commit
`5fb73b7`. The checks have grown with every feature since; the latest run
is under "Release review deployment" below.

```bash
make verify URL=https://eneba-marketplace-ten.vercel.app API_URL=https://eneba-marketplace-api-pylw.onrender.com
```

**51 of 51 checks passed.**

| Area | What was checked on the live site | Result |
|---|---|---|
| Identity | The API answers as this repository's code does and reports this repository at the expected commit | pass |
| Frontend | Home page and a client-side route (`/account`) return the app | pass |
| Rewrite | `/api/*` reaches the API through the site's own address; unknown API paths get the API's JSON 404, not the app; responses are not cached by the proxy (`x-vercel-cache: MISS`) | pass |
| Session cookie through Vercel | Session and `XSRF-TOKEN` arrive as two separate `Set-Cookie` headers, unmodified: HttpOnly (session), Secure, SameSite=Lax, path `/`, no Domain | pass |
| Request headers through Vercel | `Cookie`, `Origin`/`Referer` and the token header reach Laravel; Laravel sees HTTPS | pass |
| Registration | Creates the account, signs in, issues a new session id, returns no password field | pass |
| Session persistence | The cookie alone identifies the user on the next request | pass |
| Sign-in | Right password accepted, wrong password rejected (422) | pass |
| Logout | Signs out; the old cookie no longer works (session destroyed on the server) | pass |
| CSRF protection | A cross-site request without the token is rejected (419), including a forged sign-out, which changes nothing | pass |
| Protected endpoints | A visitor gets 401 from a protected route, with no redirect; `/api/auth/me` answers a visitor with `{"data": null}` | pass |
| Direct calls to the API host | Sign-in refused without the frontend's origin or from another origin (400); CSRF still enforced; forged host ignored; forged client address not believed; forged `CF-Connecting-IP` refused by Render's edge (403) | pass |

In a real browser on the live site (read-only, signed out): no console errors;
the page's scripts can see `XSRF-TOKEN` but not the session cookie; the
browser's request arrives at Laravel with `Sec-Fetch-Site: same-origin`, the
`Referer`, and both cookies. Registration and sign-in were also done by hand
on the live site by the author.

What Laravel receives through Vercel, for the record: the `Host` header is
the Render address and `X-Forwarded-Host` is the site's address. Neither is
used for anything; links are built from `APP_URL`.

### One finding from the live run

The first run passed 50 of 51. A request for `/api/health/` (with a trailing
slash) returned 404 through the site but 200 on the API host directly.

Cause: Vercel's own router answered it (`x-vercel-error: NOT_FOUND`). Its
`/api/:path*` rule does not match a path ending in a slash, and the app
fallback deliberately excludes `/api/`, so no rule applies and the request
is never forwarded. Nothing is redirected and nothing leaks; the app never
requests such URLs. No configuration was changed. The check, which exists to
catch a redirect to the API's internal address, now states that property
directly, and the local stand-in and routing model were updated to behave as
Vercel does.

A second, cosmetic finding: the bare path `/api` returned Laravel's HTML
error page. Errors under `/api` are now always JSON.

Each run creates one throwaway `deploy-check-…@example.com` account; two
exist from these runs.

### Catalog deployment (2026-11-17)

The games/variants migration, the catalog seeder and the catalog API were
deployed to production.

Before pushing, on a local copy of production's schema as it was (old
tables, with user and session rows, no catalog):

| Check | Result |
|---|---|
| The pending migration applies | yes; user rows identical before and after |
| A purchase, a reservation, product and seller sales counts and a switched-off offer, then two more deploys | all unchanged |
| The migration on a database that unexpectedly has products | refused; schema untouched, migration not recorded |

On the live site afterwards:

| Check | Result |
|---|---|
| Deploy | new version serving 48 seconds after the push; `/api/health` answered 200 throughout |
| Seeded catalog | 71 products, 272 offers, 3 sold out: identical to a fresh local seed, row ids included, compared through the API |
| Recorded response examples (`web/src/contracts`) | all three identical to the live responses |
| `make verify` | 48 of 48, including the new catalog section and a cover image served by the site |
| A second deployment | catalog identical, same row ids (nothing recreated or reset) |
| Sign-in | still verified end to end |

Cover images need no routing rule. They are static files in the frontend
build (`web/public/covers`), and the frontend host serves an existing file
before it considers any rewrite. A cover path with no file behind it would
get the app's page instead of a 404; `generate-covers.mjs --check`, which
runs with the tests, fails if any game lacks its cover.

### Release review deployment (2026-11-17)

The fixes from the pre-submission review were deployed as commit `630bf59`:
the one-pending-order index (a migration that first settles any buyer's
extra unpaid orders), the fixed lock order for payments, input validation,
the bearer-token fix, and the frontend changes.

| Check | Result |
|---|---|
| Backend tests, frontend tests, style and type checks | 274 and 149 passed |
| `make prod-check` (the production build, locally, including a purchase) | 118 of 118 |
| `make audit` | passed |
| Deploy | the migration applied on start; `/api/health` reported the new commit |
| `make verify` against the public site | 97 of 97, including the new section 12 (bearer tokens ignored, a write without the CSRF token refused, malformed filters answered 422) |
| The site in a browser, signed out, at 1440 and 375 px wide | homepage, store by category, product, cart, account, order history and an unknown address: no console errors, no broken images, no sideways scroll |

### Final deployment (2026-11-17)

One correction followed the release review and was deployed as commit
`e0a0409`: a checkout that lost the race to another checkout of the same
buyer used to cancel the order that had won. It now cancels nothing (see
"One buyer's checkouts overlap" in `ARCHITECTURE.md`). Commits after
`e0a0409` change only this record, the verification script and the
conversation log; no application code.

| Check | Result |
|---|---|
| Backend tests, frontend tests, style and type checks | 278 and 149 passed |
| `make prod-check` (the production build, locally, including a purchase) | 121 of 121 |
| `make audit` | passed |
| Deploy | `/api/health` reported `e0a0409`; the frontend's files are the ones a build of that commit produces |
| `make verify` against the public site | 100 of 100 |

The checkout checks that ran against the live site, each with one
throwaway account and ending with every key back on sale:

| Sent | Answered | Afterwards |
|---|---|---|
| The same request three times at once (one key) | 201, 200, 200 | one order |
| The same cart from two more tabs (new keys) while that order is unpaid | 200, 200, both with that order | that order, still unpaid |
| The same cart from three tabs at once (three keys), no order in progress | 201, 200, 200, all with one order | one unpaid order |
| Two different carts at once | 201 and 409 `checkout_in_progress` | one unpaid order: the accepted one |

The last row can also legitimately answer 201 twice, when the two requests
do not overlap and the later one replaces the earlier as a changed cart
does; the check accepts either, and fails on two unpaid orders or on an
accepted order that is no longer the unpaid one. The overlap itself is
forced, not left to timing, in the two-connection tests
(`CheckoutConcurrencyTest`).

### Cold start, observed

On 2026-11-17 the first request after the API had slept took 25 seconds
through the public address and then succeeded (HTTP 200); the frontend's
own files were served at once throughout. A visitor therefore sees the
page frame immediately, loading placeholders where data goes, and after
four seconds a notice that the server may be waking up, which leaves when
the data arrives. The host's documentation allows up to about a minute.

This happens only on Render's free plan. On 2026-11-19 the author moved
the service to a paid instance in Render's dashboard (0.5 CPU, 512 MB, $7 a
month as shown there), which does not sleep. `render.yaml` names no plan,
so the next push does not undo that. The switch redeployed the same commit
and the API answered throughout. Afterwards, a request sent 17 minutes
after this check's previous one was answered in 0.19 seconds; other
visitors in those minutes were not excluded, so Render's own page showing
the paid plan is the firmer evidence.

### Diagnostics

`DEPLOY_DIAGNOSTICS` was switched off in `render.yaml` once authentication
was verified, so `/api/_diagnostics` answers 404 in production. `make
verify` keeps working without it, minus the checks that need the server's
view of a request; the local production check switches it on for itself.
To debug a deployment again, set it to `true` in Render's dashboard.

## Step by step

Secrets are typed into the providers' dashboards only. Never paste a
password, key or connection string into the AI chat: the chat is published.

### 1. GitHub

The repository must be public: reviewers read it, and Render and Vercel
deploy from it. The `gh` tool on this machine is already signed in, so once
approved this is one command, run from the project folder:

```bash
gh repo create eneba-marketplace --public --source=. --remote=origin --push
```

`make audit` is run first. What becomes public: the code, the docs, and the
readable AI log. Not the raw transcripts.

### 2. Neon (database)

1. Sign up at console.neon.tech (GitHub sign-in works). No card.
2. **New Project**. Project name `eneba-marketplace`. Region **AWS Europe
   (Frankfurt)**. Leave the Postgres version at the default, **18**; local
   development and the tests run on 18 as well. **Create project**.
   Neon's console also offers its own command-line workflow (`neon init`,
   `neon deploy`) and object storage. Neither is used: the API is an ordinary
   Laravel application that connects to Neon as a plain PostgreSQL server.
3. Click **Connect**. Turn **Connection pooling off** (the app uses the direct
   connection, which migrations need). Keep this window open. You need:
   - the host: `ep-…​.eu-central-1.aws.neon.tech`, with no `-pooler` in it
   - the password
   The database (`neondb`) and role (`neondb_owner`) are the defaults already
   written in `render.yaml`. If Neon shows different names, tell me.

Nothing else to do in Neon. Tables and the `pg_trgm` extension are created by
the migrations when the API first starts.

### 3. Render (API)

1. In your own Terminal (not in the chat), from the project folder:

   ```bash
   make app-key
   ```

   It prints one line starting with `base64:`. That is the application key.
2. Sign up at dashboard.render.com with GitHub and allow access to the
   `eneba-marketplace` repository.
3. **New > Blueprint**, pick the repository. Render reads `render.yaml` and
   shows one service, `eneba-marketplace-api`: Docker, Frankfurt. The file
   names no plan (see its comment), so choose **Free** here.
4. It asks for five values:

   | Variable | Value |
   |---|---|
   | `APP_KEY` | the line from `make app-key` |
   | `DB_HOST` | the Neon host |
   | `DB_PASSWORD` | the Neon password |
   | `FRONTEND_URL` | `https://not-set-yet.invalid` for now |
   | `APP_URL` | the same value |

   The last two will be the Vercel address, which does not exist yet. The
   placeholder is an address that can never belong to anyone (`.invalid` is
   reserved), so until step 5 no website at all is allowed to use the login
   session. Do not put the Render address here.

5. **Stop if Render asks for a payment method or shows any price above $0**,
   and tell me. Otherwise apply.
6. Watch the service's **Logs**. A good start shows the migrations running,
   then Apache starting.
7. Copy the service's address **from the top of its page in Render's
   dashboard**. Do not assume it: service names on Render are first come,
   first served across all customers, so if `eneba-marketplace-api` was
   already taken by someone else, Render gives this service a different
   address (usually the name plus a suffix), while
   `https://eneba-marketplace-api.onrender.com` keeps pointing at the other
   person's server.
8. Prove the address serves this repository's code:

   ```bash
   make verify-backend API_URL=https://<address from the dashboard>
   ```

   It sends only read-only requests, compares the answers with what this
   code returns, and compares the commit the service reports with GitHub's.

If the log shows a database error, send me the error text (it contains the
host name and no password) rather than changing settings.

### 4. Vercel (frontend)

`web/vercel.json` forwards `/api` to a placeholder address until a backend
has passed step 3.8, so a frontend deployed too early fails safely instead
of sending sign-up data to an unverified server. Once the backend is
confirmed, the real address is written into `web/vercel.json` and this must
pass before deploying:

```bash
make vercel-ready API_URL=https://<address from the dashboard>
```

1. Sign up at vercel.com with GitHub, Hobby plan.
2. **Add New > Project**, import `eneba-marketplace`.
3. **Root Directory: `web`**. Framework preset: Vite (detected). Leave build
   command and output directory at their defaults. No environment variables.
4. **Deploy**. Note the production address.

### 5. Connect the two

In Render, open the service, **Environment**, set `FRONTEND_URL` and `APP_URL`
to the real Vercel address (https, no trailing slash), **Save and deploy**.
No rebuild is needed.

Login works only on that one production address. Vercel's preview addresses
are deliberately not allowed to use the session.

### 6. Verify through the public address

Tell me the Vercel address. Then:

```bash
make verify URL=https://<project>.vercel.app API_URL=https://eneba-marketplace-api-pylw.onrender.com
```

runs the same checks against the live site, including direct calls to the
Render address with forged headers, and prints what the server received
through the proxies. After that, by hand, in **Safari** and in a
**Chrome Incognito** window (the two that block third-party cookies): open
`/account`, create an account, reload the page, sign out.

When everything passes, set `DEPLOY_DIAGNOSTICS` to `false` in Render.

## If the login cookie does not work

The architecture is not changed until the cause is known. The checks narrow
it down in this order:

| Symptom in `make verify` | Meaning | Where to look |
|---|---|---|
| Section 2 fails | The rewrite is not reaching the API | `web/vercel.json` destination; Root Directory setting |
| "two separate Set-Cookie headers" fails | The proxy merged or dropped cookies | Compare with the same request sent straight to the Render address |
| Cookie attributes differ | Something rewrote the cookie | Same comparison |
| "recognised as coming from the frontend" fails | `Origin`/`Referer` did not arrive, or `FRONTEND_URL` does not match the real address | Diagnostics output: `origin`, `referer`, `stateful_domains` |
| "session cookie reached the server" fails | The `Cookie` header was not forwarded | Diagnostics output: `cookie_names` |
| "knows the visitor used HTTPS" fails | Forwarded headers lost or not trusted | Diagnostics output: `x_forwarded_proto`, `TRUSTED_PROXIES` |
| "APP_URL and FRONTEND_URL are both the public address" fails | One of them was set to the Render address or has a typo | Render > Environment |
| "edge address … cannot be forged" fails | Render's edge does not overwrite `CF-Connecting-IP` | Switch to the secret-header approach |
| Script passes, a browser fails | Browser-specific cookie policy | The browser's cookie panel shows why a cookie was rejected |

Only if the cause turns out to be something Vercel does and cannot be
configured does the fallback apply: serve the built frontend from Laravel on
one address (option C in ARCHITECTURE.md).

## Known limitations

- **Cold start.** After 15 idle minutes the first API request waits for the
  service to start: 25 seconds when measured, up to about a minute. The
  proxy waits up to 120 seconds.
- **Throwaway accounts.** Each `make verify` run creates one
  `deploy-check-…@example.com` user, or two with `PURCHASE=1`, and leaves
  any test orders they placed.
- **No rollback step.** A migration that fails stops the new container from
  starting, and the host keeps serving the previous version; it is then
  corrected by a new commit.

## Free-tier limits verified on 2026-11-16

The API has been on a paid Render instance since 2026-11-19, so the Render
rows about sleeping and free instance hours describe the plan it was built
on, not the one it runs on. Vercel and Neon are still on their free plans.

Read from each provider's own documentation on that date. Providers change
these; re-check before relying on a figure.

### Render

| Fact | Source |
|---|---|
| Free web services sleep after 15 minutes without traffic; waking takes about one minute | https://render.com/docs/free |
| 750 free instance hours per workspace per month, enough for one service running continuously | https://render.com/docs/free |
| 0.1 CPU, 512 MB, no persistent disk, no shell, no pre-deploy command | https://render.com/docs/free, https://render.com/docs/deploys |
| The container must listen on `0.0.0.0:$PORT` (10000 by default) | https://render.com/docs/web-services |
| The last stage of the Dockerfile is what runs; a stage cannot be chosen | https://render.com/docs/docker |
| Hobby workspace: 5 GB bandwidth and 500 build minutes per month; with no card on file, exceeding bandwidth suspends free services until the next month | https://render.com/docs/outbound-bandwidth, https://render.com/docs/build-pipeline |
| **Free Postgres expires 30 days after creation**, then a 14-day grace period, then deletion | https://render.com/docs/free |

The 30-day database expiry is why the database is not on Render.

### Neon

| Fact | Source |
|---|---|
| Free plan is permanent, no card required | https://neon.com/pricing |
| 1 GB storage per project; 100 compute-unit hours per project per month | https://neon.com/docs/introduction/plans |
| Compute suspends after 5 minutes idle; waking typically takes a few hundred milliseconds | https://neon.com/docs/connect/connection-latency |
| Projects are not paused or deleted for inactivity | https://neon.com/faqs/does-neon-pause-inactive-projects |
| `pg_trgm` is supported | https://neon.com/docs/extensions/pg-extensions |
| TLS is mandatory; `verify-full` is recommended; certificates are issued by a public authority (ISRG Root X1) | https://neon.com/docs/connect/connect-securely |
| New projects default to Postgres 18; 14 to 18 are available. This project uses 18. | https://neon.com/docs/postgresql/postgres-version-policy |

### Vercel

| Fact | Source |
|---|---|
| Hobby includes 100 GB data transfer and 1,000,000 requests per month | https://vercel.com/docs/plans/hobby |
| Rewrites to an external address are a documented reverse proxy | https://vercel.com/docs/rewrites |
| A proxied request may take up to 120 seconds before failing with HTTP 502 | https://vercel.com/docs/limits |
| Projects created after 6 April 2026 cache proxied responses that allow it; a `headers` rule opts a path out | https://vercel.com/docs/routing/rewrites |
| The file system is checked before rewrites, so built assets are never replaced by the app's fallback page | https://vercel.com/docs/project-configuration/vercel-json |
| Hobby is for personal, non-commercial use, and projects may be removed without notice | https://vercel.com/legal/terms |

An unpaid assignment with simulated payments matches none of Vercel's listed
examples of commercial use, but Vercel does not address this case explicitly.

### Ruled out

| Host | Reason | Source |
|---|---|---|
| Railway | Not free beyond a 30-day trial credit | https://docs.railway.com/reference/pricing/plans |
| Fly.io | No free tier for new accounts | https://docs.fly.io/about/pricing |
| Google Cloud Run | Free at this scale, but needs a billing account with a payment method | https://docs.cloud.google.com/free/docs/free-cloud-features |
| Koyeb | Free instance exists but a card appears to be required; status unclear | https://www.koyeb.com/docs/faqs/pricing |

## Not confirmed from documentation

- Whether Render asks for a card at sign-up or for a Blueprint.
- How a Vercel rewrite treats `Set-Cookie`, `Cookie` and ordinary request
  headers: the documentation is silent, but the live verification above
  shows they pass through unchanged.
