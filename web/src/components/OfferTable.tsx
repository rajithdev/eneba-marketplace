import { Link } from 'react-router'
import type { Offer } from '../lib/catalog'
import { Icon } from './Icon'
import { PriceTag } from './PriceTag'
import { badge, smallPrimaryButton, smallSecondaryButton, surface } from './States'

interface Props {
  offers: Offer[]
  /** How many of each offer (by id) the cart already holds. */
  inCart: Record<number, number>
  onAdd: (offer: Offer) => void
}

/**
 * Every seller's offer for one product, side by side. The order is the
 * API's: offers that can be bought first, cheapest first, so the first row
 * is the best price. Availability and prices are shown exactly as received.
 */
export function OfferTable({ offers, inCart, onAdd }: Props) {
  if (offers.length === 0) {
    return <p className={`${surface} p-6 text-muted`}>No seller is offering this product at the moment.</p>
  }

  const bestOfferId = offers.find((offer) => offer.in_stock)?.id

  return (
    <table className="w-full border-separate border-spacing-y-2 text-left">
      <caption className="sr-only">Offers from sellers, best price first</caption>
      <thead className="text-xs uppercase text-muted">
        <tr>
          <th scope="col" className="px-3 py-1 font-extrabold sm:px-4">
            Seller
          </th>
          <th scope="col" className="px-2 py-1 text-right font-extrabold sm:px-4">
            Price
          </th>
          <th scope="col" className="px-3 py-1 text-right font-extrabold sm:px-4">
            Availability
          </th>
        </tr>
      </thead>
      <tbody>
        {offers.map((offer) => (
          <tr key={offer.id} className={offer.in_stock ? '' : 'text-muted'}>
            <th scope="row" className={`${cell} rounded-l-card border-l px-3 font-normal sm:px-4`}>
              <div className="flex items-center gap-3">
                {/* Stands in for a seller's picture: the first letter of the name. */}
                <span aria-hidden="true" className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-panel text-base font-extrabold text-white sm:flex">
                  {offer.seller.name.charAt(0)}
                </span>
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-extrabold text-white">
                    {offer.seller.name}
                    {offer.id === bestOfferId && (
                      <span className={`${badge} bg-deal text-black`}>Best price</span>
                    )}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                    <Icon name="star" className="size-3.5 text-accent" />
                    <span>
                      {offer.seller.rating_percent.toFixed(1)}% positive ·{' '}
                      {new Intl.NumberFormat('en-GB').format(offer.seller.sales_count)} sales
                    </span>
                  </p>
                </div>
              </div>
            </th>
            <td className={`${cell} w-px px-2 sm:px-4`}>
              <PriceTag price={offer.price} align="right" />
            </td>
            <td className={`${cell} w-px rounded-r-card border-r px-3 text-right text-sm font-extrabold sm:px-4`}>
              {offer.in_stock ? (
                <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
                  <span className="whitespace-nowrap text-xs text-region sm:text-sm">In stock</span>
                  {/* The buyer picks this seller: the cart holds the offer, not just the product. */}
                  <div>
                    <button
                      type="button"
                      // Yellow for the best price, outlined for the rest, so the row to press stands out.
                      className={`${offer.id === bestOfferId ? smallPrimaryButton : smallSecondaryButton} whitespace-nowrap`}
                      aria-label={`Add to cart from ${offer.seller.name}`}
                      onClick={() => onAdd(offer)}
                    >
                      Add to cart
                    </button>
                    {inCart[offer.id] > 0 && (
                      <Link to="/cart" className="mt-1 block whitespace-nowrap text-xs font-normal underline hover:text-accent">
                        {inCart[offer.id]} in cart
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <span className="whitespace-nowrap">Sold out</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A row is one card: every cell carries the card's colour and its top and
// bottom edge, the first and last cells close it at the sides.
// A row is one card: its cells share the card's body and edge, and the first and last round its ends.
const cell = 'border-y border-edge/30 bg-card-mid py-3 align-middle'
