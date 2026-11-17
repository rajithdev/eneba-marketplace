/*
 * The scroll-controlled stage: loads the frames for this window's layout
 * and, once armed, draws the frame that belongs to the scroll position.
 *
 * This file is only fetched by browsers that are going to run the effect
 * (see CinematicDeals), so it costs the others nothing.
 */
import type { HomepageBlock } from '../lib/homepage'
import { between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, progressAt, sweepEdge, sweepSoftness, type Placement, type Rect, type Size } from './fit'
import { LAYOUTS, type LayoutName } from './layouts'
import { loadSequence, type Sequence } from './sequence'

/** Which set of frames (a folder under /cinematic) this build of the site uses. VITE_CINEMATIC_VERSION picks another, for trying a set locally. */
export const VERSION: string = import.meta.env.VITE_CINEMATIC_VERSION ?? 'v1-blockout'
const BASE = `/cinematic/${VERSION}`

/** The cases may sit this far from the real covers, in pixels, and still be faded straight into them. */
const SEAMLESS_WITHIN = 1
/** How quickly the picture catches up with the scroll position, in milliseconds: long enough to smooth a mouse wheel's steps, short enough to feel direct. */
const CATCH_UP_MS = 90
/** How wide the band of light is, in widths of the stretch where cases and cards meet. */
const LIGHT_WIDTH = 3.4

interface Layout {
  frames: number
  width: number
  height: number
  /** With {frame} where the three-digit frame number goes. */
  path: string
  bytes: number
  travel: number
  /** Where each case's front is in the last frame, as fractions of it, and the product it was rendered for. */
  slots: (Rect & { slug: string })[]
}

interface Manifest {
  version: string
  background: string
  layouts: Record<string, Layout>
}

export interface Elements {
  runway: HTMLElement
  canvas: HTMLCanvasElement
  holder: HTMLElement
  /** The empty stretch after the stage; its height is how many pixels of scrolling the animation lasts. */
  spacer: HTMLElement
  /** The band of light that crosses the row when the cases do not become the cards in place. It lies over the stage, from its left edge. */
  light: HTMLElement
}

export interface Armed {
  /** Starts drawing; returns the function that stops it. `giveUp` is called if the effect can no longer run here. */
  run(elements: Elements, giveUp: () => void): () => void
  dispose(): void
}

/**
 * Fetches the manifest and the coarse pass of frames for a layout. Answers
 * null when there are no frames for it, or they cannot be loaded: the
 * caller then shows the ordinary block.
 */
export async function prepare(block: HomepageBlock, name: LayoutName): Promise<Armed | null> {
  const startedAt = performance.now()
  const reply = await fetch(`${BASE}/manifest.json`)
  if (!reply.ok) return null
  const manifest = (await reply.json()) as Manifest

  const layout = manifest.layouts[name]
  const products = block.data.products ?? []
  if (!layout || products.length < layout.slots.length) return null

  // Were the frames rendered for the products the block holds today, in today's order?
  const sameProducts = layout.slots.every((slot, index) => products[index].slug === slot.slug)

  const frameUrl = (frame: number) => `${BASE}/${layout.path.replace('{frame}', String(frame).padStart(3, '0'))}`
  // As many decoded pictures as the layout's memory budget allows, each being width x height x 4 bytes.
  const keep = Math.max(5, Math.floor((LAYOUTS[name].pictureBudgetMB * 1048576) / (layout.width * layout.height * 4)))
  const sequence = loadSequence(frameUrl, layout.frames, keep)
  try {
    await sequence.ready
  } catch {
    sequence.dispose()
    return null
  }
  const armedAfterMs = Math.round(performance.now() - startedAt)

  return {
    dispose: () => sequence.dispose(),
    run: (elements, giveUp) => run({ name, layout, background: manifest.background, sequence, sameProducts, armedAfterMs, keep }, elements, giveUp),
  }
}

interface Show {
  name: string
  layout: Layout
  background: string
  sequence: Sequence
  sameProducts: boolean
  armedAfterMs: number
  keep: number
}

