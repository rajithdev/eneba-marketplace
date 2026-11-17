import { useEffect, useRef, useState } from 'react'
import { DealsBlock } from '../components/HomeBlocks'
import type { HomepageBlock } from '../lib/homepage'
import type { Armed } from './stage'

/**
 * The homepage's deals block, with a scroll-controlled introduction where
 * the browser can run one: the visitor scrolls through a rendered vault of
 * game cases, and the last frame's row of cases becomes the block's real
 * product cards.
 *
 * The block itself is always the ordinary <DealsBlock>, in the page from
 * the start: its title, names, prices, discounts and links are the real
 * elements, backed by the API. The animation is decoration drawn on a
 * canvas behind it and is hidden from screen readers.
 *
 * Nothing changes on the page until the frames have arrived, and nothing
 * ever changes when motion is reduced, data is being saved, the window is
 * tablet-sized, or the browser lacks what the effect needs. Then this is
 * exactly the deals block as it has always been.
 */
export function CinematicDeals({ block }: { block: HomepageBlock }) {
  const runway = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState<Armed | null>(null)
  const products = (block.data.products ?? []).map((product) => product.slug).join()

  // Load, when the browser has nothing better to do.
  useEffect(() => {
    if (!canRun()) return
    let cancelled = false
    let prepared: Armed | null = null

    const timer = setTimeout(async () => {
      const stage = await import('./stage')
      prepared = await stage.prepare(block).catch(() => null)
      if (!prepared) return
      // Arming re-centres the block and makes the page longer. That may
      // only happen while the block is still out of sight, or showing no
      // more than its top edge at the foot of the window (as it does on a
      // common desktop size before any scrolling); otherwise the page
      // would jump under the visitor.
      const stillBelow = (holder.current?.getBoundingClientRect().top ?? 0) > window.innerHeight * ARM_BELOW
      if (cancelled || !stillBelow) return prepared.dispose()
      setArmed(prepared)
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
      prepared?.dispose()
      setArmed(null)
    }
    // `products` stands for the block: the effect restarts when the block's products change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

  // Draw, once armed.
  useEffect(() => {
    if (!armed || !runway.current || !canvas.current || !holder.current) return

    return armed.run({ runway: runway.current, canvas: canvas.current, holder: holder.current }, () => setArmed(null))
  }, [armed])

  return (
    // The runway: the stage plus an empty stretch as long as the animation lasts.
    <div ref={runway}>
      {/* The stage stays at the top of the window while the runway scrolls past. */}
      <div className={armed ? 'sticky top-0 flex min-h-[100svh] flex-col justify-center' : undefined}>
        <canvas
          ref={canvas}
          aria-hidden="true"
          hidden={!armed}
          className="pointer-events-none absolute left-1/2 top-0 h-[100svh] w-screen -translate-x-1/2"
        />
        <div ref={holder}>
          {/* Keeps the block from being the first thing in its box, which would change its top margin. */}
          <span hidden />
          <DealsBlock block={block} />
        </div>
      </div>
      {/*
        The stretch the stage stays pinned for. It has to be an element:
        a pinned box can only travel inside its parent's content, and
        padding on the parent is not content.
      */}
      {armed && <div aria-hidden="true" style={{ height: armed.pin }} />}
    </div>
  )
}

/** How far down the window the block's top must still be for the effect to switch on: 0.75 is three quarters of the way. */
const ARM_BELOW = 0.75

/** Whether this browser, as it is set up right now, should get the effect at all. */
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
    !connection?.saveData &&
    !/2g/.test(connection?.effectiveType ?? '') &&
    (memory ?? 4) >= 4
  )
}
