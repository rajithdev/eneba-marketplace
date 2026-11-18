/*
 * Opening a product page from a picture of the game (a store card, a deals
 * card, a case in the Game Archive) as one continuous movement: the picture
 * that was clicked glides and grows into the product page's cover while the
 * rest of the page fades from the old to the new.
 *
 * It uses the browser's View Transitions: the browser takes a picture of the
 * page before and after, and animates between the two. The clicked picture
 * is named "spot-cover" for that moment, and the product page's cover always
 * carries the same name, so the browser knows they are one thing
 * (spotlight.css says how it moves).
 *
 * The product page must have something to land on: its data and its cover.
 * Both are asked for when a pointer comes near the link or presses it, and
 * the click waits for them briefly (at most MAX_WAIT_MS). If they take
 * longer, the page opens anyway and simply fades in.
 *
 * Without View Transitions (older browsers, the test environment), or for a
 * visitor who prefers reduced motion, links behave exactly as before.
 * Nothing here changes what is shown or bought; it only changes how the page
 * arrives.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { fetchProduct, type ProductSummary } from '../lib/catalog'
import { coverArt } from '../lib/coverArt'

/** The name the clicked picture and the product page's cover share during the movement. */
export const COVER_NAME = 'spot-cover'

/** How long a click waits for the product page's data and cover before opening it anyway. */
const MAX_WAIT_MS = 400

type Target = Pick<ProductSummary, 'slug' | 'cover_image_url'>

/** Whether the movement can be shown here and now. */
export function canMorph(): boolean {
  return (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Asks for the product page's data (kept for 30 seconds) and its cover picture. */
function prepare(queryClient: QueryClient, product: Target): Promise<unknown> {
  const data = queryClient.ensureQueryData({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug), staleTime: 30_000 })
  const source = coverArt(product.cover_image_url)
  let picture: Promise<unknown> = Promise.resolve()
  if (source) {
    const image = new Image()
    image.src = source
    // A picture that fails to load is the product page's problem, not the click's.
    picture = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve()
  }

  return Promise.all([data.catch(() => {}), picture])
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Opens a product page with the movement. `from` is the clicked element:
 * its picture is the one marked `data-cover` inside it (or itself).
 */
export function useOpenProduct() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return async (product: Target, from: Element | null) => {
    const to = `/product/${product.slug}`
    if (!canMorph()) return navigate(to)

    // Getting ready may fail in any way; the page is opened all the same.
    await Promise.race([Promise.resolve().then(() => prepare(queryClient, product)).catch(() => {}), pause(MAX_WAIT_MS)])

    // Only one element may carry the name. On a product page its own cover
    // already does (opening one from the search box there): then the two
    // covers are the pair, and nothing else is named.
    const picture = from?.closest('[data-cover]') ?? from?.querySelector<HTMLElement>('[data-cover]')
    const alreadyNamed = document.querySelector('[data-cover-target]') !== null
    if (picture instanceof HTMLElement && !alreadyNamed) picture.style.setProperty('view-transition-name', COVER_NAME)

    try {
      await navigate(to, { viewTransition: true, state: { morph: true } })
    } finally {
      // The old page is usually gone by now; if it is not (the address did not change), it is put back as it was.
      if (picture instanceof HTMLElement) setTimeout(() => picture.style.removeProperty('view-transition-name'), 1000)
    }
  }
}

/**
 * What a link to a product page needs for the movement: spread onto the
 * <Link>. A plain click is taken over; a click that opens a new tab or
 * window (a modifier key, the middle button) is left to the browser, and so
 * is everything when the movement cannot be shown. `pictureOf` finds the
 * picture to move when it is not inside the link itself.
 */
export function useProductLink(product: Target, pictureOf?: () => Element | null) {
  const open = useOpenProduct()
  const queryClient = useQueryClient()
  const warm = () => void Promise.resolve().then(() => prepare(queryClient, product)).catch(() => {})

  return {
    onPointerEnter: warm,
    onPointerDown: warm,
    onFocus: warm,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !canMorph()) return
      event.preventDefault()
      void open(product, pictureOf?.() ?? event.currentTarget)
    },
  }
}