function run(show: Show, { runway, canvas, holder, spacer, light }: Elements, giveUp: () => void) {
  const { layout, sequence } = show
  const context = canvas.getContext('2d')
  if (!context) {
    giveUp()
    return () => {}
  }

  const frame: Size = { width: layout.width, height: layout.height }
  let stage: Size = { width: 1, height: 1 }
  let cover: Placement = { scale: 1, x: 0, y: 0 }
  let handoff = cover
  let offBy: number[] = []
  let seamless = false
  let drawn = ''
  let pin = 1
  // For the light: the row of covers from end to end, how wide the stretch
  // is where cases and cards meet, and where the block's box starts, all
  // in stage pixels.
  let row = { left: 0, right: 1 }
  let soft = 1
  let holderLeft = 0
  let lean = 0

  /** Sizes the canvas to the stage and finds where the real covers are on it. */
  const measure = () => {
    const box = canvas.getBoundingClientRect()
    pin = spacer.offsetHeight
    // The canvas need not be sharper than the frames drawn on it: a
    // high-density screen would otherwise quadruple its memory for nothing.
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, (1.5 * frame.width) / box.width))
    canvas.width = Math.round(box.width * density)
    canvas.height = Math.round(box.height * density)
    stage = { width: box.width, height: box.height }

    const covers = [...holder.querySelectorAll('li img')].slice(0, layout.slots.length).map((image) => {
      const at = image.getBoundingClientRect()
      return { x: at.left - box.left, y: at.top - box.top, w: at.width, h: at.height }
    })
    // The cards are not where they were expected: leave the block as it is.
    if (covers.length < layout.slots.length) return giveUp()

    cover = coverPlacement(frame, stage)
    handoff = handoffPlacement(frame, layout.slots, covers)
    offBy = mismatches(frame, layout.slots, covers, handoff)
    seamless = show.sameProducts && Math.max(...offBy) <= SEAMLESS_WITHIN
    row = { left: covers[0].x, right: covers[covers.length - 1].x + covers[covers.length - 1].w }
    soft = sweepSoftness(row.right - row.left)
    holderLeft = holder.getBoundingClientRect().left - box.left
    // The light is a few times as wide as that stretch, so the change of
    // picture happens inside it, and leans forward by the stretch's width
    // over the height of the stage.
    light.style.width = `${(soft * LIGHT_WIDTH).toFixed(1)}px`
    lean = (Math.atan(soft / stage.height) * 180) / Math.PI
    drawn = ''
  }

  const draw = (progress: number) => {
    const { settle, frameAlpha, cardsAlpha, sweep } = phases(progress, seamless)
    const index = frameAt(progress, layout.travel, layout.frames)
    const picture = sequence.picture(index)
    const at = between(cover, handoff, settle)

    // Nothing is drawn again unless what would be drawn has changed.
    const state = [index, at.scale.toFixed(4), at.x.toFixed(1), at.y.toFixed(1), frameAlpha.toFixed(3), cardsAlpha.toFixed(3), sweep?.toFixed(4)].join()
    if (state === drawn) return
    drawn = state

    const density = canvas.width / stage.width
    context.globalAlpha = 1
    context.fillStyle = show.background
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (picture && frameAlpha > 0) {
      context.globalAlpha = frameAlpha
      context.imageSmoothingQuality = 'high'
      context.drawImage(picture, at.x * density, at.y * density, frame.width * at.scale * density, frame.height * at.scale * density)
    }

    // The light crossing the row. Left of its edge the frame gives way to
    // the page's colour, here on the canvas, and the real block shows
    // through a mask with the same edge; across the `soft` pixels before
    // the edge the two ease into each other, under the light.
    const crossing = sweep !== null && sweep > 0 && sweep < 1
    const edge = crossing ? sweepEdge(sweep, row.left, row.right, soft) : 0
    if (crossing) {
      const fade = context.createLinearGradient((edge - soft) * density, 0, edge * density, 0)
      fade.addColorStop(0, show.background)
      fade.addColorStop(1, `${show.background}00`) // the same colour, see-through
      context.globalAlpha = 1
      context.fillStyle = fade
      context.fillRect(0, 0, edge * density, canvas.height)
    }
    const mask = crossing ? `linear-gradient(90deg, #000 ${(edge - soft - holderLeft).toFixed(1)}px, transparent ${(edge - holderLeft).toFixed(1)}px)` : ''
    holder.style.setProperty('-webkit-mask-image', mask)
    holder.style.setProperty('mask-image', mask)
    // The light fades in as it reaches the row and out as it leaves it.
    light.style.opacity = crossing ? String(Math.min(1, sweep / 0.1, (1 - sweep) / 0.1)) : '0'
    if (crossing) light.style.transform = `translateX(${(edge - soft / 2 - (soft * LIGHT_WIDTH) / 2).toFixed(1)}px) skewX(${(-lean).toFixed(2)}deg)`

    // The real block is always in the page (for screen readers and the
    // keyboard); until it shows, it just cannot be clicked by accident.
    holder.style.opacity = String(cardsAlpha)
    holder.style.pointerEvents = (sweep === null ? cardsAlpha >= 0.5 : sweep === 1) ? '' : 'none'

    if (debugging) {
      window.__cinematic = {
        version: VERSION, layout: show.name, progress, frame: index, handoff: seamless ? 'seamless' : 'sweep', sweep,
        sameProducts: show.sameProducts, offByPx: offBy.map((value) => Math.round(value * 100) / 100), armedAfterMs: show.armedAfterMs,
        frames: layout.frames, decodedBytesEach: layout.width * layout.height * 4, canvasPixels: canvas.width * canvas.height, keep: show.keep, ...sequence.stats(),
      }
    }
  }

  // The loop: every display frame, move the shown progress most of the way
  // to where the scroll is. It only runs while the section is on screen.
  let shown = -1
  let last = 0
  let request = 0
  const tick = (now: number) => {
    const target = progressAt(runway.getBoundingClientRect().top, pin)
    shown = shown < 0 ? target : target + (shown - target) * Math.exp(-(now - last) / CATCH_UP_MS)
    if (Math.abs(shown - target) < 0.0004) shown = target
    last = now
    draw(shown)
    request = requestAnimationFrame(tick)
  }
  const onScreen = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(request)
    if (entry.isIntersecting) {
      last = performance.now()
      request = requestAnimationFrame(tick)
    } else {
      // Off screen: hold no decoded pictures at all until the visitor comes back.
      sequence.release()
      drawn = ''
    }
  })

  // Tabbing to a card before the animation has reached it: go to the end,
  // so the card that has focus can be seen.
  const onFocus = () => {
    const top = runway.getBoundingClientRect().top
    if (progressAt(top, pin) < 0.98) {
      window.scrollTo({ top: window.scrollY + top + pin, behavior: 'instant' })
      shown = 1
    }
  }

  sequence.onPicture = () => {
    drawn = ''
  }
  measure()
  canvas.dataset.armed = 'true'
  if (debugging) window.__cinematicPictures = () => sequence.stats().decoded
  onScreen.observe(runway)
  window.addEventListener('resize', measure)
  holder.addEventListener('focusin', onFocus)

  return () => {
    cancelAnimationFrame(request)
    onScreen.disconnect()
    window.removeEventListener('resize', measure)
    holder.removeEventListener('focusin', onFocus)
    delete canvas.dataset.armed
    context.clearRect(0, 0, canvas.width, canvas.height)
    holder.style.opacity = ''
    holder.style.pointerEvents = ''
    holder.style.removeProperty('-webkit-mask-image')
    holder.style.removeProperty('mask-image')
    light.style.opacity = '0'
  }
}

// Measurements for the prototype, published only when the address asks for them (?cinematic-debug).
const debugging = new URLSearchParams(window.location.search).has('cinematic-debug')
declare global {
  interface Window {
    __cinematic?: Record<string, unknown>
    __cinematicPictures?: () => number
  }
}
