import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { LineCover, LineTitle, PriceBreakdown } from '../components/OrderLines'
import { PriceTag } from '../components/PriceTag'
import { Notice, pageTitle, pageTop, primaryButton, secondaryButton, sectionTitle } from '../components/States'
import { ApiError, describeFailure } from '../lib/api'
import { useSession } from '../lib/auth'
import { cart, checkoutAttempt, useCart, type CartItem } from '../lib/cart'
import { isCartChanged, orderKey, placeOrder, quoteCart, reconcile, type QuoteLine } from '../lib/checkout'
import { formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useSingleFlight } from '../lib/useSingleFlight'

/**
 * The cart. Which offers and how many is kept in this browser; everything
 * shown about them (names, sellers, prices, what is in stock, the totals)
 * is asked from the server each time the cart changes.
 *
 * When the server reports that something is no longer as the buyer saw it
 * (a new price, fewer keys, an offer gone), the page says exactly what and
 * the buyer has to accept the updated cart before they can check out.
 */
export function CartPage() {
  useDocumentTitle('Cart')
  const items = useCart()
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const quote = useQuery({
    queryKey: ['cart-quote', items],
    queryFn: ({ signal }) => quoteCart(items, signal),
    enabled: items.length > 0,
    // Keep showing the previous answer while the new one loads.
    placeholderData: keepPreviousData,
  })

  // Pressed twice in the same instant, this still places one order.
  const startCheckout = useSingleFlight(async () => {
    let order = (await placeOrder(items, checkoutAttempt.keyFor(items))).data

    // The key belonged to an attempt that has already ended without
    // payment (declined, expired, cancelled). This click is a new attempt.
    if (order.status !== 'pending' && order.status !== 'paid') {
      checkoutAttempt.forget()
      order = (await placeOrder(items, checkoutAttempt.keyFor(items))).data
    }

    return order
  })

  const checkout = useMutation({
    mutationFn: startCheckout,
    onSuccess: (order) => {
      checkoutAttempt.startedOrder(order.id)
      queryClient.setQueryData(orderKey(session.state === 'signed-in' ? session.user.id : null, order.id), { data: order })
      navigate(`/orders/${order.id}`)
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      // The cart changed between looking and buying: show what changed.
      if (isCartChanged(error.body)) queryClient.setQueryData(['cart-quote', items], { data: error.body.quote })
      // A 401 (the session ended in the meantime) is handled for every
      // request in one place: see createQueryClient.
    },
  })

  if (items.length === 0) {
    return (
      <div className={pageTop}>
        <h1 className={`mb-6 ${pageTitle}`}>Cart</h1>
        <Notice title="Your cart is empty">
          <p>Pick a seller's offer on any product page to add it here.</p>
          <Link to="/store" className={primaryButton}>
            Browse the store
          </Link>
        </Notice>
      </div>
    )
  }

  const data = quote.data?.data
  const lineFor = (item: CartItem) => data?.lines.find((line) => line.offer_id === item.offerId)
  // Waiting for the quote of the cart as it is now, or for the order to be
  // placed. A refresh of a quote that is already on screen (the browser tab
  // regaining focus triggers one) does not count: it would disable the
  // button at the very moment a returning buyer clicks it.
  const busy = quote.isPlaceholderData || checkout.isPending

  return (
    <div className={pageTop}>
      <h1 className={`mb-6 ${pageTitle}`}>Cart</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {quote.isError && !data && (
            <Notice title="The cart could not be checked" tone="error">
              <p>{quote.error instanceof ApiError && quote.error.status === 422 ? quote.error.message : describeFailure(quote.error)}</p>
              <button type="button" className={primaryButton} onClick={() => quote.refetch()}>
                Try again
              </button>
            </Notice>
          )}

          <ul aria-label="Items in your cart" className="space-y-2">
            {items.map((item) => (
              <CartLine key={item.offerId} item={item} line={lineFor(item)} disabled={checkout.isPending} />
            ))}
          </ul>

          <p className="mt-4 text-sm text-muted">
            Your cart is saved in this browser. Keys are only held for you once you start the checkout.
          </p>
        </div>

        <section aria-label="Order summary" className="self-start bg-panel p-5">
          <h2 className={`mb-4 ${sectionTitle}`}>Summary</h2>

          {data ? (
            <PriceBreakdown totals={data.totals} />
          ) : quote.isError ? (
            <p className="text-sm text-muted">Prices and stock are shown once the cart has been checked.</p>
          ) : (
            <p role="status">Checking prices and stock…</p>
          )}

          {checkout.isError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {checkout.error instanceof ApiError ? checkout.error.message : 'The order could not be placed. Check your connection and try again.'}
            </p>
          )}

          <div className="mt-5">
            {data && !data.ok ? (
              <>
                <p role="status" className="mb-3 text-sm">
                  Something changed since you added these items. Review the notes on the left, then update your cart to continue.
                </p>
                <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={() => cart.replace(reconcile(items, data))}>
                  Update cart
                </button>
              </>
            ) : session.state === 'signed-in' ? (
              <button type="button" className={`${primaryButton} w-full`} disabled={!data || busy} onClick={() => checkout.mutate()}>
                {checkout.isPending ? 'Reserving your keys…' : 'Proceed to checkout'}
              </button>
            ) : session.state === 'checking' ? (
              // Not yet known whether to offer the checkout or the sign-in.
              <p role="status" className="text-sm text-muted">
                Checking that you are signed in…
              </p>
            ) : session.state === 'unknown' ? (
              <>
                <p role="alert" className="mb-3 text-sm text-danger">
                  We could not check that you are signed in. {describeFailure(session.error)}
                </p>
                <button type="button" className={`${secondaryButton} w-full`} onClick={session.retry}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <Link to="/account?next=/cart" className={`${primaryButton} w-full`}>
                  Sign in to check out
                </Link>
                <p className="mt-3 text-sm text-muted">Your cart will still be here after you sign in.</p>
              </>
            )}
          </div>

          <p className="mt-4 text-xs text-muted">Demonstration store: no real payment is taken and no real keys are sold.</p>
        </section>
      </div>
    </div>
  )
}

