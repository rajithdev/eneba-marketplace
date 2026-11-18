import { describe, expect, it } from 'vitest'
import { createQueryClient, KEEP_UNUSED_MS, LISTS_FRESH_MS } from './queryClient'

describe("the app's store of server answers", () => {
  const client = createQueryClient()

  it('keeps an answer nobody is looking at for half an hour', () => {
    expect(KEEP_UNUSED_MS).toBe(30 * 60_000)
    expect(client.getDefaultOptions().queries?.gcTime).toBe(KEEP_UNUSED_MS)
  })

  it("does not ask again for the catalog's lists within a minute", () => {
    expect(client.getQueryDefaults(['homepage']).staleTime).toBe(LISTS_FRESH_MS)
    expect(client.getQueryDefaults(['products', 'type=game']).staleTime).toBe(LISTS_FRESH_MS)
    expect(client.getQueryDefaults(['archive', 'sort=price']).staleTime).toBe(LISTS_FRESH_MS)
  })

  it('asks every time for a product, the cart, orders and who is signed in', () => {
    for (const key of [['product', 'elden-ring'], ['cart-quote', []], ['orders', 1], ['auth', 'me']]) {
      expect(client.getQueryDefaults(key).staleTime).toBeUndefined()
    }
  })
})
