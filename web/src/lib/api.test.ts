import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, describeFailure } from './api'

function respondWith(body: string | null, init: ResponseInit) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, init))
}

function clearCookies() {
  for (const cookie of document.cookie.split('; ')) {
    document.cookie = `${cookie.split('=')[0]}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
}

beforeEach(clearCookies)

describe('apiFetch', () => {
  it('requests JSON from the /api prefix and returns the parsed body', async () => {
    const fetchSpy = respondWith('{"status":"ok"}', { status: 200 })

    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
  })

  it('throws an ApiError carrying the status, the message and field errors', async () => {
    respondWith('{"message":"Invalid.","errors":{"email":["Taken."]}}', { status: 422 })

    const error = await apiFetch('/missing').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, message: 'Invalid.', fieldErrors: { email: ['Taken.'] } })
  })

  it('treats a non-JSON response (the host waking up) as an error, not a crash', async () => {
    respondWith('<html>Service waking up</html>', { status: 200 })

    await expect(apiFetch('/health')).rejects.toBeInstanceOf(ApiError)
  })

  it('returns nothing for an empty 204 response', async () => {
    document.cookie = 'XSRF-TOKEN=abc'
    respondWith(null, { status: 204 })

    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })
})

describe('CSRF token', () => {
  it('is not sent on read-only requests', async () => {
    document.cookie = 'XSRF-TOKEN=abc'
    const fetchSpy = respondWith('{}', { status: 200 })

    await apiFetch('/auth/me')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1]?.headers).not.toHaveProperty('X-XSRF-TOKEN')
  })

  it('echoes the URL-decoded cookie value in a header on requests that change data', async () => {
    document.cookie = 'XSRF-TOKEN=abc%3D%3D'
    const fetchSpy = respondWith('{}', { status: 200 })

    await apiFetch('/auth/login', { method: 'POST', body: '{}' })

    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      'X-XSRF-TOKEN': 'abc==',
      'Content-Type': 'application/json',
    })
  })

  it('asks the server for the cookie first when the browser does not have one yet', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/sanctum/csrf-cookie') document.cookie = 'XSRF-TOKEN=fresh'
      return new Response('{}', { status: 200 })
    })

    await apiFetch('/auth/login', { method: 'POST', body: '{}' })

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/api/sanctum/csrf-cookie', '/api/auth/login'])
    expect(fetchSpy.mock.calls[1][1]?.headers).toMatchObject({ 'X-XSRF-TOKEN': 'fresh' })
  })

  it('refreshes an expired token and retries once', async () => {
    document.cookie = 'XSRF-TOKEN=stale'
    let logins = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/sanctum/csrf-cookie') {
        document.cookie = 'XSRF-TOKEN=fresh'
        return new Response(null, { status: 204 })
      }
      logins += 1
      return new Response('{}', { status: logins === 1 ? 419 : 200 })
    })

    await apiFetch('/auth/login', { method: 'POST', body: '{}' })

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/login',
      '/api/sanctum/csrf-cookie',
      '/api/auth/login',
    ])
    expect(fetchSpy.mock.calls[2][1]?.headers).toMatchObject({ 'X-XSRF-TOKEN': 'fresh' })
  })
})

describe('describing a failure to a visitor', () => {
  const wakingUp = /did not answer.*sleeps when idle.*up to a minute/
  const serverError = 'The server reported an error. Please try again in a moment.'

  it('says the server may be waking up only when the server itself never answered', () => {
    // No response at all: the browser's own network error.
    expect(describeFailure(new TypeError('Failed to fetch'))).toMatch(wakingUp)
    // The hosting platform's page in place of the API's answer.
    expect(describeFailure(new ApiError(502, null))).toMatch(wakingUp)
    expect(describeFailure(new ApiError(503, { message: 'Service Unavailable' }))).toMatch(wakingUp)
    expect(describeFailure(new ApiError(504, null))).toMatch(wakingUp)
    // A 200 whose body is not JSON: an HTML page from something in between.
    expect(describeFailure(new ApiError(200, null))).toMatch(wakingUp)
  })

  it('reports a failure the server answered with as a server error, not as waking up', () => {
    expect(describeFailure(new ApiError(500, { message: 'Server Error' }))).toBe(serverError)
    expect(describeFailure(new ApiError(500, { message: 'Server Error' }))).not.toMatch(/sleep|minute/)
  })

  it('says so when requests are arriving too fast', () => {
    expect(describeFailure(new ApiError(429, { message: 'Too Many Attempts.' }))).toMatch(/Too many requests/)
  })
})
