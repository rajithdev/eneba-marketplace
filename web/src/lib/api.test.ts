import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api'

function respondWith(body: string, init: ResponseInit) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init))
}

describe('apiFetch', () => {
  it('requests JSON from the /api prefix and returns the parsed body', async () => {
    const fetchSpy = respondWith('{"status":"ok"}', { status: 200 })

    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
  })

  it('throws an ApiError carrying the status and the server message', async () => {
    respondWith('{"message":"Not found."}', { status: 404 })

    const error = await apiFetch('/missing').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: 'Not found.' })
  })

  it('treats a non-JSON response (the host waking up) as an error, not a crash', async () => {
    respondWith('<html>Service waking up</html>', { status: 200 })

    await expect(apiFetch('/health')).rejects.toBeInstanceOf(ApiError)
  })
})
