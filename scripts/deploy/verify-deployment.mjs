#!/usr/bin/env node
// End-to-end check of a running deployment, through its public address.
//
//   node scripts/deploy/verify-deployment.mjs https://<project>.vercel.app
//   node scripts/deploy/verify-deployment.mjs http://localhost:4173 --behind-https-proxy
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

import { randomBytes } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

const [baseArg, ...flags] = process.argv.slice(2)
if (!baseArg) {
  console.error('Usage: verify-deployment.mjs <base-url> [--behind-https-proxy]')
  process.exit(2)
}
const base = new URL(baseArg)
const origin = base.origin
// Cookies must be marked Secure whenever visitors use https. Locally the
// stand-in proxy claims https while we talk to it over http.
const expectSecure = base.protocol === 'https:' || flags.includes('--behind-https-proxy')

// ------------------------------------------------------------ http client ---

const jar = new Map() // cookie name -> value

function request(method, path, { body, headers = {}, cookies = jar, asFrontend = true } = {}) {
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
    const client = base.protocol === 'https:' ? https : http
    const req = client.request(new URL(path, base), { method, headers: allHeaders, timeout: 150_000 }, (res) => {
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

heading('1. Frontend')
{
  const home = await request('GET', '/', { headers: { accept: 'text/html' }, cookies: new Map() })
  check('The home page is the React app', home.status === 200 && home.text.includes('id="root"'), `HTTP ${home.status}`)

  const deepLink = await request('GET', '/account', { headers: { accept: 'text/html' }, cookies: new Map() })
  check('A client-side route (/account) also returns the app', deepLink.status === 200 && deepLink.text.includes('id="root"'), `HTTP ${deepLink.status}`)
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
    console.log(`  arrived:   ${JSON.stringify(arrived)}`)
    console.log(`  concluded: ${JSON.stringify(seen)}`)
    check('The request is recognised as coming from the frontend', seen.treated_as_frontend_request === true, `Origin ${arrived.origin}`)
    check('A session was started for it', seen.session_started === true)
    check('The session cookie sent by the client reached the server', (arrived.cookie_names ?? []).includes(sessionCookieName), `cookies seen: ${(arrived.cookie_names ?? []).join(', ') || 'none'}`)
    if (expectSecure) check('The server knows the visitor used HTTPS', seen.is_secure === true, `scheme ${seen.scheme}`)
    check('Debug mode is off', diagnostics.json?.configuration?.debug === false)
  }
}

heading('5. CSRF protection')
{
  const visitor = await request('GET', '/api/auth/me')
  check('A visitor is not signed in', visitor.status === 401, `HTTP ${visitor.status}`)

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
  check('The same cookie sent without the frontend origin is not accepted', noOrigin.status === 401, `HTTP ${noOrigin.status}`)

  const forgedLogout = await request('POST', '/api/auth/logout', { headers: { 'sec-fetch-site': 'cross-site' } })
  const stillSignedIn = await request('GET', '/api/auth/me')
  check('A forged sign-out from another site is rejected and changes nothing', forgedLogout.status === 419 && stillSignedIn.status === 200, `HTTP ${forgedLogout.status}`)

  const stolen = new Map(jar)
  const logout = await request('POST', '/api/auth/logout', { headers: xsrfHeader() })
  check('Sign-out succeeds', logout.status === 204, `HTTP ${logout.status}`)

  const afterLogout = await request('GET', '/api/auth/me')
  check('After sign-out the user is a visitor again', afterLogout.status === 401, `HTTP ${afterLogout.status}`)

  const replay = await request('GET', '/api/auth/me', { cookies: stolen })
  check('The old session cookie no longer works (destroyed on the server)', replay.status === 401, `HTTP ${replay.status}`)

  const wrong = await request('POST', '/api/auth/login', { body: { email, password: `${password}x` }, headers: xsrfHeader() })
  check('A wrong password is rejected', wrong.status === 422, `HTTP ${wrong.status}`)

  const login = await request('POST', '/api/auth/login', { body: { email, password }, headers: xsrfHeader() })
  const meAgain = await request('GET', '/api/auth/me')
  check('Sign-in with the right password works', login.status === 200 && meAgain.status === 200, `HTTP ${login.status}, then ${meAgain.status}`)

  await request('POST', '/api/auth/logout', { headers: xsrfHeader() })
}

// --------------------------------------------------------------- summary ---

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
if (failed.length) {
  console.log('\nFailed:')
  for (const result of failed) console.log(`  - [${result.section}] ${result.name}${result.detail ? `  (${result.detail})` : ''}`)
  process.exit(1)
}
