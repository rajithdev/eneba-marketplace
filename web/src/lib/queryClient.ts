import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'
import { ApiError, shouldRetry } from './api'
import { endSession } from './auth'

/**
 * How long an answer nobody is looking at is kept. Coming back to a page
 * within this time shows it at once, from the kept answer, instead of its
 * loading placeholders. (The library's own default is five minutes, less
 * than reading one product page and returning can take.)
 */
export const KEEP_UNUSED_MS = 30 * 60_000

/**
 * How long the catalog's lists (the homepage, the store, the Game Archive)
 * count as fresh. Coming back to one within this time does not ask the
 * server again; after it, the kept answer is shown and replaced when the new
 * one arrives. A price or stock level on a card can therefore be up to a
 * minute old. A product page and the cart are not listed: they are asked for
 * every time, and the server prices every order itself.
 */
export const LISTS_FRESH_MS = 60_000
const LISTS = ['homepage', 'products', 'archive']

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
    defaultOptions: { queries: { retry: shouldRetry, gcTime: KEEP_UNUSED_MS, ...queries } },
  })
  for (const list of LISTS) client.setQueryDefaults([list], { staleTime: LISTS_FRESH_MS })

  return client
}
