#!/usr/bin/env node
// End-to-end check of a running deployment, through its public address.
//
//   node scripts/deploy/verify-deployment.mjs https://<project>.vercel.app --api-origin=https://<service>.onrender.com
//   node scripts/deploy/verify-deployment.mjs http://localhost:4780 --behind-https-proxy --api-origin=http://localhost:8100
//
// --api-origin is the API host's own address. With it, the script also calls
// the API directly, bypassing the frontend, to check that doing so gains an
// attacker nothing.
//
// It behaves like a browser on the frontend's origin, but keeps its own cookie
// jar so every cookie the server sets can be inspected. It checks, in order:
// the frontend is served, the API answers through the same origin, the session
// cookie has safe attributes, CSRF protection rejects forged requests, and
// sign-up, sign-in and sign-out work, all by cookie.
//
// It creates one throwaway account (deploy-check-<time>@example.com) with a
// random password that is never printed. Exit code 0 means every check passed.
//
// No dependencies; needs only Node 20+.

import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

const [baseArg, ...flags] = process.argv.slice(2)
if (!baseArg) {
  console.error('Usage: verify-deployment.mjs <base-url> [--behind-https-proxy] [--api-origin=<url>] [--expect-commit=<sha>] [--identity-only] [--purchase]')
  process.exit(2)
}
const base = new URL(baseArg)
const origin = base.origin
// Cookies must be marked Secure whenever visitors use https. Locally the
// stand-in proxy claims https while we talk to it over http.
const expectSecure = base.protocol === 'https:' || flags.includes('--behind-https-proxy')
const apiOriginFlag = flags.find((flag) => flag.startsWith('--api-origin='))
const apiOrigin = apiOriginFlag ? new URL(apiOriginFlag.slice('--api-origin='.length)) : null
// Before anything else the script checks that the backend is OURS: that it
// answers the way this repository's code does and, with --expect-commit=<sha>,
// that it was built from that commit. If not, it stops: no account is created
// and no password is sent to a server that has not been proven to be ours.
// Host names on shared platforms are first come, first served, so an address
// that looks right can belong to someone else. --identity-only runs just this.
const expectCommit = flags.find((flag) => flag.startsWith('--expect-commit='))?.slice('--expect-commit='.length)
const identityOnly = flags.includes('--identity-only')

// ------------------------------------------------------------ http client ---

const jar = new Map() // cookie name -> value

