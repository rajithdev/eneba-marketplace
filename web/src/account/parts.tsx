import type { ReactNode } from 'react'
import { describeFailure } from '../lib/api'
import { statusLabels } from '../lib/checkout'
import { coverArt } from '../lib/coverArt'

/*
 * Pieces shared by the account pages. The look is the store's (dark violet
 * cards, yellow for the one main action), kept quieter: one thin edge per
 * panel and no glow, because these pages are read rather than browsed.
 */

/** A panel on the account pages: the dark card, with a restrained edge. */
export const panel = 'rounded-card border border-edge/20 bg-linear-to-b from-card-top to-card-foot shadow-card'

/** A panel's heading row: its title and, at the right, a link to see more. */
export function PanelHeader({ title, id, action }: { title: string; id: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-edge/15 px-5 py-4">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      {action}
    </div>
  )
}

/** The colour of each order status: green once paid, yellow while awaiting payment, quiet otherwise. */
const statusTones: Record<string, string> = {
  paid: 'border-deal/40 bg-deal/10 text-deal',
  pending: 'border-accent/50 bg-accent/10 text-accent',
  failed: 'border-danger/40 bg-danger/10 text-danger',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${statusTones[status] ?? 'border-white/20 bg-white/5 text-muted'}`}>
      {statusLabels[status] ?? status}
    </span>
  )
}

/** The cover of an order's first item: what the order is recognised by at a glance. */
export function SmallCover({ url, size = 'md' }: { url: string | null; size?: 'md' | 'lg' }) {
  const cover = coverArt(url)
  const box = size === 'lg' ? 'h-24 w-[72px]' : 'h-16 w-12'

  return cover ? (
    <img src={cover} alt="" width={600} height={800} className={`${box} shrink-0 rounded-md object-cover`} />
  ) : (
    <div className={`${box} shrink-0 rounded-md bg-panel`} />
  )
}

/** A panel's own "could not be loaded", smaller than a page's. */
export function PanelError({ title, error, retry }: { title: string; error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="px-5 py-8 text-center">
      <p className="font-bold text-danger">{title}</p>
      <p className="mt-1 text-sm text-muted">{describeFailure(error)}</p>
      <button type="button" className="mt-3 text-sm font-extrabold text-accent underline hover:text-accent-strong" onClick={retry}>
        Try again
      </button>
    </div>
  )
}

/** A panel with nothing in it yet: what will appear here, and how to get it. */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center px-6 py-10 text-center">
      <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full border border-edge/25 bg-white/5 text-edge">
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      {children && <div className="mt-2 flex max-w-sm flex-col items-center gap-4 text-sm text-muted">{children}</div>}
    </div>
  )
}

/** Grey rows in the shape of a list, while it loads. */
export function RowsSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-edge/10">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-4 px-5 py-4">
          <div className="h-16 w-12 rounded-md bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/5 rounded bg-white/10" />
            <div className="h-3 w-2/5 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}
