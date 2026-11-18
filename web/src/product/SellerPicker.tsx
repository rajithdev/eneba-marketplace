import type { Offer } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { Icon } from '../components/Icon'
import { badge } from '../components/States'
import { lowestCents } from './choices'

interface Props {
  offers: Offer[]
  /** The offer the buy panel shows. */
  chosenId: number | null
  onChoose: (offer: Offer) => void
  /** How many of each offer (by id) the cart already holds. */
  inCart: Record<number, number>
  /** While another version loads: nothing can be picked. */
  busy: boolean
}

/**
 * Every seller's offer for this version, side by side, as one group of
 * radio buttons: choosing a seller makes theirs the offer in the buy panel,
 * whose button puts it in the cart. Arrow keys move between sellers, as in
 * any radio group.
 *
 * The order is the API's (those that can be bought first, cheapest first)
 * and every figure is the API's: price, "was" price, discount, the seller's
 * rating and sales. Stock is only "in stock" or "sold out", because that is
 * all the API says; a sold-out offer is shown, with its price, but cannot be
 * chosen.
 */
export function SellerPicker({ offers, chosenId, onChoose, inCart, busy }: Props) {
  if (offers.length === 0) {
    return <p className="rounded-card border border-edge/25 bg-card-mid/70 p-6 text-muted">No seller is offering this version at the moment.</p>
  }

  const lowest = lowestCents(offers)

  return (
    <fieldset disabled={busy} aria-busy={busy} className="min-w-0">
      <legend className="sr-only">Choose a seller</legend>

      {/* Column names for sighted visitors; each option's own label already says all of this. */}
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_8rem_7rem_7.5rem] gap-4 px-5 pb-2 text-xs font-bold uppercase tracking-wide text-muted md:grid">
        <span className="pl-9">Seller</span>
        <span>Stock</span>
        <span className="text-right">Price</span>
        <span />
      </div>

      <div className="grid gap-2">
        {offers.map((offer) => {
          const chosen = offer.id === chosenId
          const isLowest = offer.in_stock && offer.price.amount_cents === lowest

          return (
            <div key={offer.id} className="spot-reveal">
              <label
                className={`group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-card border px-4 py-3.5 transition-[border-color,background-color,box-shadow] md:grid-cols-[auto_minmax(0,1fr)_8rem_7rem_7.5rem] md:px-5 ${
                  !offer.in_stock
                    ? 'cursor-not-allowed border-edge/15 bg-card-mid/40 text-muted'
                    : chosen
                      ? 'border-edge-lit/80 bg-[linear-gradient(90deg,rgb(106_51_224/0.28),rgb(21_8_53/0.7))] shadow-[0_0_0_1px_rgb(220_196_255/0.25),0_12px_30px_-18px_rgb(150_90_255/0.8)]'
                      : 'border-edge/25 bg-card-mid/70 hover:border-edge/60 hover:bg-card-top/80'
                }`}
              >
                <input
                  type="radio"
                  name="seller"
                  value={offer.id}
                  checked={chosen}
                  disabled={!offer.in_stock}
                  onChange={() => onChoose(offer)}
                  className="peer sr-only"
                />
                {/* The drawn radio button; the real one above is hidden but keeps the keyboard and the focus ring. */}
                <span
                  aria-hidden="true"
                  className={`row-span-2 flex size-5 items-center justify-center rounded-full border-2 md:row-span-1 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                    chosen ? 'border-accent' : offer.in_stock ? 'border-edge/70 group-hover:border-edge-lit' : 'border-edge/25'
                  }`}
                >
                  {chosen && <span className="size-2.5 rounded-full bg-accent" />}
                </span>

                <span className="min-w-0">
                  <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-bold ${offer.in_stock ? 'text-white' : ''}`}>
                    <span className="truncate">{offer.seller.name}</span>
                    {isLowest && <span className={`${badge} bg-accent/15 text-accent ring-1 ring-accent/40`}>Lowest price</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    <Icon name="star" className="size-3.5 text-accent/80" />
                    {offer.seller.rating_percent.toFixed(1)}% positive · {new Intl.NumberFormat('en-GB').format(offer.seller.sales_count)} sales
                  </span>
                </span>

                {/* Stock: under the name on a phone, its own column on wider screens. */}
                <span className="col-start-2 row-start-2 text-xs font-bold md:col-start-auto md:row-start-auto md:text-sm">
                  {offer.in_stock ? (
                    <span className="inline-flex items-center gap-1 text-region">
                      <Icon name="check" className="size-4" />
                      In stock
                    </span>
                  ) : (
                    <span>Sold out</span>
                  )}
                  {inCart[offer.id] > 0 && <span className="ml-2 font-normal text-muted md:ml-0 md:block md:text-xs">{inCart[offer.id]} in cart</span>}
                </span>

                <span className="col-start-3 row-span-2 row-start-1 text-right md:col-start-auto md:row-span-1 md:row-start-auto">
                  {offer.price.original_amount_cents !== null && (
                    <span className="block text-xs font-bold text-muted">
                      <s>
                        <span className="sr-only">Was </span>
                        {formatMoney(offer.price.original_amount_cents, offer.price.currency)}
                      </s>{' '}
                      <span className="text-deal">
                        <span className="sr-only">, saving </span>-{offer.price.discount_percent}%
                      </span>
                    </span>
                  )}
                  <span className={`block text-lg font-black leading-tight md:text-xl ${offer.in_stock ? 'text-white' : ''}`}>
                    {formatMoney(offer.price.amount_cents, offer.price.currency)}
                  </span>
                </span>

                <span aria-hidden="true" className="hidden text-right text-sm font-bold md:block">
                  {chosen ? <span className="text-accent">Selected</span> : offer.in_stock ? <span className="text-muted group-hover:text-white">Select</span> : null}
                </span>
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
