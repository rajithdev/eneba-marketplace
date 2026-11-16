#!/usr/bin/env node
// Checks web/vercel.json: which paths are forwarded to the API, which are
// answered with the React app, and that the two never overlap.
//
//   node scripts/deploy/check-vercel-config.mjs
//   node scripts/deploy/check-vercel-config.mjs --expect-origin=https://<service>.onrender.com
//
// With --expect-origin it also requires the API rule to point at exactly that
// address. Without it, a placeholder destination is reported but allowed.
//
// It applies the rules the way Vercel documents them: files that exist are
// served first, then the rewrites are tried in order and the first match
// wins. It is a model of Vercel, not Vercel; the live site is still checked
// by verify-deployment.mjs after deploying.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = JSON.parse(readFileSync(join(root, 'web', 'vercel.json'), 'utf8'))
const expectOrigin = process.argv.find((arg) => arg.startsWith('--expect-origin='))?.slice('--expect-origin='.length)

/**
 * "/api/:path*" -> a pattern matching /api, /api/x and /api/x/y, capturing
 * the rest. A path ending in a slash does NOT match: that is how Vercel
 * behaves on the live site ("/api/health/" is answered by Vercel's own 404).
 */
function toPattern(source) {
  return new RegExp(`^${source.replace(/\/:[a-zA-Z]+\*/g, '(?:/((?:[^/]+/)*[^/]+))?')}$`)
}

/** Where a request path ends up once no static file matched it. */
function route(path) {
  for (const { source, destination } of config.rewrites) {
    const match = path.match(toPattern(source))
    if (match) return destination.replace(/:[a-zA-Z]+\*/, match[1] ?? '')
  }
  return null
}

let failed = 0
function check(name, passed, detail = '') {
  if (!passed) failed += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const apiRule = config.rewrites.find((rule) => rule.source.startsWith('/api'))
const apiOrigin = new URL(apiRule.destination.replace(/:[a-zA-Z]+\*/, '')).origin
const notConfirmed = apiOrigin.endsWith('.invalid')
console.log(`API requests are forwarded to: ${apiOrigin}${notConfirmed ? '  <- placeholder, no backend confirmed yet' : ''}\n`)

console.log('Everything the browser calls on the API is forwarded, path intact')
for (const path of [
  '/api/health',
  '/api/sanctum/csrf-cookie',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/products/elden-ring-steam-key-global',
  '/api/no-such-route',
]) {
  check(path, route(path) === `${apiOrigin}${path}`, `-> ${route(path)}`)
}

console.log('\nPages of the app are answered with index.html, never sent to the API')
for (const path of ['/', '/account', '/store', '/product/elden-ring', '/orders/123', '/apiary', '/api-docs']) {
  check(path, route(path) === '/index.html', `-> ${route(path)}`)
}

console.log('\nAn API path ending in a slash matches no rule: Vercel answers 404 itself')
// Observed on the live site. It is neither forwarded nor redirected, and it
// is not given the app's page either. The app never requests such URLs.
for (const path of ['/api/health/', '/api/auth/me/', '/api/']) {
  check(path, route(path) === null, `-> ${route(path) ?? "no rule (Vercel's own 404)"}`)
}
check('/account/ (an app page with a slash) still gets the app', route('/account/') === '/index.html')

console.log('\nThe two rules cannot overlap')
const fallback = config.rewrites.find((rule) => rule.destination === '/index.html')
check('The API rule comes before the app fallback', config.rewrites.indexOf(apiRule) < config.rewrites.indexOf(fallback))
check(
  'The fallback pattern itself refuses every /api/ path',
  ['/api/health', '/api/auth/login', '/api/x/y/z'].every((path) => !toPattern(fallback.source).test(path)),
)
check('The API destination is https and keeps the /api prefix', apiRule.destination.startsWith('https://') && apiRule.destination.includes('/api/'))

console.log('\nNothing in the file changes authentication')
// A rewrite forwards the browser's Cookie and other headers and returns the
// API's Set-Cookie headers. The only headers rule allowed is the one that
// switches off proxy caching for /api. Any other header or cookie rule here
// could strip or alter credentials, so its presence is a failure.
const headerRules = config.headers ?? []
check(
  'The only headers rule is the cache opt-out for /api',
  headerRules.length === 1 &&
    headerRules[0].source === apiRule.source &&
    headerRules[0].headers.length === 1 &&
    headerRules[0].headers[0].key === 'x-vercel-enable-rewrite-caching' &&
    headerRules[0].headers[0].value === '0',
)
check('No redirects, route transforms, trailing-slash or clean-URL settings', !config.redirects && !config.routes && config.trailingSlash === undefined && config.cleanUrls === undefined)

if (expectOrigin) {
  console.log('\nThe destination is the confirmed backend')
  check(`API requests go to ${expectOrigin}`, apiOrigin === new URL(expectOrigin).origin, `currently ${apiOrigin}`)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
if (notConfirmed && !expectOrigin) console.log('The backend address is still a placeholder: do not deploy the frontend yet.')
process.exit(failed ? 1 : 0)
