/*
 * The scroll-controlled stage: loads the frames for this window's layout
 * and, once armed, draws the frame that belongs to the scroll position.
 *
 * This file is only fetched by browsers that are going to run the effect
 * (see CinematicDeals), so it costs the others nothing.
 */
import type { HomepageBlock } from '../lib/homepage'
import { between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, progressAt, type Placement, type Rect, type Size } from './fit'
import { loadSequence, type Sequence } from './sequence'

/** Which set of frames (a folder under /cinematic) this build of the site uses. */
export const VERSION = 'v0-blockout'
const BASE = `/cinematic/${VERSION}`

/** The cases may sit this far from the real covers, in pixels, and still be faded straight into them. */
const SEAMLESS_WITHIN = 1
/** How quickly the picture catches up with the scroll position, in milliseconds: long enough to smooth a mouse wheel's steps, short enough to feel direct. */
const CATCH_UP_MS = 90

interface Layout {
  minWidth?: number
  maxWidth?: number
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
}

export interface Armed {
  /** How many pixels of scrolling the animation lasts. */
  pin: number
  /** Starts drawing; returns the function that stops it. `giveUp` is called if the effect can no longer run here. */
  run(elements: Elements, giveUp: () => void): () => void
  dispose(): void
}

const layoutFor = (manifest: Manifest, width: number) =>
  Object.entries(manifest.layouts).find(([, layout]) => width >= (layout.minWidth ?? 0) && width <= (layout.maxWidth ?? Infinity))

/**
 * Fetches the manifest and the coarse pass of frames. Answers null when
 * there is nothing to show at this window size, for this block, or the
 * frames cannot be loaded: the caller then leaves the ordinary block alone.
 */
export async function prepare(block: HomepageBlock): Promise<Armed | null> {
  const startedAt = performance.now()
  const reply = await fetch(`${BASE}/manifest.json`)
  if (!reply.ok) return null
  const manifest = (await reply.json()) as Manifest

  const found = layoutFor(manifest, window.innerWidth)
  const products = block.data.products ?? []
  if (!found || products.length < found[1].slots.length) return null
  const [name, layout] = found

  // Were the frames rendered for the products the block holds today, in today's order?
  const sameProducts = layout.slots.every((slot, index) => products[index].slug === slot.slug)

  const frameUrl = (frame: number) => `${BASE}/${layout.path.replace('{frame}', String(frame).padStart(3, '0'))}`
  const sequence = loadSequence(frameUrl, layout.frames, name === 'wide' ? 30 : 16)
  try {
    await sequence.ready
  } catch {
    sequence.dispose()
    return null
  }
  const armedAfterMs = Math.round(performance.now() - startedAt)

  // Two and a half screens of scrolling on a desktop, two on a phone.
  const pin = Math.round(window.innerHeight * (name === 'wide' ? 2.4 : 2))

  return {
    pin,
    dispose: () => sequence.dispose(),
    run: (elements, giveUp) => run({ name, layout, background: manifest.background, sequence, sameProducts, armedAfterMs, pin }, elements, giveUp),
  }
}

interface Show {
  name: string
  layout: Layout
  background: string
  sequence: Sequence
  sameProducts: boolean
  armedAfterMs: number
  pin: number
}

function run(show: Show, { runway, canvas, holder }: Elements, giveUp: () => void) {
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

  /** Sizes the canvas to the stage and finds where the real covers are on it. */
  const measure = () => {
    const box = canvas.getBoundingClientRect()
    const density = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(box.width * density)
    canvas.height = Math.round(box.height * density)
    stage = { width: box.width, height: box.height }

    const covers = [...holder.querySelectorAll('li img')].slice(0, layout.slots.length).map((image) => {
      const at = image.getBoundingClientRect()
      return { x: at.left - box.left, y: at.top - box.top, w: at.width, h: at.height }
    })
    // The window was resized out of this layout's range, or the cards are not where they were expected.
    const fits = window.innerWidth >= (layout.minWidth ?? 0) && window.innerWidth <= (layout.maxWidth ?? Infinity)
    if (!fits || covers.length < layout.slots.length) return giveUp()

    cover = coverPlacement(frame, stage)
    handoff = handoffPlacement(frame, layout.slots, covers)
    offBy = mismatches(frame, layout.slots, covers, handoff)
    seamless = show.sameProducts && Math.max(...offBy) <= SEAMLESS_WITHIN
    drawn = ''
  }

  const draw = (progress: number) => {
    const { settle, frameAlpha, cardsAlpha } = phases(progress, seamless)
    const index = frameAt(progress, layout.travel, layout.frames)
    const picture = sequence.picture(index)
    const at = between(cover, handoff, settle)

    // Nothing is drawn again unless what would be drawn has changed.
    const state = [index, at.scale.toFixed(4), at.x.toFixed(1), at.y.toFixed(1), frameAlpha.toFixed(3), cardsAlpha.toFixed(3)].join()
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

    // The real block is always in the page (for screen readers and the
    // keyboard); until it shows, it just cannot be clicked by accident.
    holder.style.opacity = String(cardsAlpha)
    holder.style.pointerEvents = cardsAlpha < 0.5 ? 'none' : ''

    if (debugging) {
      window.__cinematic = {
        version: VERSION, layout: show.name, progress, frame: index, handoff: seamless ? 'seamless' : 'dissolve',
        sameProducts: show.sameProducts, offByPx: offBy.map((value) => Math.round(value * 100) / 100), armedAfterMs: show.armedAfterMs,
        frames: layout.frames, decodedBytesEach: layout.width * layout.height * 4, canvasPixels: canvas.width * canvas.height, ...sequence.stats(),
      }
    }
  }

  // The loop: every display frame, move the shown progress most of the way
  // to where the scroll is. It only runs while the section is on screen.
  let shown = -1
  let last = 0
  let request = 0
  const tick = (now: number) => {
    const target = progressAt(runway.getBoundingClientRect().top, show.pin)
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
    }
  })

  // Tabbing to a card before the animation has reached it: go to the end,
  // so the card that has focus can be seen.
  const onFocus = () => {
    const top = runway.getBoundingClientRect().top
    if (progressAt(top, show.pin) < 0.98) {
      window.scrollTo({ top: window.scrollY + top + show.pin, behavior: 'instant' })
      shown = 1
    }
  }

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
  sequence.onPicture = () => {
    drawn = ''
  }
  measure()
  onScreen.observe(runway)
  window.addEventListener('resize', measure)
  holder.addEventListener('focusin', onFocus)
  calm.addEventListener('change', giveUp)

  return () => {
    cancelAnimationFrame(request)
    onScreen.disconnect()
    window.removeEventListener('resize', measure)
    holder.removeEventListener('focusin', onFocus)
    calm.removeEventListener('change', giveUp)
    holder.style.opacity = ''
    holder.style.pointerEvents = ''
  }
}

// Measurements for the prototype, published only when the address asks for them (?cinematic-debug).
const debugging = new URLSearchParams(window.location.search).has('cinematic-debug')
declare global {
  interface Window {
    __cinematic?: Record<string, unknown>
  }
}
