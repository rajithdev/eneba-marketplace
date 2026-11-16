# Deployment plan and free-tier limits

**Status: nothing is deployed and no accounts or services have been created.**
This file records the limits checked before choosing hosts, and the plan.

## Plan

| Part | Host | Why |
|---|---|---|
| React app | Vercel (Hobby) | Static hosting that does not sleep; documented reverse-proxy rewrites with a stated timeout |
| Laravel API | Render (free web service, Docker) | The only host checked that runs a Docker container free with no documented card requirement |
| PostgreSQL | Neon (Free) | No expiry; `pg_trgm` available |

The frontend forwards `/api/*` to the API with a rewrite rule, so the browser
sees a single origin (see Authentication in ARCHITECTURE.md).

## Limits verified on 2026-11-16

Read from each provider's own documentation on that date. Providers change
these; re-check before relying on a figure.

### Render

| Fact | Source |
|---|---|
| Free web services sleep after 15 minutes without traffic; waking takes about one minute | https://render.com/docs/free |
| 750 free instance hours per workspace per month, enough for one service running continuously | https://render.com/docs/free |
| 0.1 CPU, 512 MB, no persistent disk, no shell | https://render.com/docs/free |
| Hobby workspace: 5 GB bandwidth and 500 build minutes per month; with no card on file, exceeding bandwidth suspends free services until the next month | https://render.com/docs/outbound-bandwidth, https://render.com/docs/build-pipeline |
| **Free Postgres expires 30 days after creation**, then a 14-day grace period, then deletion | https://render.com/docs/free |

The 30-day database expiry is why the database is not on Render: it could
fall inside the review period.

### Neon

| Fact | Source |
|---|---|
| Free plan is permanent, no card required | https://neon.com/pricing |
| 1 GB storage per project; 100 compute-unit hours per project per month | https://neon.com/docs/introduction/plans |
| Compute suspends after 5 minutes idle; waking typically takes a few hundred milliseconds | https://neon.com/docs/connect/connection-latency |
| Projects are not paused or deleted for inactivity | https://neon.com/faqs/does-neon-pause-inactive-projects |
| `pg_trgm` is supported | https://neon.com/docs/extensions/pg-extensions |
| Run migrations over the direct connection, not the pooled one | https://neon.com/docs/guides/laravel-migrations |

One page mentions deletion of free projects inactive for 90 days, in the
context of Azure regions being retired. To stay clear of it, the database
goes in an AWS region.

### Vercel

| Fact | Source |
|---|---|
| Hobby includes 100 GB data transfer and 1,000,000 requests per month | https://vercel.com/docs/plans/hobby |
| Rewrites to an external address are a documented reverse proxy | https://vercel.com/docs/rewrites |
| A proxied request may take up to 120 seconds before failing with HTTP 502 | https://vercel.com/docs/limits |
| Projects created after 6 April 2026 cache proxied responses that allow it; the API must send `Cache-Control: no-store` or the rewrite must opt out | https://vercel.com/docs/rewrites |
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

## Risks and how they are handled

| Risk | Handling |
|---|---|
| A reviewer's first request hits a sleeping API and waits about a minute | The frontend shows a "waking the server" state and retries. The 120-second proxy limit is above the wake time. |
| Keeping the API awake with a pinger also keeps the database awake and uses up Neon's monthly compute around day 17 | `/api/health` does not query the database. Any uptime ping uses only that route. |
| The proxy does not pass the login cookie through | Tested on the first deployment, before features depend on it. Fallback: serve the built frontend from Laravel on one address. |
| Free-tier terms change before submission | Re-check this file's figures when deploying. |

## Not yet confirmed

- Whether Render asks for a card at sign-up (its documentation does not say).
- That `Set-Cookie` passes through a Vercel rewrite (community reports say
  yes; Vercel's documentation does not state it).
