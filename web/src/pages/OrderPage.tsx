import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LineCover, LineTitle, PriceBreakdown } from '../components/OrderLines'
import { SessionNotice } from '../components/SessionNotice'
import { LoadError, Notice, pageTitle, pageTop, primaryButton, raised, secondaryButton, sectionTitle, Spinner, surface } from '../components/States'
import { ApiError } from '../lib/api'
import { useSession } from '../lib/auth'
import { cart, checkoutAttempt } from '../lib/cart'
import { cancelOrder, fetchOrder, hasOrder, orderKey, payOrder, shortId, statusLabels, type Order, type OrderResponse } from '../lib/checkout'
import { formatDateTime, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useSingleFlight } from '../lib/useSingleFlight'

/**
 * One order, in whatever state the server says it is in:
 *
 *   pending    the keys are held; choose a test card and pay before the timer runs out
 *   paid       payment confirmed; the keys are shown
 *   failed     the payment was declined; nothing was charged
 *   expired    not paid in time
 *   cancelled  given up by the buyer
 *
 * The page never decides a state itself. It asks, shows the answer, and
 * after every action shows whatever order the server sent back.
 */
export function OrderPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const userId = session.state === 'signed-in' ? session.user.id : null
  // Asked for, and shown, only for a confirmed signed-in buyer. A 401 from
  // this request ends the session for the whole app (see createQueryClient).
  const order = useQuery({
    queryKey: orderKey(userId, id),
    queryFn: () => fetchOrder(id),
    enabled: userId !== null,
    // While payment is awaited, look again now and then: the order may be
    // paid in another tab, or run out of time.
    refetchInterval: (query) => (query.state.data?.data.status === 'pending' ? 20_000 : false),
  })
  const data = order.data?.data

  useDocumentTitle(data ? titles[data.status] ?? 'Order' : 'Order')

  // When the checkout this browser started is over, tidy up after it: a
  // paid order empties the cart; any ending means the next checkout is new.
  useEffect(() => {
    if (!data || data.status === 'pending' || checkoutAttempt.orderId() !== data.id) return
    if (data.status === 'paid') cart.clear()
    checkoutAttempt.forget()
  }, [data])

  if (session.state !== 'signed-in') {
    return (
      <div className={pageTop}>
        <SessionNotice session={session} what="this order" next={`/orders/${id}`} heading="h1" />
      </div>
    )
  }

  if (order.isPending) return <p role="status" className={pageTop}>Loading your order…</p>

  if (order.error instanceof ApiError && order.error.status === 404) {
    return (
      <div className={pageTop}>
        <Notice title="Order not found" heading="h1">
          <p>This order does not exist, or belongs to another account.</p>
          <Link to="/account/orders" className={primaryButton}>
            Your orders
          </Link>
        </Notice>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={pageTop}>
        <LoadError title="The order could not be loaded" error={order.error} retry={() => order.refetch()} heading="h1" />
      </div>
    )
  }

  return (
    <div className={pageTop}>
      <p className="text-sm text-muted">
        <Link to="/account/orders" className="underline hover:text-accent">
          Your orders
        </Link>{' '}
        / Order {shortId(data.id)}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {data.status === 'pending' ? <Payment order={data} userId={session.user.id} receivedAt={order.dataUpdatedAt} onExpired={order.refetch} /> : <Outcome order={data} />}
          <Items order={data} />
        </div>

        <section aria-label="Order summary" className={`self-start p-5 lg:sticky lg:top-4 ${raised}`}>
          <h2 className={`mb-4 ${sectionTitle}`}>Summary</h2>
          <PriceBreakdown totals={data.totals} totalLabel={data.status === 'paid' ? 'Paid' : 'Total'} />
          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            <Row term="Order" value={shortId(data.id)} />
            <Row term="Placed" value={formatDateTime(data.created_at)} />
            {data.paid_at && <Row term="Paid" value={formatDateTime(data.paid_at)} />}
            {data.payment.method && <Row term="Payment" value={data.payment.method} />}
            <Row term="Status" value={statusLabels[data.status] ?? data.status} />
          </dl>
        </section>
      </div>
    </div>
  )
}

