import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { Spinner } from '../components/States'
import { ApiError, describeFailure } from '../lib/api'
import { fetchOrder, orderKey, shortId, type OrderItemSummary, type OrderSummary } from '../lib/checkout'
import { formatDateTime } from '../lib/money'
import { SmallCover } from './parts'

/**
 * The keys delivered for one line of a paid order, hidden until revealed.
 *
 * The order history carries no keys. Pressing "Reveal" asks for the order
 * itself (GET /api/orders/{id}), the one response that contains keys, and
 * only for its own buyer. The answer is kept in memory only, under the
 * buyer's id, and dropped on signing out or when the session ends (see
 * forgetBuyer in lib/auth.ts). Nothing is written to browser storage.
 */
export function KeyCard({ order, item, userId, compact = false }: { order: OrderSummary; item: OrderItemSummary; userId: number; compact?: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const full = useQuery({
    queryKey: orderKey(userId, order.id),
    queryFn: () => fetchOrder(order.id),
    enabled: revealed,
  })
  const line = full.data?.data.items.find((candidate) => candidate.offer_id === item.offer_id)
  const keys = revealed && full.data?.data.status === 'paid' ? (line?.keys ?? []) : null
  const count = item.quantity
  const label = count === 1 ? 'key' : 'keys'

  return (
    <article aria-label={item.product.name} className="flex gap-4 px-5 py-4">
      <SmallCover url={item.product.cover_image_url} size={compact ? 'md' : 'lg'} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold leading-snug">
              <Link to={`/product/${item.product.slug}`} className="hover:text-accent">
                {item.product.name}
              </Link>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>
                {item.product.platform.name} · <span className="text-region">{item.product.region.name}</span>
              </span>
              {!compact && (
                <span>
                  <span aria-hidden="true">· </span>
                  <Link to={`/orders/${order.id}`} className="underline-offset-2 hover:text-white hover:underline">
                    Order {shortId(order.id)}
                  </Link>
                  {order.paid_at && ` · delivered ${formatDateTime(order.paid_at)}`}
                </span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-expanded={revealed}
            aria-label={`${revealed ? 'Hide' : 'Reveal'} ${label} for ${item.product.name}`}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-control border border-edge/30 px-3 text-sm font-extrabold hover:border-accent hover:text-accent"
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} className="size-4" />
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        </div>

        <ul aria-label={`${count === 1 ? 'Key' : 'Keys'} for ${item.product.name}`} className="mt-3 space-y-2">
          {keys
            ? keys.map((code, index) => <KeyRow key={code} code={code} position={count > 1 ? `${index + 1} of ${count}` : null} />)
            : Array.from({ length: count }, (_, index) => <MaskedRow key={index} loading={revealed && full.isFetching} />)}
        </ul>

        {revealed && full.isError && !full.data && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {full.error instanceof ApiError && full.error.status === 404 ? (
              // The server looks orders up through the signed-in buyer's own: someone else's is "not found".
              'This order is not available to the account that is signed in.'
            ) : (
              <>
                Your {label} could not be loaded. {describeFailure(full.error)}{' '}
                <button type="button" className="font-extrabold underline" onClick={() => full.refetch()}>
                  Try again
                </button>
              </>
            )}
          </p>
        )}
        {keys?.length === 0 && (
          <p role="alert" className="mt-2 text-sm text-danger">
            No key was found for this item. <Link to={`/orders/${order.id}`} className="underline">Open the order</Link>.
          </p>
        )}
      </div>
    </article>
  )
}

/** A key's place while it is hidden: the right shape, none of its characters. */
function MaskedRow({ loading }: { loading: boolean }) {
  return (
    <li className="flex h-11 items-center justify-between gap-3 rounded-control border border-edge/20 bg-black/30 px-3">
      <span className="sr-only">Hidden key</span>
      <span aria-hidden="true" className="select-none truncate whitespace-nowrap font-mono text-sm tracking-[0.2em] text-muted">
        •••••-•••••-•••••
      </span>
      {loading && (
        <span role="status" className="flex items-center text-xs text-muted">
          <Spinner />
          Loading…
        </span>
      )}
    </li>
  )
}

function KeyRow({ code, position }: { code: string; position: string | null }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copy])

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(code)
      setCopy('copied')
    } catch {
      // No clipboard access (an old browser, or permission refused).
      setCopy('failed')
    }
  }

  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-dashed border-deal/50 bg-black/30 py-1.5 pl-3 pr-1.5">
      <code className="select-all break-all font-mono text-sm font-bold tracking-wider">{code}</code>
      <button
        type="button"
        onClick={copyKey}
        aria-label={position ? `Copy key ${position}` : 'Copy key'}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-extrabold text-black hover:bg-accent-strong"
      >
        <Icon name={copy === 'copied' ? 'check' : 'copy'} className="size-4" />
        {copy === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span role="status" className="w-full text-xs empty:hidden">
        {copy === 'copied' && <span className="text-deal">Copied to the clipboard.</span>}
        {copy === 'failed' && <span className="text-danger">Could not copy. Select the key and copy it by hand.</span>}
      </span>
    </li>
  )
}
