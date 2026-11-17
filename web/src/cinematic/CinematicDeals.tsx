import { useEffect, useRef, useState } from 'react'
import { DealsBlock } from '../components/HomeBlocks'
import type { HomepageBlock } from '../lib/homepage'
import { LAYOUTS, layoutHere } from './layouts'
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
 * Space first, pictures second. Whether the section gets its pinned stage
 * and the scrolling room behind it is decided the moment the block
 * appears, from the window and the device alone (see layoutHere). The
 * frames are fetched after that, and when they arrive nothing on the page
 * moves: the canvas simply starts drawing. With reduced motion, data
 * saving, a slow connection, a tablet-sized window or an unsupported
 * browser no space is reserved and this is exactly the deals block as it
 * has always been.
 */
/** The light: a thin bright line with a violet glow falling away on both sides, like the neon in the frames. */
const BEAM =
  'linear-gradient(90deg, transparent 0%, rgb(168 85 247 / 0.12) 18%, rgb(217 70 239 / 0.42) 38%, rgb(250 210 255 / 0.85) 47%, #fff 50%, rgb(250 210 255 / 0.85) 53%, rgb(217 70 239 / 0.42) 62%, rgb(168 85 247 / 0.12) 82%, transparent 100%)'
/** It thins out toward the top and bottom of the stage instead of ending at an edge. */
const BEAM_ENDS = 'linear-gradient(180deg, transparent 0%, #000 22%, #000 78%, transparent 100%)'

export function CinematicDeals({ block }: { block: HomepageBlock }) {
  const runway = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const light = useRef<HTMLDivElement>(null)

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
    if (!armed || !runway.current || !canvas.current || !holder.current || !spacer.current || !light.current) return

    return armed.run({ runway: runway.current, canvas: canvas.current, holder: holder.current, spacer: spacer.current, light: light.current }, () => setArmed(null))
  }, [armed])

  return (
    // The runway: the stage plus an empty stretch as long as the animation lasts.
    <div ref={runway}>
      {/* The stage stays at the top of the window while the runway scrolls past. */}
      <div className={layout ? 'sticky top-0 flex min-h-[100svh] flex-col justify-center' : undefined}>
        <canvas
          ref={canvas}
          aria-hidden="true"
          hidden={!layout}
          className="pointer-events-none absolute left-1/2 top-0 h-[100svh] w-screen -translate-x-1/2"
        />
        <div ref={holder}>
          {/* Keeps the block from being the first thing in its box, which would change its top margin. */}
          <span hidden />
          <DealsBlock block={block} />
        </div>
        {/*
          The band of light that crosses the row when the cases give way to
          the cards (stage.ts moves it). It lies over the block, cannot be
          clicked, and stays invisible until then.
        */}
        <div aria-hidden="true" hidden={!layout} className="pointer-events-none absolute left-1/2 top-0 h-[100svh] w-screen -translate-x-1/2 overflow-hidden">
          <div ref={light} className="absolute inset-y-0 left-0 opacity-0 mix-blend-screen" style={{ background: BEAM, maskImage: BEAM_ENDS, WebkitMaskImage: BEAM_ENDS }} />
        </div>
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
