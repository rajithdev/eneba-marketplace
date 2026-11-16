#!/usr/bin/env node
// A local stand-in for the production frontend host (Vercel).
//
// It does the two things web/vercel.json asks Vercel to do:
//   - serve the built React app from web/dist, answering unknown paths with
//     index.html so client-side routes work;
//   - forward /api/* to the API, adding the forwarding headers Vercel's
//     documentation says it adds (x-forwarded-host, x-forwarded-proto,
//     x-forwarded-for) and sending the API's own host name as Host.
//
// It is an imitation, not Vercel. It proves OUR side is right (the API behaves
// correctly behind a proxy); how Vercel itself treats cookies can only be
// proven on the real deployment, with scripts/deploy/verify-deployment.mjs.
//
//   API_ORIGIN=http://localhost:8100 PORT=4173 node scripts/deploy/local-frontend-host.mjs

import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = join(root, 'web', 'dist')
const apiOrigin = new URL(process.env.API_ORIGIN ?? 'http://localhost:8100')
const port = Number(process.env.PORT ?? 4173)
// What the visitor "used". Production visitors use https, and the API must
// behave accordingly (Secure cookies), so that is what we claim by default.
const visitorProto = process.env.VISITOR_PROTO ?? 'https'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function proxyToApi(request, response) {
  const upstream = http.request(
    {
      host: apiOrigin.hostname,
      port: apiOrigin.port,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: apiOrigin.host,
        'x-forwarded-host': request.headers.host,
        'x-forwarded-proto': visitorProto,
        'x-forwarded-for': request.socket.remoteAddress,
      },
    },
    (upstreamResponse) => {
      // Headers are passed back untouched, including each Set-Cookie header.
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    },
  )
  upstream.on('error', () => {
    response.writeHead(502, { 'content-type': 'text/plain' })
    response.end('The API is not reachable.')
  })
  request.pipe(upstream)
}

function serveFile(path, response) {
  response.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(response)
}

http
  .createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost')

    // Observed on the live site: Vercel's "/api/:path*" rule does not match a
    // path ending in a slash, and the app fallback excludes /api/, so Vercel
    // answers such a request with its own 404 and never forwards it.
    if (pathname.startsWith('/api/') && pathname.endsWith('/')) {
      response.writeHead(404, { 'content-type': 'text/plain', 'x-vercel-error': 'NOT_FOUND' })
      return response.end('The page could not be found\n\nNOT_FOUND\n')
    }

    if (pathname.startsWith('/api/')) return proxyToApi(request, response)

    const file = join(dist, normalize(pathname))
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return serveFile(file, response)

    serveFile(join(dist, 'index.html'), response)
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Frontend stand-in on http://localhost:${port}, forwarding /api to ${apiOrigin.origin}`)
  })
