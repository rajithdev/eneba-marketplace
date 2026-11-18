import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { primaryButton } from '../components/States'
import { fetchSummary, summaryKey, type AccountSummary } from '../lib/account'
import { fetchOrders, ordersKey, orderTitle, shortId, type OrderSummary } from '../lib/checkout'
import { formatDateTime, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useAccount } from './context'
import { KeyCard } from './KeyCard'
import { EmptyState, panel, PanelError, PanelHeader, RowsSkeleton, SmallCover, StatusBadge } from './parts'

/**
 * /account: the totals, the latest orders and the latest keys. Every number
 * is the server's (GET /api/account/summary); nothing is counted from a
 * page of orders, which would be wrong past the first page.
 */
export function OverviewPage() {
  const { user } = useAccount()
  useDocumentTitle('Your account')
  const summary = useQuery({ queryKey: summaryKey(user.id), queryFn: fetchSummary })
  const recent = useQuery({ queryKey: ordersKey(user.id, 1), queryFn: () => fetchOrders(1) })
  const paid = useQuery({ queryKey: ordersKey(user.id, 1, 'paid'), queryFn: () => fetchOrders(1, 'paid') })
  const firstName = user.name.trim().split(/\s+/)[0] || user.name
  const returning = (summary.data?.data.orders_count ?? 0) > 0
  const pendingOrder = recent.data?.data.find((order) => order.status === 'pending')

  return (
    <div className="space-y-6">
      <header className={`${panel} relative isolate overflow-hidden px-6 py-7 sm:px-8 sm:py-9`}>
        <img
          src="/covers/art/hero/elden-ring-shadow-of-the-erdtree.jpg"
          alt=""
          width={1600}
          height={900}
          className="absolute inset-y-0 right-0 -z-10 h-full w-3/4 object-cover object-[75%_30%] opacity-60 sm:w-3/5"
          style={{ maskImage: 'linear-gradient(to right, transparent, black 55%)' }}
        />
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{returning ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}</h1>
        <p className="mt-2 max-w-md text-muted">Your orders, game keys and account details, in one place.</p>
      </header>

      {pendingOrder && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/40 bg-accent/10 px-5 py-4">
          <p className="flex items-center gap-3 text-sm">
            <Icon name="clock" className="size-5 text-accent" />
            <span>
              <strong className="font-extrabold text-white">Order {shortId(pendingOrder.id)} is awaiting payment.</strong>{' '}
              <span className="text-muted">Its keys are held for you until the timer runs out.</span>
            </span>
          </p>
          <Link to={`/orders/${pendingOrder.id}`} className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-sm font-extrabold text-black hover:bg-accent-strong">
            Complete payment
          </Link>
        </div>
      )}

      <Totals summary={summary.data?.data} error={summary.isError ? summary.error : null} retry={() => summary.refetch()} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="recent-heading" className={panel}>
          <PanelHeader title="Recent orders" id="recent-heading" action={<MoreLink to="/account/orders">View all orders</MoreLink>} />
          {recent.isPending && <RowsSkeleton label="Loading your orders" />}
          {recent.isError && !recent.data && <PanelError title="Your orders could not be loaded" error={recent.error} retry={() => recent.refetch()} />}
          {recent.data && recent.data.data.length === 0 && (
            <EmptyState icon={<Icon name="orders" className="size-6" />} title="No orders yet">
              <p>When you buy something, the order appears here with its keys.</p>
              <Link to="/store" className={primaryButton}>
                Browse the store
              </Link>
            </EmptyState>
          )}
          {recent.data && recent.data.data.length > 0 && (
            <ul className="divide-y divide-edge/10">
              {recent.data.data.slice(0, 5).map((order) => (
                <RecentOrder key={order.id} order={order} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="keys-heading" className={panel}>
          <PanelHeader title="Your game keys" id="keys-heading" action={<MoreLink to="/account/keys">View all keys</MoreLink>} />
          {paid.isPending && <RowsSkeleton rows={2} label="Loading your keys" />}
          {paid.isError && !paid.data && <PanelError title="Your keys could not be loaded" error={paid.error} retry={() => paid.refetch()} />}
          {paid.data && paid.data.data.length === 0 && (
            <EmptyState icon={<Icon name="key" className="size-6" />} title="No keys yet">
              <p>Keys appear here as soon as a payment is confirmed, hidden until you reveal them.</p>
            </EmptyState>
          )}
          {paid.data && paid.data.data.length > 0 && (
            <div className="divide-y divide-edge/10">
              {paid.data.data
                .flatMap((order) => order.items.map((item) => ({ order, item })))
                .slice(0, 3)
                .map(({ order, item }) => (
                  <KeyCard key={`${order.id}-${item.offer_id}`} order={order} item={item} userId={user.id} compact />
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-sm font-extrabold text-accent hover:text-accent-strong">
      {children}
      <Icon name="arrow" className="size-4" />
    </Link>
  )
}

function Totals({ summary, error, retry }: { summary: AccountSummary | undefined; error: unknown; retry: () => void }) {
  if (error) {
    return (
      <div className={panel}>
        <PanelError title="Your account totals could not be loaded" error={error} retry={retry} />
      </div>
    )
  }

  const tiles: { label: string; value: string | undefined; icon: IconName; tone: string }[] = [
    { label: 'Total orders', value: summary?.orders_count.toString(), icon: 'cart', tone: 'text-edge bg-edge/10' },
    { label: 'Completed purchases', value: summary?.paid_orders_count.toString(), icon: 'check', tone: 'text-deal bg-deal/10' },
    { label: 'Keys delivered', value: summary?.keys_count.toString(), icon: 'key', tone: 'text-accent bg-accent/10' },
    {
      label: 'Total spent',
      value: summary ? formatMoney(summary.spent.total_cents, summary.spent.currency) : undefined,
      icon: 'coins',
      tone: 'text-accent bg-accent/10',
    },
  ]

  return (
    <dl aria-busy={!summary} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className={`${panel} flex items-center gap-3 p-4 sm:gap-4 sm:p-5`}>
          <span aria-hidden="true" className={`hidden size-11 shrink-0 items-center justify-center rounded-full sm:flex ${tile.tone}`}>
            <Icon name={tile.icon} className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col-reverse">
            <dt className="text-sm text-muted">{tile.label}</dt>
            <dd className="truncate text-2xl font-bold tabular-nums">
              {tile.value ?? <span className="inline-block h-7 w-12 animate-pulse rounded bg-white/10 align-middle" />}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  )
}

function RecentOrder({ order }: { order: OrderSummary }) {
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03]">
        <SmallCover url={order.items[0]?.product.cover_image_url ?? null} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-bold leading-snug group-hover:text-accent">{orderTitle(order)}</p>
          <p className="mt-0.5 truncate text-sm text-muted">
            Order {shortId(order.id)} · {formatDateTime(order.created_at)}
          </p>
          <div className="mt-1.5">
            <StatusBadge status={order.status} />
          </div>
        </div>
        <p className="shrink-0 font-bold tabular-nums">{formatMoney(order.totals.total_cents, order.totals.currency)}</p>
        <Icon name="next" className="size-4 text-muted" />
      </Link>
    </li>
  )
}
