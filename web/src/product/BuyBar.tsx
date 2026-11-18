import { useEffect, useState, type RefObject } from 'react'
import { Spinner } from '../components/States'
import { Icon } from '../components/Icon'
import type { Offer } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { addButton } from './PurchasePanel'

/**
 * Whether the phone's buy bar should show: once the buy panel's "Add to
 * cart" has been scrolled up out of the window, and until the footer comes up (so the bar
 * never sits over it). Without IntersectionObserver the bar never shows; the
 * panel is always there.
 */
function useBarWanted(action: RefObject<HTMLElement | null>, end: RefObject<HTMLElement | null>, buyable: boolean) {
  const [actionAbove, setActionAbove] = useState(false)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    // The button exists only while something can be bought: watched again when that changes.
    if (!buyable || typeof IntersectionObserver !== 'function' || !action.current || !end.current) return
    const watchAction = new IntersectionObserver(([entry]) => setActionAbove(!entry.isIntersecting && entry.boundingClientRect.top < 0))
    // The end of the content counts as reached once it is 160px above the
    // foot of the window: the page's bottom padding (96px, which keeps the
    // content clear of the bar) and the main area's (64px) lie between it
    // and the footer, which is therefore just coming into view.
    const watchEnd = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting || entry.boundingClientRect.top < 0), { rootMargin: '0px 0px -160px 0px' })
    watchAction.observe(action.current)
    watchEnd.observe(end.current)

    return () => {
      watchAction.disconnect()
      watchEnd.disconnect()
    }
  }, [action, end, buyable])

  return actionAbove && !atEnd
}

/**
 * On a phone, the buy panel scrolls away under the title. This slim bar then
 * keeps the chosen offer's price and "Add to cart" at the foot of the screen,
 * for as long as the seller list and the versions are being read. It is not
 * there on wider screens, where the panel itself stays in view.
 */
export function BuyBar({
  offer,
  onAdd,
  busy,
  action,
  end,
}: {
  offer: Offer | null
  onAdd: (offer: Offer) => void
  busy: boolean
  action: RefObject<HTMLElement | null>
  end: RefObject<HTMLElement | null>
}) {
  const wanted = useBarWanted(action, end, offer !== null)
  if (!offer) return null

  return (
    <div
      // Hidden from everyone while it is out of sight, so it is never tabbed to then.
      inert={!wanted}
      aria-hidden={!wanted}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-edge/35 bg-dusk/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl transition-[translate,opacity] duration-300 lg:hidden ${
        wanted ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0'
      }`}
    >
      <div className="mx-auto flex max-w-xl items-center gap-4">
        <div className="min-w-0">
          <p className="text-xl font-black leading-tight">{formatMoney(offer.price.amount_cents, offer.price.currency)}</p>
          <p className="truncate text-xs text-muted">from {offer.seller.name}</p>
        </div>
        <button type="button" className={`${addButton} ml-auto h-11 max-w-56`} disabled={busy} aria-label={`Add to cart from ${offer.seller.name}`} onClick={() => onAdd(offer)}>
          {busy ? <Spinner /> : <Icon name="cart" className="size-5" />}
          Add to cart
        </button>
      </div>
    </div>
  )
}
