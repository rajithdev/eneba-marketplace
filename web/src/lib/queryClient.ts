import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'
import { ApiError, shouldRetry } from './api'
import { endSession } from './auth'

/**
 * The app's store of server answers.
 *
 * One rule lives here because it applies to every request: when the server
 * answers 401 ("you are not signed in") to anything, the session is over,
 * and the previous buyer's cached orders and keys are discarded at once
 * (see endSession). No page has to remember to do that itself.
 */
export function createQueryClient(queries: DefaultOptions['queries'] = {}): QueryClient {
  const whenSignedOut = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) endSession(client)
  }

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: whenSignedOut }),
    mutationCache: new MutationCache({ onError: whenSignedOut }),
    defaultOptions: { queries: { retry: shouldRetry, ...queries } },
  })

  return client
}
