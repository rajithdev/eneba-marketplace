/**
 * The one place the app talks to the backend.
 *
 * Paths are relative ("/api/..."), so requests go to the page's own origin
 * and are forwarded to the API by a proxy, in development and in production.
 */

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(messageFrom(body) ?? `Request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown }
    if (typeof message === 'string') return message
  }
  return undefined
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  // The free-tier API host answers with an HTML page while it wakes up, so a
  // non-JSON body is an expected case, not a crash.
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok || body === null) {
    throw new ApiError(response.status, body)
  }

  return body as T
}
