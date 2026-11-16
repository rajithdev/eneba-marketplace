# Deployment

**Status: prepared and verified locally. Nothing is pushed or deployed, and no
accounts or services have been created.**

| Part | Host | Why |
|---|---|---|
| React app | Vercel (Hobby) | Static hosting that does not sleep; documented reverse-proxy rewrites with a stated timeout |
| Laravel API | Render (free web service, Docker, Frankfurt) | The only host checked that runs a Docker container free with no documented card requirement |
| PostgreSQL | Neon (Free, AWS Frankfurt) | No expiry; `pg_trgm` available |

```
Browser ── https://<project>.vercel.app ──┬─ static files (the React app)
                                          └─ /api/*  ── rewrite ──> https://eneba-marketplace-api.onrender.com ──> Neon
```

The browser only ever talks to the Vercel address. That is what makes the
login cookie a first-party cookie (see Authentication in ARCHITECTURE.md).

## Configuration files

| File | What it controls |
|---|---|
| `render.yaml` | The API service: Docker build, free plan, region, health check, every environment variable. Secrets are marked `sync: false` and typed into Render's dashboard. |
| `api/Dockerfile` (stage `prod`) | The production image: Apache, PHP 8.4, no dev packages |
| `api/docker/entrypoint.sh` | Start-up: listen on Render's port, refuse unsafe settings, cache config, run migrations |
| `web/vercel.json` | Forwards `/api/*` to the confirmed Render address (a placeholder until one is confirmed); serves the app for every other path; switches off proxy caching for `/api`. Checked by `scripts/deploy/check-vercel-config.mjs`. |

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
The one case that cannot be tested locally is the successful `verify-full`
connection to Neon's publicly trusted certificate; the first deployment shows
it (migrations run at start-up and fail loudly if the connection is refused).

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
the first deployment simple. One assumption is checked on the live site
rather than taken on trust: that Render's edge really overwrites
`CF-Connecting-IP`. `make verify` sends a forged value directly and fails if
the server accepts it. If it does, the fallback is the documented secret
header from Vercel.

## What only the real deployment can prove

Vercel's documentation does not state how a rewrite treats cookies or ordinary
request headers. The local stand-in proves our side; these need the live site,
and `verify-deployment.mjs` checks each of them:

1. Both `Set-Cookie` headers reach the browser separately and unmodified.
2. The browser's `Cookie`, `Origin`, `Referer` and token headers reach Laravel.
3. Laravel sees HTTPS and the Vercel host after Vercel, Cloudflare and
   Render's load balancer.
4. The `verify-full` connection to Neon succeeds.
5. What the app receives while the Render service is waking up.
6. Render's edge overwrites `CF-Connecting-IP` (see above).

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
   shows one service, `eneba-marketplace-api`: Docker, **Free**, Frankfurt.
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
make verify URL=https://<project>.vercel.app API_URL=https://eneba-marketplace-api.onrender.com
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

- **Cold start.** After 15 idle minutes the first API request takes about a
  minute. The proxy waits up to 120 seconds.
- **Throwaway accounts.** Each `make verify` run creates one
  `deploy-check-…@example.com` user.

## Free-tier limits verified on 2026-11-16

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
  headers (community reports say they pass through; the documentation is
  silent). Settled by step 6.