const titles: Record<string, string> = {
  pending: 'Checkout',
  paid: 'Order confirmed',
  failed: 'Payment declined',
  expired: 'Order expired',
  cancelled: 'Order cancelled',
}

const declineReasons: Record<string, string> = {
  card_declined: 'The bank declined the card.',
  insufficient_funds: 'The card does not have enough funds.',
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right font-extrabold">{value}</dd>
    </div>
  )
}

/**
 * Seconds until the keys are released. The server says how long is left
 * when it answers; from then on this counts down by the clock's progress,
 * so a wrong clock in the browser does not matter.
 */
function useSecondsLeft(secondsAtAnswer: number, answeredAt: number) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return Math.max(0, secondsAtAnswer - Math.floor(Math.max(0, now - answeredAt) / 1000))
}

/** A pending order: the time left, the ways to pay, and the Pay button. */
function Payment({ order, userId, receivedAt, onExpired }: { order: Order; userId: number; receivedAt: number; onExpired: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [method, setMethod] = useState(order.payment_methods[0]?.value ?? '')
  const secondsLeft = useSecondsLeft(order.expires_in_seconds ?? 0, receivedAt)
  const total = formatMoney(order.totals.total_cents, order.totals.currency)

  // Whatever order the server sends back is what the page shows next.
  const show = (response: OrderResponse) => queryClient.setQueryData(orderKey(userId, order.id), { data: response.data })
  // A declined payment (402) or an order that can no longer be paid (409)
  // is an error status, but its body is the order: show it too.
  const showFromError = (error: unknown) => {
    if (error instanceof ApiError && hasOrder(error.body)) show(error.body)
  }

  // Pressed twice in the same instant, each of these still sends one request.
  const sendPayment = useSingleFlight(() => payOrder(order.id, method))
  const sendCancellation = useSingleFlight(() => cancelOrder(order.id))

  const pay = useMutation({ mutationFn: sendPayment, onSuccess: show, onError: showFromError })
  const cancel = useMutation({
    mutationFn: sendCancellation,
    onSuccess: (response) => {
      show(response)
      if (response.data.status !== 'paid') navigate('/cart')
    },
    onError: showFromError,
  })
  const busy = pay.isPending || cancel.isPending

  // Time is up: ask the server, which is the one that expires the order.
  const timeIsUp = secondsLeft === 0
  useEffect(() => {
    if (!timeIsUp) return
    const timer = setTimeout(onExpired, 1000)
    return () => clearTimeout(timer)
  }, [timeIsUp, onExpired])

  const failure = pay.error ?? cancel.error
  const unexpected = failure !== null && !(failure instanceof ApiError && hasOrder(failure.body))

  return (
    <section aria-labelledby="payment-heading" className={`p-5 ${surface}`}>
      <h1 id="payment-heading" className={pageTitle}>
        Complete your payment
      </h1>

      <p className="mt-3" role="timer" aria-live="off">
        Your keys are held for{' '}
        <span className={`font-extrabold ${secondsLeft < 60 ? 'text-danger' : 'text-accent'}`}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </span>
        . After that they go back on sale and this order is cancelled.
      </p>

      <fieldset className="mt-5" disabled={busy}>
        <legend className="text-sm font-extrabold uppercase text-muted">Payment method</legend>
        <p className="mt-1 text-sm text-muted">
          This is a demonstration: no money is taken and no card details are asked for. Pick a test card to see each outcome.
        </p>
        <div className="mt-3 space-y-2">
          {order.payment_methods.map((option) => (
            <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${method === option.value ? 'border-accent bg-page' : 'border-line'}`}>
              <input type="radio" name="payment_method" className="mt-1 accent-[#fad318]" value={option.value} checked={method === option.value} onChange={() => setMethod(option.value)} />
              <span>
                <span className="block font-extrabold">{option.label}</span>
                <span className="block text-sm text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {unexpected && (
        <p role="alert" className="mt-4 text-sm text-danger">
          We could not confirm what happened. It is safe to try again: this order can only ever be charged once.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className={`${primaryButton} min-w-48`} disabled={busy || !method} onClick={() => pay.mutate()}>
          {pay.isPending && <Spinner />}
          {pay.isPending ? 'Processing payment…' : `Pay ${total}`}
        </button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => cancel.mutate()}>
          Cancel and return to cart
        </button>
      </div>
    </section>
  )
}

/** A settled order: what happened, in words, and what the buyer can do next. */
function Outcome({ order }: { order: Order }) {
  if (order.status === 'paid') {
    return (
      <section aria-labelledby="outcome-heading" className="rounded-card border-l-4 border-deal bg-card-mid p-5 shadow-card">
        <h1 id="outcome-heading" className={pageTitle}>
          Payment confirmed
        </h1>
        <p className="mt-2 text-muted">
          Thank you. Your {order.totals.items_count === 1 ? 'key is' : 'keys are'} below, and stay available under{' '}
          <Link to="/account/keys" className="underline hover:text-accent">
            My game keys
          </Link>
          .
        </p>
      </section>
    )
  }

  const explanation =
    order.status === 'failed'
      ? `${declineReasons[order.failure_reason ?? ''] ?? 'The payment was declined.'} You have not been charged, and the keys are back on sale.`
      : order.status === 'expired'
        ? 'The order was not paid for in time, so the keys went back on sale. You have not been charged.'
        : 'You cancelled this order. The keys went back on sale and you have not been charged.'

  return (
    <section aria-labelledby="outcome-heading" role="alert" className="rounded-card border-l-4 border-danger bg-card-mid p-5 shadow-card">
      <h1 id="outcome-heading" className={pageTitle}>
        {titles[order.status] ?? 'Order closed'}
      </h1>
      <p className="mt-2 text-muted">{explanation}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link to="/cart" className={primaryButton}>
          Back to cart
        </Link>
        <Link to="/store" className={secondaryButton}>
          Continue shopping
        </Link>
      </div>
    </section>
  )
}

/** What was ordered, from whom, and (once paid) the keys. */
function Items({ order }: { order: Order }) {
  return (
    <section aria-labelledby="items-heading">
      <h2 id="items-heading" className={`mb-3 ${sectionTitle}`}>
        {order.status === 'paid' ? 'Your keys' : 'Items'}
      </h2>
      <ul className="space-y-2">
        {order.items.map((item) => (
          <li key={item.offer_id} className={`p-3 sm:p-4 ${surface}`}>
            <div className="flex gap-3 sm:gap-4">
              <LineCover url={item.product.cover_image_url} />
              <div className="min-w-0 flex-1">
                <LineTitle slug={item.product.slug} name={item.product.name} platform={item.product.platform.name} region={item.product.region.name} />
                <p className="mt-2 text-sm">
                  Sold by <span className="font-extrabold">{item.seller_name}</span>
                </p>
              </div>
              <p className="shrink-0 text-right text-sm">
                <span className="text-muted">
                  {item.quantity} × {formatMoney(item.unit_price.amount_cents, item.unit_price.currency)}
                </span>
                <span className="block text-lg font-extrabold">{formatMoney(item.line_total_cents, item.unit_price.currency)}</span>
              </p>
            </div>

            {item.keys.length > 0 && (
              <ul aria-label={`Keys for ${item.product.name}`} className="mt-3 space-y-2">
                {item.keys.map((key) => (
                  <LicenseKey key={key} code={key} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function LicenseKey({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard access: the key is on screen and can be selected by hand.
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-dashed border-deal bg-page px-3 py-2">
      <code className="select-all break-all font-mono text-base font-bold tracking-wider">{code}</code>
      <button type="button" className="text-sm font-extrabold underline hover:text-accent" aria-label={`${copied ? 'Copied' : 'Copy'} key ${code}`} onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </li>
  )
}