/** One offer in the cart, as the server describes it right now. */
function CartLine({ item, line, disabled }: { item: CartItem; line: QuoteLine | undefined; disabled: boolean }) {
  const unavailable = line?.issues.includes('unavailable') ?? false
  const name = line?.product?.name ?? item.productName
  const max = line?.max_quantity ?? item.quantity

  return (
    <li className="bg-card p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        <LineCover url={line?.product?.cover_image_url ?? null} dimmed={unavailable} />

        <div className="min-w-0 flex-1">
          {line?.product ? (
            <LineTitle slug={line.product.slug} name={name} platform={line.product.platform.name} region={line.product.region.name} />
          ) : (
            <p className="font-extrabold">{name}</p>
          )}
          <p className="mt-2 text-sm">
            Sold by <span className="font-extrabold">{line?.seller?.name ?? item.sellerName}</span>
            {line?.seller && (
              <span className="text-muted">
                {' '}
                · {line.seller.rating_percent.toFixed(1)}% positive · {new Intl.NumberFormat('en-GB').format(line.seller.sales_count)} sales
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">{line?.unit_price && !unavailable && <PriceTag price={line.unit_price} />}</div>
      </div>

      {line && <LineIssues item={item} line={line} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {unavailable ? (
          <span className="text-sm font-extrabold text-muted">Not available</span>
        ) : (
          <div className="flex items-center" role="group" aria-label={`Quantity of ${name}`}>
            <button
              type="button"
              className="h-9 w-9 border border-line text-lg font-extrabold hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-white"
              aria-label={`Decrease quantity of ${name}`}
              disabled={disabled || item.quantity <= 1}
              onClick={() => cart.setQuantity(item.offerId, item.quantity - 1)}
            >
              −
            </button>
            <span className="flex h-9 min-w-10 items-center justify-center border-y border-line px-2 font-extrabold" aria-live="polite">
              {item.quantity}
            </span>
            <button
              type="button"
              className="h-9 w-9 border border-line text-lg font-extrabold hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-white"
              aria-label={`Increase quantity of ${name}`}
              disabled={disabled || !line || item.quantity >= max}
              onClick={() => cart.setQuantity(item.offerId, item.quantity + 1)}
            >
              +
            </button>
            {line && item.quantity >= max && <span className="ml-3 text-xs text-muted">Maximum available</span>}
          </div>
        )}

        <div className="flex items-center gap-4">
          {line?.unit_price && !unavailable && (
            <span className="text-sm">
              <span className="text-muted">Line total </span>
              <span className="font-extrabold">{formatMoney(line.line_total_cents, line.unit_price.currency)}</span>
            </span>
          )}
          <button type="button" className="py-2 text-sm underline hover:text-accent disabled:opacity-60" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => cart.remove(item.offerId)}>
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

/** What is no longer as the buyer saw it, in words. */
function LineIssues({ item, line }: { item: CartItem; line: QuoteLine }) {
  if (line.issues.length === 0) return null

  const currency = line.unit_price?.currency ?? 'EUR'

  return (
    <ul role="alert" className="mt-3 space-y-1 border-l-4 border-accent bg-page px-3 py-2 text-sm">
      {line.issues.includes('unavailable') && <li>This offer is no longer available. It will be removed when you update your cart.</li>}
      {line.issues.includes('price_changed') && line.unit_price && (
        <li>
          The price changed from {formatMoney(item.unitPriceCents, currency)} to {formatMoney(line.unit_price.amount_cents, currency)}.
        </li>
      )}
      {line.issues.includes('insufficient_stock') && (
        <li>
          Only {line.quantity} left in stock: you asked for {line.requested_quantity}.
        </li>
      )}
      {line.issues.includes('quantity_limited') && <li>One order can hold at most {line.quantity} of this offer.</li>}
    </ul>
  )
}
