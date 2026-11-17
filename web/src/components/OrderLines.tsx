import { Link } from 'react-router'
import type { Totals } from '../lib/checkout'
import { formatMoney } from '../lib/money'

/** The small cover beside a cart or order line. */
export function LineCover({ url, dimmed = false }: { url: string | null; dimmed?: boolean }) {
  return url ? (
    <img src={url} alt="" width={600} height={800} className={`h-20 w-[60px] shrink-0 object-cover ${dimmed ? 'opacity-50 grayscale' : ''}`} />
  ) : (
    <div className="h-20 w-[60px] shrink-0 bg-panel" />
  )
}

/** A product's name linking to its page, with platform and region beneath. */
export function LineTitle({ slug, name, platform, region }: { slug: string; name: string; platform: string; region: string }) {
  return (
    <>
      <Link to={`/product/${slug}`} className="font-extrabold hover:text-accent">
        {name}
      </Link>
      <p className="mt-0.5 text-xs text-muted">
        {platform} · <span className="text-region">{region}</span>
      </p>
    </>
  )
}

/**
 * The price breakdown shown under a cart and on an order: what the items
 * cost before discounts, what the discounts took off, and what is paid.
 * Every amount is the server's.
 */
export function PriceBreakdown({ totals, totalLabel = 'Total' }: { totals: Totals; totalLabel?: string }) {
  const money = (cents: number) => formatMoney(cents, totals.currency)

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted">
          {totals.items_count} {totals.items_count === 1 ? 'key' : 'keys'}
        </dt>
        <dd>{money(totals.subtotal_cents)}</dd>
      </div>
      {totals.discount_cents > 0 && (
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Discounts</dt>
          <dd className="text-deal">−{money(totals.discount_cents)}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <dt className="font-extrabold">{totalLabel}</dt>
        <dd className="text-2xl font-extrabold">{money(totals.total_cents)}</dd>
      </div>
    </dl>
  )
}
