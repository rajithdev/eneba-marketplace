import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { Pagination } from '../components/Pagination'
import { pageTitle, primaryButton } from '../components/States'
import { fetchOrders, ordersKey, orderTitle, paymentLabels, shortId, type OrderSummary } from '../lib/checkout'
import { formatDateTime, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useAccount } from './context'
import { EmptyState, panel, PanelError, RowsSkeleton, SmallCover, StatusBadge } from './parts'

/** The states the history can be narrowed to: the server's own (GET /api/orders?status=...). */
const filters = [
  { value: '', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Awaiting payment' },
  { value: 'failed', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
]

const emptyFor: Record<string, string> = {
  paid: 'No paid orders yet.',
  pending: 'No order is awaiting payment.',
  failed: 'No payment has been declined.',
  cancelled: 'No cancelled orders.',
  expired: 'No expired orders.',
}

/** /account/orders: every order, newest first. The page and the filter are in the address. */
export function OrdersTab() {
  const { user } = useAccount()
  useDocumentTitle('Your orders')
  const [params] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const status = filters.some((filter) => filter.value === params.get('status')) ? (params.get('status') ?? '') : ''
  const orders = useQuery({
    queryKey: ordersKey(user.id, page, status),
    queryFn: () => fetchOrders(page, status),
    // Changing page keeps the current list on screen until the next one
    // arrives, but only ever this same buyer's list.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === user.id ? previous : undefined),
  })
  const hrefFor = (target: number, filter = status) => {
    const query = new URLSearchParams()
    if (filter) query.set('status', filter)
    if (target > 1) query.set('page', String(target))
    const search = query.toString()
    return `/account/orders${search ? `?${search}` : ''}`
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className={pageTitle}>My orders</h1>
        <p className="mt-1 text-muted">Every order you have placed, newest first. Open one to see its details and keys.</p>
      </header>

      <nav aria-label="Filter orders by status" className="-mx-1 overflow-x-auto [scrollbar-width:none]">
        <ul className="flex gap-2 px-1 pb-1">
          {filters.map((filter) => (
            <li key={filter.value} className="shrink-0">
              <Link
                to={hrefFor(1, filter.value)}
                aria-current={filter.value === status ? 'true' : undefined}
                className={`inline-flex h-9 items-center rounded-full border px-4 text-sm font-extrabold ${
                  filter.value === status ? 'border-accent bg-accent text-black' : 'border-edge/25 text-muted hover:border-edge/60 hover:text-white'
                }`}
              >
                {filter.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label="Orders" className={panel}>
        {orders.isPending && (
          <>
            <p role="status" className="sr-only">
              Loading your orders…
            </p>
            <RowsSkeleton rows={4} label="Loading your orders" />
          </>
        )}

        {orders.isError && !orders.data && <PanelError title="Your orders could not be loaded" error={orders.error} retry={() => orders.refetch()} />}

        {orders.data && orders.data.data.length === 0 && (
          <EmptyState icon={<Icon name="orders" className="size-6" />} title={status ? (emptyFor[status] ?? 'No orders here.') : 'No orders yet'}>
            {status ? (
              <Link to={hrefFor(1, '')} className="font-extrabold text-accent underline">
                Show all orders
              </Link>
            ) : (
              <>
                <p>When you buy something, the order and its keys appear here.</p>
                <Link to="/store" className={primaryButton}>
                  Browse the store
                </Link>
              </>
            )}
          </EmptyState>
        )}

        {orders.data && orders.data.data.length > 0 && (
          <ul className="divide-y divide-edge/10">
            {orders.data.data.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
        )}
      </section>

      {orders.data && <Pagination currentPage={orders.data.meta.current_page} lastPage={orders.data.meta.last_page} hrefFor={(target) => hrefFor(target)} />}
    </div>
  )
}

/** What a closed order means for its keys. (Its badge says why it closed; its payment line, that nothing was charged.) */
const closedNotes: Record<string, string> = {
  failed: 'No keys were delivered.',
  expired: 'No keys were delivered.',
  cancelled: 'No keys were delivered.',
}

function OrderRow({ order }: { order: OrderSummary }) {
  const action = order.status === 'paid' ? 'View keys' : order.status === 'pending' ? 'Complete payment' : 'View order'

  return (
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <SmallCover url={order.items[0]?.product.cover_image_url ?? null} />
        <div className="min-w-0">
          <p className="font-bold leading-snug">{orderTitle(order)}</p>
          <p className="mt-0.5 text-sm text-muted">
            Order {shortId(order.id)} · {formatDateTime(order.created_at)} · {order.totals.items_count} {order.totals.items_count === 1 ? 'key' : 'keys'}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge status={order.status} />
            <span>
              Payment: {paymentLabels[order.payment.status] ?? order.payment.status}
              {closedNotes[order.status] && ` · ${closedNotes[order.status]}`}
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <p className="text-lg font-bold tabular-nums">{formatMoney(order.totals.total_cents, order.totals.currency)}</p>
        <Link
          to={`/orders/${order.id}`}
          className={`inline-flex h-9 items-center gap-1 rounded-control px-3 text-sm font-extrabold ${
            order.status === 'pending' ? 'bg-accent text-black hover:bg-accent-strong' : 'border border-edge/30 hover:border-accent hover:text-accent'
          }`}
        >
          {action}
          <Icon name="next" className="size-4" />
        </Link>
      </div>
    </li>
  )
}
