import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Pagination } from '../components/Pagination'
import { Notice, primaryButton } from '../components/States'
import { ApiError } from '../lib/api'
import { fetchOrders, shortId, statusLabels, type OrderSummary } from '../lib/checkout'
import { formatDateTime, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** The signed-in buyer's orders, newest first. The page number is in the address. */
export function OrdersPage() {
  useDocumentTitle('Your orders')
  const [params] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const orders = useQuery({ queryKey: ['orders', page], queryFn: () => fetchOrders(page), placeholderData: keepPreviousData })

  return (
    <div className="pt-8">
      <h1 className="mb-6 text-3xl font-bold">Your orders</h1>

      {orders.isPending && <p role="status">Loading your orders…</p>}

      {orders.error instanceof ApiError && orders.error.status === 401 && (
        <Notice title="Sign in to see your orders">
          <p>Orders and their keys are only shown to the account that placed them.</p>
          <Link to="/account?next=/orders" className={primaryButton}>
            Sign in
          </Link>
        </Notice>
      )}

      {orders.isError && !(orders.error instanceof ApiError && orders.error.status === 401) && (
        <Notice title="Your orders could not be loaded" tone="error">
          <p>The server may be starting up. This can take up to a minute.</p>
          <button type="button" className={primaryButton} onClick={() => orders.refetch()}>
            Try again
          </button>
        </Notice>
      )}

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
