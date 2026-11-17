/*
 * The two shapes the section comes in, and when each applies. Kept apart
 * from the drawing code because the page needs these the moment the block
 * appears, before anything has been downloaded: whether the section's
 * space is reserved must never depend on when the frames arrive.
 */

export type LayoutName = 'wide' | 'narrow'

export const LAYOUTS = {
  /** Six cards across: windows 1024px wide and up. */
  wide: {
    slots: 6,
    /** How long the stage stays pinned. In small-viewport units, which do not change when a phone's address bar hides. */
    pin: '240svh',
    /** How much memory decoded pictures may take, in megabytes. */
    pictureBudgetMB: 48,
  },
  /** Two cards across: windows under 640px wide. */
  narrow: { slots: 2, pin: '200svh', pictureBudgetMB: 24 },
} as const

const WIDE_FROM = 1024
const NARROW_UP_TO = 639

/**
 * Which layout this window gets for a block with this many products, or
 * null for the ordinary block: tablet widths, reduced motion, data saving,
 * a slow connection, little memory, or a browser without what is needed.
 * Everything here can be answered at once, without waiting for anything.
 */
export function layoutHere(productCount: number): LayoutName | null {
  if (!canRun()) return null
  const name = window.innerWidth >= WIDE_FROM ? 'wide' : window.innerWidth <= NARROW_UP_TO ? 'narrow' : null

  return name && productCount >= LAYOUTS[name].slots ? name : null
}

function canRun() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory

  return (
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof window.createImageBitmap === 'function' &&
    typeof window.IntersectionObserver === 'function' &&
    typeof CSS !== 'undefined' &&
    CSS.supports('position', 'sticky') &&
    CSS.supports('height', '1svh') &&
    !connection?.saveData &&
    !/2g/.test(connection?.effectiveType ?? '') &&
    (memory ?? 4) >= 4
  )
}
