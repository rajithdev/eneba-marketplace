import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Pagination } from '../components/Pagination'
import { SessionNotice } from '../components/SessionNotice'
import { LoadError, Notice, primaryButton } from '../components/States'
import { useSession } from '../lib/auth'
import { fetchOrders, ordersKey, shortId, statusLabels, type OrderSummary } from '../lib/checkout'
import { formatDateTime, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** The signed-in buyer's orders, newest first. The page number is in the address. */
export function OrdersPage() {
  useDocumentTitle('Your orders')
  const [params] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const session = useSession()
  const userId = session.state === 'signed-in' ? session.user.id : null
  // Asked for, and shown, only for a confirmed signed-in buyer. A 401 from
  // this request ends the session for the whole app (see createQueryClient).
  const orders = useQuery({
    queryKey: ordersKey(userId, page),
    queryFn: () => fetchOrders(page),
    enabled: userId !== null,
    // Changing page keeps the current list on screen until the next one
    // arrives, but only ever this same buyer's list.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === userId ? previous : undefined),
  })

  if (session.state !== 'signed-in') {
    return (
      <div className="pt-8">
        <h1 className="mb-6 text-3xl font-bold">Your orders</h1>
        <SessionNotice session={session} what="your orders" next="/orders" />
      </div>
    )
  }

  return (
    <div className="pt-8">
      <h1 className="mb-6 text-3xl font-bold">Your orders</h1>

      {orders.isPending && <p role="status">Loading your orders…</p>}

      {orders.isError && !orders.data && <LoadError title="Your orders could not be loaded" error={orders.error} retry={() => orders.refetch()} />}

      {orders.data && orders.data.data.length === 0 && (
        <Notice title="No orders yet">
          <p>When you buy something, the order and its keys appear here.</p>
          <Link to="/store" className={primaryButton}>
            Browse the store
          </Link>
        </Notice>
      )}

      {orders.data && orders.data.data.length > 0 && (
        <>
          <ul className="space-y-2">
            {orders.data.data.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
          <Pagination currentPage={orders.data.meta.current_page} lastPage={orders.data.meta.last_page} hrefFor={(target) => `/orders?page=${target}`} />
        </>
      )}
    </div>
  )
}

const statusColours: Record<string, string> = {
  paid: 'bg-deal text-black',
  pending: 'bg-accent text-black',
}

function OrderRow({ order }: { order: OrderSummary }) {
  return (
    <li className="bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <Link to={`/orders/${order.id}`} className="text-lg font-extrabold hover:text-accent">
            Order {shortId(order.id)}
          </Link>
          <p className="text-sm text-muted">{formatDateTime(order.created_at)}</p>
        </div>
        <span className={`px-2 py-0.5 text-xs font-extrabold uppercase ${statusColours[order.status] ?? 'bg-panel text-white'}`}>
          {statusLabels[order.status] ?? order.status}
        </span>
        <p className="text-xl font-extrabold">{formatMoney(order.totals.total_cents, order.totals.currency)}</p>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {order.items.map((item) => (
          <li key={item.offer_id}>
            {item.quantity} × {item.product.name} <span className="text-muted">from {item.seller_name}</span>
          </li>
        ))}
      </ul>

      <Link to={`/orders/${order.id}`} className="mt-3 inline-block text-sm font-extrabold underline hover:text-accent">
        {order.status === 'paid' ? 'View keys' : order.status === 'pending' ? 'Complete payment' : 'View order'}
      </Link>
    </li>
  )
}