function request(method, path, { body, headers = {}, cookies = jar, asFrontend = true, target = base } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')

  const allHeaders = {
    accept: 'application/json',
    // What a browser on our frontend sends. Sanctum uses these to decide the
    // request may use the session.
    ...(asFrontend ? { origin, referer: `${origin}/account` } : {}),
    ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...headers,
  }

  return new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http
    const req = client.request(new URL(path, target), { method, headers: allHeaders, timeout: 150_000 }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] ?? []
        if (cookies === jar) {
          for (const line of setCookies) {
            const [pair] = line.split(';')
            const index = pair.indexOf('=')
            jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
          }
        }
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          // not JSON
        }
        resolve({ status: res.statusCode, headers: res.headers, setCookies, text, json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timed out after 150 seconds')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** The header our frontend sends on requests that change data. */
const xsrfHeader = () => ({ 'x-xsrf-token': decodeURIComponent(jar.get('XSRF-TOKEN') ?? '') })

/**
 * JSON for printing, with IP addresses replaced. The output of this script is
 * often pasted into chats and issue trackers; a visitor's address has no
 * business there. Checks always compare the real values.
 */
function withoutAddresses(value) {
  return JSON.stringify(value)
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<address>')
    .replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi, '<address>')
}

function attributesOf(setCookieLine) {
  const [, ...parts] = setCookieLine.split(';').map((part) => part.trim())
  return Object.fromEntries(
    parts.map((part) => {
      const [key, ...rest] = part.split('=')
      return [key.toLowerCase(), rest.join('=') || true]
    }),
  )
}

// ---------------------------------------------------------------- checks ---

const results = []
let section = ''

function check(name, passed, detail = '') {
  results.push({ section, name, passed, detail })
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function heading(title) {
  section = title
  console.log(`\n${title}`)
}

const email = `deploy-check-${Date.now()}@example.com`
const password = randomBytes(18).toString('base64url')

console.log(`Verifying ${origin}`)

heading('0. Is this backend built from this repository?')
{
  // Read-only requests, no cookies, nothing private. Checked on the API host
  // itself when its address is given, otherwise through the frontend.
  const target = apiOrigin ?? base
  const ask = (path) => request('GET', path, { cookies: new Map(), target })

  const health = await ask('/api/health')
  const healthKeys = Object.keys(health.json ?? {}).sort().join(',')
  check(
    'The health route answers exactly as this code does',
    health.status === 200 && health.json?.status === 'ok' && healthKeys === 'commit,status',
    `HTTP ${health.status} ${health.text.slice(0, 90)}`,
  )

  const me = await ask('/api/auth/me')
  check(
    'The current-user route answers a visitor with {"data":null}',
    me.status === 200 && me.json?.data === null && Object.keys(me.json).length === 1,
    `HTTP ${me.status} ${me.text.slice(0, 60)}`,
  )

  const csrf = await ask('/api/sanctum/csrf-cookie')
  check('The CSRF cookie route exists under /api', csrf.status === 204, `HTTP ${csrf.status}`)

  // Which commit is running. The health route reports it; on a host that
  // does not provide one (local runs) there is nothing to compare.
  const running = health.json?.commit ? String(health.json.commit) : null
  if (running) {
    console.log(`  running commit ${running.slice(0, 7)}`)
    if (expectCommit) {
      check('It runs the expected commit', running === expectCommit, `expected ${expectCommit.slice(0, 7)}, running ${running.slice(0, 7)}`)
    }
  } else if (expectCommit && target.protocol === 'https:') {
    check('It reports which commit it runs', false, 'no commit reported')
  }

  if (results.some((result) => !result.passed)) {
    console.log(`\nSTOPPED. ${target.origin} is not serving this repository's code.`)
    console.log('Nothing else was sent to it: no account was created and no password was transmitted.')
    console.log('Check the service address and the deployed commit in the hosting dashboard.')
    process.exit(3)
  }
  if (identityOnly) {
    console.log(`\n${results.length} of ${results.length} checks passed. This backend is ours.`)
    process.exit(0)
  }
}

heading('1. Frontend')
{
  const home = await request('GET', '/', { headers: { accept: 'text/html' }, cookies: new Map() })
  check('The home page is the React app', home.status === 200 && home.text.includes('id="root"'), `HTTP ${home.status}`)

  // Addresses that exist only inside the React app must still load when
  // opened directly (a refresh, or a link someone shared).
  for (const path of ['/account', '/store?platform=steam&sort=price_asc&page=2', '/product/elden-ring-steam-key-global']) {
    const deepLink = await request('GET', path, { headers: { accept: 'text/html' }, cookies: new Map() })
    check(`Opening ${path.split('?')[0]} directly returns the app`, deepLink.status === 200 && deepLink.text.includes('id="root"'), `HTTP ${deepLink.status}`)
  }
}

heading('2. API through the same origin')
{
  const started = Date.now()
  const health = await request('GET', '/api/health', { cookies: new Map() })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  check('/api/health answers with JSON', health.status === 200 && health.json?.status === 'ok', `HTTP ${health.status} in ${seconds}s`)

  const cacheControl = String(health.headers['cache-control'] ?? '')
  check('API responses are marked not cacheable', /private|no-store|no-cache/.test(cacheControl), `Cache-Control: ${cacheControl || 'missing'}`)
  check('The proxy did not serve it from a cache', !/HIT/i.test(String(health.headers['x-vercel-cache'] ?? '')), `x-vercel-cache: ${health.headers['x-vercel-cache'] ?? 'not present'}`)

  const missing = await request('GET', '/api/no-such-route', { cookies: new Map() })
  check('An unknown /api path reaches the API (JSON 404), not the app', missing.status === 404 && missing.json !== null, `HTTP ${missing.status}`)

  // What must never happen is a redirect to the API's internal address. Two
  // outcomes are fine: the path is served (the local stand-in, and the API
  // host itself), or the frontend host refuses it with its own 404 without
  // forwarding it (Vercel: its "/api/:path*" rule does not match a path that
  // ends in a slash; observed on the live site). The app never calls such URLs.
  const slash = await request('GET', '/api/health/', { cookies: new Map() })
  check(
    'A trailing slash never causes a redirect (it is served, or refused by the frontend host)',
    !slash.headers.location && [200, 404].includes(slash.status),
    `HTTP ${slash.status}${slash.headers.location ? ` -> ${slash.headers.location}` : ''}`,
  )
}

heading('3. Session cookie')
let sessionCookieName = null
{
  const csrf = await request('GET', '/api/sanctum/csrf-cookie')
  check('The CSRF cookie route answers', csrf.status === 204, `HTTP ${csrf.status}`)
  check('Session and XSRF-TOKEN arrive as two separate Set-Cookie headers', csrf.setCookies.length === 2, `${csrf.setCookies.length} Set-Cookie header(s)`)

  const xsrfLine = csrf.setCookies.find((line) => line.startsWith('XSRF-TOKEN='))
  const sessionLine = csrf.setCookies.find((line) => !line.startsWith('XSRF-TOKEN='))
  sessionCookieName = sessionLine?.split('=')[0] ?? null

  if (sessionLine && xsrfLine) {
    const session = attributesOf(sessionLine)
    const xsrf = attributesOf(xsrfLine)
    check('Session cookie is HttpOnly (scripts cannot read it)', session.httponly === true)
    check('Session cookie is SameSite=Lax', String(session.samesite).toLowerCase() === 'lax', `SameSite=${session.samesite}`)
    check('Session cookie has no Domain attribute (bound to this host only)', session.domain === undefined, session.domain ? `Domain=${session.domain}` : '')
    check('Session cookie path is /', session.path === '/', `Path=${session.path}`)
    check('XSRF-TOKEN is readable by the page and has no Domain', xsrf.httponly === undefined && xsrf.domain === undefined)
    if (expectSecure) {
      check('Both cookies are marked Secure', session.secure === true && xsrf.secure === true)
    }
  } else {
    check('Both cookies were set', false, csrf.setCookies.map((line) => line.split('=')[0]).join(', ') || 'none')
  }
}

heading('4. What the server sees through the proxies')
{
  const diagnostics = await request('GET', '/api/_diagnostics')
  if (diagnostics.status === 404) {
    console.log('  (diagnostics are switched off on this deployment; skipped)')
  } else {
    const seen = diagnostics.json?.what_laravel_concluded ?? {}
    const arrived = diagnostics.json?.what_arrived ?? {}
    console.log(`  arrived:   ${withoutAddresses(arrived)}`)
    console.log(`  concluded: ${withoutAddresses(seen)}`)
    check('The request is recognised as coming from the frontend', seen.treated_as_frontend_request === true, `Origin ${arrived.origin}`)
    check('A session was started for it', seen.session_started === true)
    check('The session cookie sent by the client reached the server', (arrived.cookie_names ?? []).includes(sessionCookieName), `cookies seen: ${(arrived.cookie_names ?? []).join(', ') || 'none'}`)
    if (expectSecure) check('The server knows the visitor used HTTPS', seen.is_secure === true, `scheme ${seen.scheme}`)
    check('Links the API generates start with the public address', String(seen.generated_url).startsWith(`${origin}/`), String(seen.generated_url))
    check('APP_URL and FRONTEND_URL are both the public address', diagnostics.json?.configuration?.app_url === origin && diagnostics.json?.configuration?.frontend_url === origin, `APP_URL ${diagnostics.json?.configuration?.app_url}, FRONTEND_URL ${diagnostics.json?.configuration?.frontend_url}`)
    check('Debug mode is off', diagnostics.json?.configuration?.debug === false)
  }
}

heading('5. CSRF protection')
{
  const visitor = await request('GET', '/api/auth/me')
  check('A visitor is told "nobody is signed in" without an error', visitor.status === 200 && visitor.json?.data === null, `HTTP ${visitor.status}`)

  const protectedAsHtml = await request('POST', '/api/auth/logout', { headers: { accept: 'text/html', ...xsrfHeader() } })
  check('A protected route answers 401 to a visitor, with no redirect', protectedAsHtml.status === 401 && !protectedAsHtml.headers.location, `HTTP ${protectedAsHtml.status}`)

  const forged = await request('POST', '/api/auth/register', {
    body: { name: 'Forged', email: `forged-${email}`, password },
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  check('A request from another site, without the token, is rejected', forged.status === 419, `HTTP ${forged.status}`)
}

heading('6. Sign up, sign in, sign out')
{
  const sessionBefore = jar.get(sessionCookieName)
  const register = await request('POST', '/api/auth/register', {
    body: { name: 'Deploy Check', email, password },
    headers: xsrfHeader(),
  })
  check('Sign-up succeeds', register.status === 201 && register.json?.data?.email === email, `HTTP ${register.status}`)
  check('Sign-up issues a new session id', jar.get(sessionCookieName) !== sessionBefore)
  check('The response contains no password field', !/password/i.test(register.text))

  const me = await request('GET', '/api/auth/me')
  check('The session cookie alone identifies the user on the next request', me.status === 200 && me.json?.data?.email === email, `HTTP ${me.status}`)

  const noOrigin = await request('GET', '/api/auth/me', { asFrontend: false })
  check('The same cookie sent without the frontend origin is not accepted', noOrigin.status === 200 && noOrigin.json?.data === null, `HTTP ${noOrigin.status}`)

  const forgedLogout = await request('POST', '/api/auth/logout', { headers: { 'sec-fetch-site': 'cross-site' } })
  const stillSignedIn = await request('GET', '/api/auth/me')
  check('A forged sign-out from another site is rejected and changes nothing', forgedLogout.status === 419 && stillSignedIn.status === 200, `HTTP ${forgedLogout.status}`)

  const stolen = new Map(jar)
  const logout = await request('POST', '/api/auth/logout', { headers: xsrfHeader() })
  check('Sign-out succeeds', logout.status === 204, `HTTP ${logout.status}`)

  const afterLogout = await request('GET', '/api/auth/me')
  check('After sign-out the user is a visitor again', afterLogout.status === 200 && afterLogout.json?.data === null, `HTTP ${afterLogout.status}`)

  const replay = await request('GET', '/api/auth/me', { cookies: stolen })
  check('The old session cookie no longer works (destroyed on the server)', replay.status === 200 && replay.json?.data === null, `HTTP ${replay.status}`)

  const wrong = await request('POST', '/api/auth/login', { body: { email, password: `${password}x` }, headers: xsrfHeader() })
  check('A wrong password is rejected', wrong.status === 422, `HTTP ${wrong.status}`)

  const login = await request('POST', '/api/auth/login', { body: { email, password }, headers: xsrfHeader() })
  const meAgain = await request('GET', '/api/auth/me')
  check('Sign-in with the right password works', login.status === 200 && meAgain.json?.data?.email === email, `HTTP ${login.status}, then ${meAgain.status}`)
}

if (apiOrigin) {
  heading('7. Calling the API host directly, bypassing the frontend')
  const direct = (method, path, options = {}) => request(method, path, { target: apiOrigin, ...options })

  // The signed-in cookie from section 6, replayed straight at the API host
  // with the frontend's Origin: this is what an attacker holding a stolen
  // cookie would do. It is the same credential, so it is expected to work;
  // what matters is that nothing ELSE works better here than via the frontend.
  const health = await direct('GET', '/api/health', { cookies: new Map(), asFrontend: false })
  check('The API host answers directly', health.status === 200, `HTTP ${health.status}`)

  const noOriginLogin = await direct('POST', '/api/auth/login', { body: { email, password }, cookies: new Map(), asFrontend: false })
  check('Sign-in without the frontend origin is refused', noOriginLogin.status === 400, `HTTP ${noOriginLogin.status}`)

  const otherOrigin = await direct('POST', '/api/auth/login', {
    body: { email, password },
    cookies: new Map(),
    asFrontend: false,
    headers: { origin: 'https://evil.example', referer: 'https://evil.example/' },
  })
  check('Sign-in from another website\'s origin is refused', otherOrigin.status === 400, `HTTP ${otherOrigin.status}`)

  const directJar = new Map()
  await direct('GET', '/api/sanctum/csrf-cookie', { cookies: directJar })
  const noToken = await direct('POST', '/api/auth/login', { body: { email, password }, cookies: directJar })
  check('A direct request that changes data still needs the CSRF token', noToken.status === 419, `HTTP ${noToken.status}`)

  const slash = await direct('GET', '/api/health/', { cookies: new Map(), asFrontend: false })
  check('No redirect to an internal address', slash.status === 200 && !slash.headers.location, `HTTP ${slash.status}`)
  check('The PHP version is not advertised', !health.headers['x-powered-by'], health.headers['x-powered-by'] ?? '')

  // Forged forwarding headers, as a caller bypassing the frontend could send.
  const forged = await direct('GET', '/api/_diagnostics', {
    cookies: new Map(),
    headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-host': 'evil.example' },
  })
  if (forged.status === 404) {
    console.log('  (diagnostics are switched off; forged-header checks skipped)')
  } else {
    // A missing or unreadable answer must fail these checks, not pass them.
    const seen = forged.json?.what_laravel_concluded
    check('The diagnostics route answered the forged request', forged.status === 200 && Boolean(seen), `HTTP ${forged.status}`)
    if (seen) {
      console.log(`  with forged headers the server concluded: ${withoutAddresses(seen)}`)
      check('A forged host header does not change generated links', !String(seen.generated_url).includes('evil.example') && seen.host !== 'evil.example', String(seen.generated_url))
      check('A forged forwarded address is not taken as the client address', seen.client_ip !== '203.0.113.7')
      check('The edge address used for rate limiting is not the forged one', seen.rate_limit_addresses?.edge !== '203.0.113.7')
    }

    if (apiOrigin.protocol === 'https:') {
      // Only meaningful on the real host. Its edge network sets CF-Connecting-IP
      // itself; a caller-supplied one must either be refused outright or
      // replaced. Either outcome means the edge address cannot be forged.
      const forgedEdge = await direct('GET', '/api/_diagnostics', { cookies: new Map(), headers: { 'cf-connecting-ip': '203.0.113.9' } })
      const edge = forgedEdge.json?.what_laravel_concluded?.rate_limit_addresses?.edge
      const refused = forgedEdge.status !== 200
      check(
        'A forged CF-Connecting-IP header is refused or replaced by the edge',
        refused || (Boolean(edge) && edge !== '203.0.113.9'),
        refused ? `request refused with HTTP ${forgedEdge.status}` : 'replaced',
      )
    }
  }
}

await request('POST', '/api/auth/logout', { headers: xsrfHeader() })

heading('8. Catalog')
{
  const anonymous = { cookies: new Map() }
  const keyShaped = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/

  const filters = await request('GET', '/api/filters', anonymous)
  const options = filters.json?.data
  check('The filter options are served', filters.status === 200 && options?.platforms?.length > 0 && options?.sorts?.length > 0, `HTTP ${filters.status}, ${options?.platforms?.length ?? 0} platforms`)

  const list = await request('GET', '/api/products?per_page=48', anonymous)
  const products = list.json?.data ?? []
  check('The product list is seeded', list.status === 200 && products.length > 0 && list.json?.meta?.total >= products.length, `HTTP ${list.status}, ${list.json?.meta?.total ?? 0} products`)

  const firstSoldOut = products.findIndex((product) => !product.in_stock)
  check(
    'Sold-out products have no price and come after every available one',
    products.every((product) => (product.in_stock ? product.price?.amount_cents > 0 : product.price === null)) &&
      (firstSoldOut === -1 || products.slice(firstSoldOut).every((product) => !product.in_stock)),
  )

  const cheapestFirst = await request('GET', '/api/products?sort=price_asc&per_page=48', anonymous)
  const prices = (cheapestFirst.json?.data ?? []).filter((product) => product.in_stock).map((product) => product.price.amount_cents)
  check('Sorting by price returns non-decreasing prices', prices.length > 0 && prices.every((price, i) => i === 0 || price >= prices[i - 1]))

  const invalid = await request('GET', '/api/products?platform=no-such-platform&sort=sideways', anonymous)
  check('An unknown filter or sort is rejected, not ignored', invalid.status === 422 && Boolean(invalid.json?.errors), `HTTP ${invalid.status}`)

  const sample = products.find((product) => product.in_stock)
  if (sample) {
    const page = await request('GET', `/api/products/${sample.slug}`, anonymous)
    const detail = page.json?.data
    check('A product page lists its sellers\' offers', page.status === 200 && detail?.offers?.length > 0, `HTTP ${page.status}, ${detail?.offers?.length ?? 0} offers`)
    check(
      'The list price is the first offer on the product page, and that offer is in stock',
      detail?.offers?.[0]?.in_stock === true && detail.offers[0].price.amount_cents === sample.price.amount_cents,
      `list ${sample.price.amount_cents}, page ${detail?.offers?.[0]?.price?.amount_cents}`,
    )
    check('No license key appears in the list or on the product page', !keyShaped.test(list.text) && !keyShaped.test(page.text))

    const cover = await request('GET', sample.cover_image_url, { ...anonymous, headers: { accept: 'image/svg+xml' } })
    check('The cover image is served by the site', cover.status === 200 && String(cover.headers['content-type']).includes('svg'), `HTTP ${cover.status} ${cover.headers['content-type'] ?? ''}`)
  } else {
    check('At least one product is in stock', false)
  }

  const missing = await request('GET', '/api/products/no-such-product', anonymous)
  check('An unknown product is a JSON 404', missing.status === 404 && missing.json?.message === 'Product not found.', `HTTP ${missing.status}`)
}

heading('9. Search')
{
  const anonymous = { cookies: new Map() }
  const suggest = (term) => request('GET', `/api/search/suggestions?${new URLSearchParams({ q: term })}`, anonymous)
  const searchStore = (term, more = '') => request('GET', `/api/products?${new URLSearchParams({ q: term })}${more}`, anonymous)
  const names = (response) => (response.json?.data ?? []).map((product) => product.name)

  const typo = await suggest('eldn ring')
  check('A misspelt search still suggests the right product', typo.status === 200 && names(typo)[0]?.startsWith('Elden Ring'), `HTTP ${typo.status}, first: ${names(typo)[0] ?? 'nothing'}`)

  const store = await searchStore('eldn ring', '&per_page=48')
  check(
    'Suggestions are the first results of the same search the store runs',
    names(typo).length > 0 && JSON.stringify(names(typo)) === JSON.stringify(names(store).slice(0, names(typo).length)),
  )

  const sample = (await request('GET', '/api/products?per_page=1', anonymous)).json?.data?.[0]
  check(
    'A suggestion has the same fields as a product in the list',
    Boolean(sample) && JSON.stringify(Object.keys(typo.json?.data?.[0] ?? {})) === JSON.stringify(Object.keys(sample)),
  )

  const oneTypo = await searchStore('mincraft')
  check('A one-letter slip finds only the intended title', names(oneTypo).length > 0 && names(oneTypo).every((name) => name.startsWith('Minecraft')), names(oneTypo).join(' | ').slice(0, 80))

  const combined = await searchStore('steam', '&region=europe&sort=price_asc&per_page=48')
  const combinedPrices = (combined.json?.data ?? []).filter((product) => product.in_stock).map((product) => product.price.amount_cents)
  check(
    'Search combines with a filter and a sort order',
    combined.status === 200 &&
      names(combined).length > 0 &&
      (combined.json?.data ?? []).every((product) => product.region.slug === 'europe' && /steam/i.test(product.name)) &&
      combinedPrices.every((price, i) => i === 0 || price >= combinedPrices[i - 1]),
    `${names(combined).length} results`,
  )

  const nothing = await searchStore('zzzzqq')
  check('A search with no matches is an empty list, not an error', nothing.status === 200 && nothing.json?.meta?.total === 0, `HTTP ${nothing.status}`)

  const short = await suggest('e')
  const wildcard = await suggest('%%')
  check('One letter, or only wildcard characters, suggests nothing', short.status === 200 && names(short).length === 0 && wildcard.status === 200 && names(wildcard).length === 0)

  // Quotes and SQL comment markers reach the application, which must treat
  // them as plain text.
  const quotes = await searchStore("'; --")
  check('Quotes and SQL comment markers are searched for as text', quotes.status === 200 && quotes.json?.meta?.total === 0, `HTTP ${quotes.status}`)

  // An unmistakable injection attempt. Locally it reaches the application
  // (200, nothing found). In production the API host's firewall refuses it
  // first with its own 403 page, which is not JSON. Either is safe; anything
  // else, or a catalog that changed afterwards, is a failure.
  const hostile = await searchStore("'; DROP TABLE products; --")
  const handledAsText = hostile.status === 200 && hostile.json?.meta?.total === 0
  const stoppedByFirewall = hostile.status === 403 && !hostile.json
  const afterwards = await request('GET', '/api/products?per_page=1', anonymous)
  check(
    'An injection attempt finds nothing and changes nothing',
    (handledAsText || stoppedByFirewall) && afterwards.json?.meta?.total > 0,
    handledAsText ? 'searched for as text, no matches' : stoppedByFirewall ? "refused by the host's firewall before reaching the application" : `HTTP ${hostile.status}`,
  )

  const tooLong = await searchStore('a'.repeat(81))
  check('Overlong search text is rejected', tooLong.status === 422, `HTTP ${tooLong.status}`)
}

heading('10. Cart and checkout')
{
  // Signed in as the account from section 6. Everything here ends with the
  // keys back on sale (a declined payment, a cancelled order), so running it
  // against the live site uses up no stock. The one check that really buys a
  // key runs only with --purchase (the local production check passes it).
  const post = (path, body, headers = {}) => request('POST', path, { body, headers: { ...xsrfHeader(), ...headers } })
  const newKey = () => crypto.randomUUID()
  let purchasedOrderId = null
  let purchasedFingerprint = null

  const signedIn = await post('/api/auth/login', { email, password })
  check('Signed in again as the test buyer', signedIn.status === 200, `HTTP ${signedIn.status}`)
  const looksLikeAKey = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/

  const offersInStock = async (slug) => (await request('GET', `/api/products/${slug}`)).json?.data?.offers?.filter((candidate) => candidate.in_stock) ?? []
  const candidates = ((await request('GET', '/api/products?per_page=48')).json?.data ?? []).filter((candidate) => candidate.in_stock)
  let product = candidates[0]
  let offer = product ? (await offersInStock(product.slug))[0] : undefined

  if (flags.includes('--purchase')) {
    // For the purchase, prefer an offer with fewer keys than one order may
    // hold: only then can "exactly one key fewer afterwards" be seen from
    // outside. The first few products are tried until one has such an offer.
    for (const candidate of candidates.slice(0, 8)) {
      const offers = await offersInStock(candidate.slug)
      const stock = await post('/api/cart/quote', { items: offers.map((entry) => ({ offer_id: entry.id, quantity: 1000 })) })
      const visible = stock.json?.data?.lines?.find((entry) => entry.max_quantity > 1 && entry.max_quantity < 10)
      if (visible) {
        product = candidate
        offer = offers.find((entry) => entry.id === visible.offer_id)
        break
      }
    }
  }

  check('There is an offer in stock to test with', Boolean(offer), product?.name ?? 'no product in stock')

  if (offer) {
    const item = { offer_id: offer.id, quantity: 1, unit_price_cents: offer.price.amount_cents }
    const dearer = { ...item, unit_price_cents: item.unit_price_cents + 1 }

    const quote = await post('/api/cart/quote', { items: [{ offer_id: offer.id, quantity: 1 }] })
    const line = quote.json?.data?.lines?.[0]
    check(
      'The server prices the cart: name, seller and total come from its own data',
      quote.status === 200 && quote.json.data.ok && line.product.name === product.name && line.seller.name === offer.seller.name && quote.json.data.totals.total_cents === offer.price.amount_cents,
      `HTTP ${quote.status}`,
    )

    const stale = await post('/api/cart/quote', { items: [dearer] })
    check('A price other than the one the buyer was shown is flagged', stale.json?.data?.ok === false && stale.json.data.lines[0].issues.includes('price_changed'))

    const guest = await request('POST', '/api/orders', { body: { items: [item] }, cookies: new Map(), asFrontend: false, headers: { 'idempotency-key': newKey() } })
    check('A signed-out caller cannot place an order', guest.status === 401, `HTTP ${guest.status}`)

    const noKey = await post('/api/orders', { items: [item] })
    check('An order without an Idempotency-Key is refused', noKey.status === 422, `HTTP ${noKey.status}`)

    const wrongPrice = await post('/api/orders', { items: [dearer] }, { 'idempotency-key': newKey() })
    check('An order at a price that has changed is refused, with the new quote', wrongPrice.status === 409 && wrongPrice.json?.code === 'cart_changed' && wrongPrice.json.quote.lines[0].unit_price.amount_cents === offer.price.amount_cents, `HTTP ${wrongPrice.status}`)

    // The same request three times at the same moment.
    const key = newKey()
    const copies = await Promise.all([1, 2, 3].map(() => post('/api/orders', { items: [item] }, { 'idempotency-key': key })))
    const order = copies[0].json?.data
    check(
      'The same order request sent three times at once creates one order',
      copies.every((copy) => copy.status === 200 || copy.status === 201) && new Set(copies.map((copy) => copy.json?.data?.id)).size === 1 && copies.filter((copy) => copy.status === 201).length === 1,
      copies.map((copy) => copy.status).join(', '),
    )
    check('The order is pending, with a deadline and ways to pay', order?.status === 'pending' && order.expires_in_seconds > 0 && order.payment_methods.length > 0)
    check('No license key is shown before payment', Boolean(order) && order.items.every((entry) => entry.keys.length === 0) && !looksLikeAKey.test(copies[0].text))

    const reused = await post('/api/orders', { items: [{ ...item, quantity: 2 }] }, { 'idempotency-key': key })
    check('The same key with a different cart is refused', reused.status === 422 && reused.json?.code === 'idempotency_key_reused', `HTTP ${reused.status}`)

    const outsider = await request('GET', `/api/orders/${order?.id}`, { cookies: new Map(), asFrontend: false })
    check('The order cannot be read without being signed in as its buyer', outsider.status === 401, `HTTP ${outsider.status}`)

    const unknown = await request('GET', `/api/orders/${newKey()}`)
    check('An order id that does not exist is "not found"', unknown.status === 404, `HTTP ${unknown.status}`)

    const badMethod = await post(`/api/orders/${order?.id}/pay`, { payment_method: '4111111111111111' })
    check('Only the listed test payment methods are accepted', badMethod.status === 422, `HTTP ${badMethod.status}`)

    // A declined payment, pressed three times at once.
    const declines = await Promise.all([1, 2, 3].map(() => post(`/api/orders/${order?.id}/pay`, { payment_method: 'test_card_declined' })))
    check(
      'A declined payment answers 402 every time, with the order failed and no key',
      declines.every((reply) => reply.status === 402 && reply.json?.data?.status === 'failed' && reply.json.data.payment.status === 'failed' && !looksLikeAKey.test(reply.text)),
      declines.map((reply) => reply.status).join(', '),
    )

    const retry = await post(`/api/orders/${order?.id}/pay`, { payment_method: 'test_card_approved' })
    check('A declined order cannot be paid again', retry.status === 402 && retry.json?.data?.status === 'failed', `HTTP ${retry.status}`)

    const second = await post('/api/orders', { items: [item] }, { 'idempotency-key': newKey() })
    check('The keys of a declined order are back on sale at once', second.status === 201, `HTTP ${second.status}`)

    const cancelled = await post(`/api/orders/${second.json?.data?.id}/cancel`)
    const latePayment = await post(`/api/orders/${second.json?.data?.id}/pay`, { payment_method: 'test_card_approved' })
    check('A cancelled order is cancelled and can no longer be paid for', cancelled.json?.data?.status === 'cancelled' && latePayment.status === 409 && latePayment.json?.data?.status === 'cancelled', `HTTP ${cancelled.status}, then ${latePayment.status}`)

    const stillThere = await post('/api/cart/quote', { items: [item] })
    check('After a declined and a cancelled order the offer is still in stock', stillThere.json?.data?.ok === true)

    if (flags.includes('--purchase')) {
      // One real purchase with a simulated payment. A license key is never
      // printed: keys are compared by fingerprint (SHA-256) and described
      // only by how many there are and whether they have the right shape.
      const fingerprint = (reply) => createHash('sha256').update(JSON.stringify(reply.json?.data?.items?.map((entry) => entry.keys))).digest('hex')
      const stockBefore = (await post('/api/cart/quote', { items: [{ ...item, quantity: 1000 }] })).json?.data?.lines?.[0]?.max_quantity

      const bought = await post('/api/orders', { items: [item] }, { 'idempotency-key': newKey() })
      const boughtId = bought.json?.data?.id
      const payments = await Promise.all([1, 2, 3].map(() => post(`/api/orders/${boughtId}/pay`, { payment_method: 'test_card_approved' })))
      const paid = payments[0].json?.data
      const keys = paid?.items?.[0]?.keys ?? []
      check(
        'An approved payment, pressed three times at once, delivers one key once',
        payments.every((reply) => reply.status === 200 && reply.json?.data?.status === 'paid') && new Set(payments.map(fingerprint)).size === 1 && keys.length === 1 && looksLikeAKey.test(keys[0]),
        `${payments.map((reply) => reply.status).join(', ')}; ${keys.length} key delivered`,
      )

      check(
        'The order and its payment agree: paid, charged once in full, nothing left pending',
        paid?.status === 'paid' &&
          Boolean(paid.paid_at) &&
          paid.expires_at === null &&
          paid.failure_reason === null &&
          paid.payment.status === 'succeeded' &&
          Boolean(paid.payment.method) &&
          paid.payment_methods.length === 0 &&
          paid.totals.total_cents === offer.price.amount_cents &&
          paid.totals.total_cents === paid.items.reduce((sum, entry) => sum + entry.line_total_cents, 0) &&
          paid.items.every((entry) => entry.keys.length === entry.quantity),
        `order ${paid?.status}, payment ${paid?.payment?.status}, ${paid?.totals?.total_cents} cents`,
      )

      // What a page refresh does: read the order again, twice.
      const refreshes = [await request('GET', `/api/orders/${boughtId}`), await request('GET', `/api/orders/${boughtId}`)]
      check('The same key is still there after refreshing the order page', refreshes.every((reply) => reply.status === 200 && reply.json?.data?.status === 'paid' && fingerprint(reply) === fingerprint(payments[0])))

      const repay = await post(`/api/orders/${boughtId}/pay`, { payment_method: 'test_card_declined' })
      const cancelPaid = await post(`/api/orders/${boughtId}/cancel`)
      check('Paying or cancelling again changes nothing', repay.status === 200 && fingerprint(repay) === fingerprint(payments[0]) && cancelPaid.json?.data?.status === 'paid', `HTTP ${repay.status}, ${cancelPaid.status}`)

      // The sold key has left the stock for good.
      const afterwards = (await post('/api/cart/quote', { items: [{ ...item, quantity: 1000 }] })).json?.data?.lines?.[0]
      const left = afterwards?.max_quantity
      if (stockBefore < 10) {
        check('The offer has exactly one key fewer to sell', left === stockBefore - 1, `${stockBefore} before, ${left} after`)
      } else {
        console.log('  (this offer has more keys than one order may hold, so its stock count is not visible from outside)')
      }
      if (left > 0) {
        // Hold every key that is left: the delivered one must not be among them.
        const rest = await post('/api/orders', { items: [{ ...item, quantity: left }] }, { 'idempotency-key': newKey() })
        const tooMany = await post('/api/cart/quote', { items: [{ ...item, quantity: left + 1 }] })
        check(
          'Every remaining key can be held, and not one more: the sold key cannot be sold again',
          rest.status === 201 && rest.json?.data?.items?.[0]?.quantity === left && (left >= 10 || tooMany.json?.data?.lines?.[0]?.quantity === left),
          `HTTP ${rest.status}, ${left} held`,
        )
        await post(`/api/orders/${rest.json?.data?.id}/cancel`)
      } else {
        check('It was the last key: the offer is now sold out', afterwards?.issues?.includes('unavailable') === true)
      }

      const withoutSession = await request('GET', `/api/orders/${boughtId}`, { cookies: new Map(), asFrontend: false })
      check('A signed-out caller cannot read the paid order or its key', withoutSession.status === 401 && !looksLikeAKey.test(withoutSession.text), `HTTP ${withoutSession.status}`)

      const catalog = await Promise.all([request('GET', `/api/products/${product.slug}`), request('GET', '/api/products?per_page=48'), post('/api/cart/quote', { items: [item] })])
      check('No catalog or cart response contains the delivered key', catalog.every((reply) => !reply.text.includes(keys[0] ?? 'no key')))

      purchasedOrderId = boughtId
      purchasedFingerprint = fingerprint(payments[0])
    } else {
      console.log('  (a real purchase uses up a seeded key; that check runs only with --purchase)')
    }

    const history = await request('GET', '/api/orders')
    check(
      'The order history lists this buyer\'s orders and never a key',
      history.status === 200 && history.json?.data?.some((entry) => entry.id === order?.id) && !history.text.includes('"keys"') && !looksLikeAKey.test(history.text),
      `${history.json?.meta?.total} orders`,
    )

    if (purchasedOrderId) {
      const entry = history.json?.data?.find((candidate) => candidate.id === purchasedOrderId)
      check('The purchase is in the buyer\'s order history as paid', entry?.status === 'paid' && entry.payment.status === 'succeeded' && entry.totals.total_cents === offer.price.amount_cents)

      const viaHistory = await request('GET', `/api/orders/${entry?.id}`)
      check('Opening it from the order history shows the same key', viaHistory.status === 200 && createHash('sha256').update(JSON.stringify(viaHistory.json?.data?.items?.map((line) => line.keys))).digest('hex') === purchasedFingerprint)
    }
  }

  await post('/api/auth/logout')

  if (purchasedOrderId) {
    // A different signed-in account: the order must not exist for it.
    const stranger = await post('/api/auth/register', { name: 'Deploy Check Two', email: email.replace('@', '-other@'), password: randomBytes(18).toString('base64url') })
    const theirView = await request('GET', `/api/orders/${purchasedOrderId}`)
    const theirList = await request('GET', '/api/orders')
    check(
      'Another signed-in account gets "not found" for the order and has no orders',
      stranger.status === 201 && theirView.status === 404 && !looksLikeAKey.test(theirView.text) && theirList.json?.meta?.total === 0,
      `HTTP ${stranger.status}, ${theirView.status}`,
    )
    await post('/api/auth/logout')
  }
}

// --------------------------------------------------------------- summary ---

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
if (failed.length) {
  console.log('\nFailed:')
  for (const result of failed) console.log(`  - [${result.section}] ${result.name}${result.detail ? `  (${result.detail})` : ''}`)
  process.exit(1)
}
