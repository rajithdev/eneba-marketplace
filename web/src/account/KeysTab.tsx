import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { Pagination } from '../components/Pagination'
import { pageTitle, primaryButton } from '../components/States'
import { fetchSummary, summaryKey } from '../lib/account'
import { fetchOrders, ordersKey } from '../lib/checkout'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useAccount } from './context'
import { KeyCard } from './KeyCard'
import { EmptyState, panel, PanelError, RowsSkeleton } from './parts'

/**
 * /account/keys: every key delivered to the buyer, one card per product
 * bought, from their paid orders only. A pending order's keys are held, not
 * delivered; a declined, expired or cancelled order never had any.
 */
export function KeysTab() {
  const { user } = useAccount()
  useDocumentTitle('Your game keys')
  const [params] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const paid = useQuery({
    queryKey: ordersKey(user.id, page, 'paid'),
    queryFn: () => fetchOrders(page, 'paid'),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === user.id ? previous : undefined),
  })
  const summary = useQuery({ queryKey: summaryKey(user.id), queryFn: fetchSummary })
  const lines = paid.data?.data.flatMap((order) => order.items.map((item) => ({ order, item }))) ?? []
  const pending = summary.data?.data.pending_orders_count ?? 0

  return (
    <div className="space-y-5">
      <header>
        <h1 className={pageTitle}>My game keys</h1>
        <p className="mt-1 text-muted">Keys from your paid orders. They stay hidden until you reveal them, and only this account can see them.</p>
      </header>

      {pending > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/40 bg-accent/10 px-5 py-4 text-sm">
          <p className="flex items-center gap-3">
            <Icon name="clock" className="size-5 text-accent" />
            An order is awaiting payment. Its keys appear here once the payment is confirmed.
          </p>
          <Link to="/account/orders?status=pending" className="font-extrabold text-accent underline">
            See the order
          </Link>
        </div>
      )}

      <section aria-label="Keys" className={panel}>
        {paid.isPending && <RowsSkeleton rows={3} label="Loading your keys" />}
        {paid.isError && !paid.data && <PanelError title="Your keys could not be loaded" error={paid.error} retry={() => paid.refetch()} />}
        {paid.data && lines.length === 0 && (
          <EmptyState icon={<Icon name="key" className="size-6" />} title="No keys yet">
            <p>Keys appear here the moment a payment is confirmed.</p>
            <Link to="/store" className={primaryButton}>
              Browse the store
            </Link>
          </EmptyState>
        )}
        {lines.length > 0 && (
          <div className="divide-y divide-edge/10">
            {lines.map(({ order, item }) => (
              <KeyCard key={`${order.id}-${item.offer_id}`} order={order} item={item} userId={user.id} />
            ))}
          </div>
        )}
      </section>

      {paid.data && (
        <Pagination
          currentPage={paid.data.meta.current_page}
          lastPage={paid.data.meta.last_page}
          hrefFor={(target) => (target > 1 ? `/account/keys?page=${target}` : '/account/keys')}
        />
      )}

      <p className="flex items-start gap-2 text-sm text-muted">
        <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
        Declined, expired and cancelled orders never deliver keys, and you were not charged for them. Revealed keys are kept only in this tab and are forgotten when you sign out.
      </p>
    </div>
  )
}
