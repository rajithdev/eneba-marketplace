import { useRef } from 'react'

/**
 * Wraps a request so that asking again while it is still on its way returns
 * that same request instead of sending another.
 *
 * A button that disables itself after a click only protects from the next
 * screen update onwards. Two clicks in the same instant both get through.
 * This takes effect immediately, so "Pay" pressed twice sends one payment.
 * (The server would charge once either way; this avoids the wasted request.)
 */
export function useSingleFlight<T>(request: () => Promise<T>): () => Promise<T> {
  const running = useRef<Promise<T> | null>(null)

  return () => {
    running.current ??= request().finally(() => {
      running.current = null
    })

    return running.current
  }
}
