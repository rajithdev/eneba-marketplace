import type { ReactNode } from 'react'

/** Grey blocks in the shape of the product grid, shown while it loads. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading products" className={productGrid}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="animate-pulse bg-card">
          <div className="aspect-[3/4] bg-panel" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-4/5 bg-panel" />
            <div className="h-3 w-2/5 bg-panel" />
            <div className="h-6 w-1/2 bg-panel" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The grid every list of product cards uses. */
export const productGrid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4'

/** A centred message with an optional action: used for empty results and errors. */
export function Notice({ title, children, tone = 'neutral' }: { title: string; children?: ReactNode; tone?: 'neutral' | 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="bg-card px-6 py-12 text-center">
      <h2 className={`text-xl font-extrabold ${tone === 'error' ? 'text-danger' : ''}`}>{title}</h2>
      {children && <div className="mt-3 flex flex-col items-center gap-4 text-muted">{children}</div>}
    </div>
  )
}

/** The yellow primary button, as a class list so it works on <button> and <Link>. */
export const primaryButton =
  'inline-flex h-10 items-center justify-center bg-accent px-5 text-[15px] font-extrabold text-black hover:bg-accent-strong'

export const secondaryButton =
  'inline-flex h-10 items-center justify-center border border-white/60 px-5 text-[15px] font-extrabold text-white hover:border-accent hover:text-accent'
