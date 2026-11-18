import { useEffect, useRef, useState } from 'react'
import { DealsBlock } from '../components/HomeBlocks'
import { WaveEdge } from '../components/WaveEdge'
import type { HomepageBlock } from '../lib/homepage'
import { LAYOUTS, layoutHere } from './layouts'
import { Showroom } from './Showroom'
import type { Armed } from './stage'

/**
 * The homepage's deals block, with a scroll-controlled introduction where
 * the browser can run one: the visitor scrolls through a neon game store
 * into a showroom, where each of the block's products hangs on a lit
 * panel. The panels are then the cards: choosing one brings up the
 * product's name, discount and price with buttons to add it to the cart
 * or buy it (see Showroom.tsx).
 *
 * The block itself is always the ordinary <DealsBlock>, in the page from
 * the start, backed by the API. It is what everyone sees where the
 * introduction cannot run, and until its frames have arrived. The frames
 * are decoration drawn on a canvas and hidden from screen readers; what
 * they show of each product is repeated as real text and buttons.
 *
 * Space first, pictures second. Whether the section gets its pinned stage
 * and the scrolling room behind it is decided the moment the block
 * appears, from the window and the device alone (see layoutHere). The
 * frames are fetched after that, and when they arrive nothing on the page
 * moves: the canvas simply starts drawing. With reduced motion, data
 * saving, a slow connection, a phone or tablet-sized window, an
 * unsupported browser, or products the showroom does not show, no
 * animation runs and this is exactly the deals block as it has always been.
 */
export function CinematicDeals({ block }: { block: HomepageBlock }) {
  const runway = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const hotspots = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLDivElement>(null)

  const products = (block.data.products ?? []).map((product) => product.slug)
  const [layout, setLayout] = useState(() => layoutHere(products.length))
  const [armed, setArmed] = useState<Armed | null>(null)
  /** Set if the frames could not be had and the pinned stretch was dropped. */
  const [unpinned, setUnpinned] = useState(false)
  const productList = products.join()

  // The layout follows the window, as any responsive layout does, and the motion setting.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const update = () => setLayout(layoutHere(products.length))
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    window.addEventListener('resize', update)
    calm.addEventListener('change', update)

    return () => {
      window.removeEventListener('resize', update)
      calm.removeEventListener('change', update)
    }
  }, [products.length])

  // Fetch the frames for the reserved layout. This file's drawing code is
  // only downloaded here, by browsers that are going to use it.
  useEffect(() => {
    if (!layout) return
    let cancelled = false
    let prepared: Armed | null = null

    void import('./stage')
      .then((stage) => stage.prepare(block, layout))
      .catch(() => null)
      .then((result) => {
        prepared = result
        if (cancelled) return result?.dispose()
        if (result) return setArmed(result)

        // No frames, so nothing to scroll through. The pinned stretch is
        // dropped, which shortens the page below the stage; that is done
        // only while the stage has not started to pin (its top is still
        // at or below the top of the window), when everything it moves
        // is below the window and cannot be seen moving. The block keeps
        // its place in the stage either way.
        if ((runway.current?.getBoundingClientRect().top ?? -1) >= 0) setUnpinned(true)
      })

    return () => {
      cancelled = true
      prepared?.dispose()
      setArmed(null)
    }
    // `productList` stands for the block: the effect restarts when the block's products change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, productList])

  // Draw, once the frames are in.
  useEffect(() => {
    if (!armed || !runway.current || !canvas.current || !holder.current || !spacer.current) return

    return armed.run({ runway: runway.current, canvas: canvas.current, holder: holder.current, spacer: spacer.current, hotspots: hotspots.current, shade: shade.current, edge: edge.current }, () => setArmed(null))
  }, [armed])

  return (
    // The runway: the stage plus an empty stretch as long as the animation lasts.
    <div ref={runway}>
      {/*
        The dusk: a dark sheet over the whole window, behind everything on
        the page, clear until the stage is about to arrive. stage.ts dims
        the page with it as the store comes up the window, so the page is
        already as dark as the store when the store takes over.
      */}
      {layout && <div ref={shade} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-dusk opacity-0" />}
      {/* The stage stays at the top of the window while the runway scrolls past. */}
      <div className={layout ? 'sticky top-0 flex min-h-[100svh] flex-col justify-center' : undefined}>
        <canvas
          ref={canvas}
          aria-hidden="true"
          hidden={!layout}
          className="pointer-events-none absolute left-1/2 top-0 h-[100svh] w-screen -translate-x-1/2"
        />
        {/*
          The lit line along the curved edge the store comes up behind. Its
          depth and brightness follow the scroll (stage.ts); until the frames
          are in it is not shown, and the block's own resting curve is.
        */}
        {layout && <WaveEdge ref={edge} className="absolute left-1/2 top-0 w-screen -translate-x-1/2" style={{ height: 0, opacity: 0 }} />}
        <div ref={holder}>
          {/* Keeps the block from being the first thing in its box, which would change its top margin. */}
          <span hidden />
          <DealsBlock block={block} />
        </div>
        {/*
          Frames that end on the products themselves (a showroom): the
          panels in the last frame are the cards. This lies over the stage
          and holds what is pressed; stage.ts places it and brings it in.
        */}
        {armed?.panels && (
          <div ref={hotspots} className="pointer-events-none absolute left-1/2 top-0 h-[100svh] w-screen -translate-x-1/2 overflow-hidden opacity-0">
            <Showroom block={block} panels={armed.panels} />
          </div>
        )}
      </div>
      {/*
        The stretch the stage stays pinned for. It has to be an element:
        a pinned box can only travel inside its parent's content, and
        padding on the parent is not content.
      */}
      {layout && !unpinned && <div ref={spacer} aria-hidden="true" style={{ height: LAYOUTS[layout].pin }} />}
    </div>
  )
}
