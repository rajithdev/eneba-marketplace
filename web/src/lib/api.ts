/**
 * The one place the app talks to the backend.
 *
 * Paths are relative ("/api/..."), so requests go to the page's own origin
 * and are forwarded to the API by a proxy, in development and in production.
 * Because it is the same origin, the browser attaches the login cookie by
 * itself; this code never sees or stores it.
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

  /** Per-field messages from a failed validation (HTTP 422). */
  get fieldErrors(): Record<string, string[]> {
    if (typeof this.body === 'object' && this.body !== null && 'errors' in this.body) {
      return (this.body as { errors: Record<string, string[]> }).errors
    }
    return {}
  }
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown }
    if (typeof message === 'string') return message
  }
  return undefined
}

function readCookie(name: string): string | undefined {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined
}

/**
 * CSRF protection. The server sets a readable "XSRF-TOKEN" cookie; echoing
 * its value in a header proves the request was made by a page on our own
 * origin, because pages on other sites cannot read our cookies.
 */
async function csrfToken(forceRefresh = false): Promise<string | undefined> {
  if (forceRefresh || !readCookie('XSRF-TOKEN')) {
    await fetch('/api/sanctum/csrf-cookie', { headers: { Accept: 'application/json' } })
  }
  return readCookie('XSRF-TOKEN')
}

const READ_ONLY_METHODS = ['GET', 'HEAD']

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const changesData = !READ_ONLY_METHODS.includes(method)

  const send = async (forceFreshToken: boolean) => {
    const token = changesData ? await csrfToken(forceFreshToken) : undefined

    return fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-XSRF-TOKEN': token } : {}),
        ...init.headers,
      },
    })
  }

  let response = await send(false)
  // 419: the CSRF token expired with the session. Get a new one and retry once.
  if (response.status === 419) response = await send(true)

  if (response.status === 204) return undefined as T

  // The free-tier API host answers with an HTML page while it wakes up, so a
  // non-JSON body is an expected case, not a crash.
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok || body === null) {
    throw new ApiError(response.status, body)
  }

  return body as T
}

/**
 * Whether a failed request is worth trying again. A server that is waking up
 * or briefly unreachable is; an answer that says the request itself is wrong
 * (not found, invalid filters, not signed in) will be the same next time.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const requestIsWrong = error instanceof ApiError && error.status >= 400 && error.status < 500

  return !requestIsWrong && failureCount < 2
}
