import type { ReactNode } from 'react'
import { describeFailure } from '../lib/api'

/** Grey blocks in the shape of the product grid, shown while it loads. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading products" className={productGrid}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`animate-pulse overflow-hidden ${surface}`}>
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
export const productGrid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4'

/**
 * A centred message with an optional action: used for empty results and
 * errors. When it is all a page has to show ("not found"), pass
 * heading="h1" so the page still has its one main heading.
 */
export function Notice({
  title,
  children,
  tone = 'neutral',
  heading: Heading = 'h2',
}: {
  title: string
  children?: ReactNode
  tone?: 'neutral' | 'error'
  heading?: 'h1' | 'h2'
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`${surface} px-6 py-12 text-center`}>
      <Heading className={`${sectionTitle} ${tone === 'error' ? 'text-danger' : ''}`}>{title}</Heading>
      {children && <div className="mt-3 flex flex-col items-center gap-4 text-muted">{children}</div>}
    </div>
  )
}

/**
 * "This could not be loaded", with the reason worded honestly (a server
 * that is waking up is not described as broken, nor the reverse; see
 * describeFailure) and a button to try again.
 */
export function LoadError({ title, error, retry, heading }: { title: string; error: unknown; retry: () => void; heading?: 'h1' | 'h2' }) {
  return (
    <Notice title={title} tone="error" heading={heading}>
      <p>{describeFailure(error)}</p>
      <button type="button" className={primaryButton} onClick={retry}>
        Try again
      </button>
    </Notice>
  )
}

/*
 * The pieces every page is built from, defined once so the pages agree:
 * where a page's content starts, its title, the title of a section in it,
 * and the two kinds of button at two sizes. As class lists, so the same
 * look works on <button>, <Link> and <a>.
 */

/** Space between the header and a page's first line. */
export const pageTop = 'pt-8'

/** A page's main heading: 30px bold, as on eneba.com; a size smaller on phones. */
export const pageTitle = 'text-2xl font-bold leading-tight sm:text-3xl'

/** A heading inside a page: a section, a panel, a message. */
export const sectionTitle = 'text-xl font-bold'

// A card's body: rounded, near-black violet that deepens toward its foot.
const cardBody = 'rounded-card border bg-linear-to-b from-card-top via-card-mid via-55% to-card-foot'

/**
 * The surfaces everything sits on, so every page is built from the same
 * few boxes.
 *
 * `surface` is the dark card with a thin lit edge: rows, forms, filters,
 * messages. `raised` is the lighter panel that asks for attention: the
 * buy box and the order summaries. `glowing` is a card that is itself the
 * thing to open or buy (a product, a deal): it rests with a soft glow and
 * lights up and lifts under the pointer. `lit` is added to a surface or
 * raised panel that is a link, so that it answers the pointer the same way.
 *
 * A card's children are not clipped to its rounded corners unless the card
 * also says `overflow-hidden`: say it where a picture or a coloured bar
 * reaches the card's edge.
 */
export const surface = `${cardBody} border-edge/30 shadow-card`
export const raised = 'rounded-card border border-edge/50 bg-linear-to-b from-panel-top to-panel shadow-card'
const answers = 'transition-[border-color,box-shadow,translate] duration-200 hover:border-edge-lit focus-within:border-edge-lit motion-safe:hover:-translate-y-0.5'
export const glowing = `${cardBody} border-edge/60 shadow-glow hover:shadow-glow-lit ${answers}`
export const lit = `hover:shadow-glow ${answers}`

/** A small label on a coloured ground: "Best price", an order's status. */
export const badge = 'rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase'

/** Turns in a button while its request is on its way. Decorative: the button's text says what is happening. */
export function Spinner() {
  return <span aria-hidden="true" className="mr-2 inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
}

// Shared by every button: how it sits, how it answers a press, and how it
// looks when it cannot be pressed. (The pointer and not-allowed cursors,
// and the speed of colour changes, are set for all buttons in index.css.)
const button = 'inline-flex items-center justify-center rounded-control font-extrabold active:translate-y-px disabled:opacity-60 disabled:active:translate-y-0'
const primary = 'bg-accent text-black hover:bg-accent-strong'
const secondary = 'border border-white/70 text-white hover:border-accent hover:text-accent'

/** The yellow button: the main action of a page or panel. */
export const primaryButton = `${button} ${primary} h-10 px-5 text-[15px]`

/** The outlined button: the alternative next to a primary one. */
export const secondaryButton = `${button} ${secondary} h-10 px-5 text-[15px]`

/** The same two, at the size used inside tables and side panels. */
export const smallPrimaryButton = `${button} ${primary} h-9 px-3 text-sm`
export const smallSecondaryButton = `${button} ${secondary} h-9 px-3 text-sm`
