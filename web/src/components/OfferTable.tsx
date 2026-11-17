import { Link } from 'react-router'
import type { Offer } from '../lib/catalog'
import { PriceTag } from './PriceTag'

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
    return <p className="bg-card p-6 text-muted">No seller is offering this product at the moment.</p>
  }

  const bestOfferId = offers.find((offer) => offer.in_stock)?.id

  return (
    <table className="w-full border-separate border-spacing-y-2 text-left">
      <caption className="sr-only">Offers from sellers, best price first</caption>
      <thead className="text-xs uppercase text-muted">
        <tr>
          <th scope="col" className="w-[46%] px-4 py-1 font-extrabold">
            Seller
          </th>
          <th scope="col" className="px-4 py-1 font-extrabold">
            Price
          </th>
          <th scope="col" className="px-4 py-1 text-right font-extrabold">
            Availability
          </th>
        </tr>
      </thead>
      <tbody>
        {offers.map((offer) => (
          <tr key={offer.id} className={`bg-card ${offer.in_stock ? '' : 'text-muted'}`}>
            <th scope="row" className="px-3 py-3 align-top font-normal sm:px-4">
              <p className="flex flex-wrap items-center gap-2 font-extrabold text-white">
                {offer.seller.name}
                {offer.id === bestOfferId && (
                  <span className="bg-deal px-2 py-0.5 text-[11px] font-extrabold uppercase text-black">Best price</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted">
                {offer.seller.rating_percent.toFixed(1)}% positive ·{' '}
                {new Intl.NumberFormat('en-GB').format(offer.seller.sales_count)} sales
              </p>
            </th>
            <td className="px-2 py-3 align-top sm:px-4">
              <PriceTag price={offer.price} />
            </td>
            <td className="px-3 py-3 text-right align-top text-sm font-extrabold sm:px-4">
              {offer.in_stock ? (
                <>
                  <span className="whitespace-nowrap text-region">In stock</span>
                  {/* The buyer picks this seller: the cart holds the offer, not just the product. */}
                  <button
                    type="button"
                    className="mt-2 block w-full whitespace-nowrap bg-accent px-3 py-2 text-sm font-extrabold text-black hover:bg-accent-strong sm:ml-auto sm:w-auto"
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
                </>
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
