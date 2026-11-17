/*
 * The scroll-controlled stage: loads the frames for this window's layout
 * and, once armed, draws the frame that belongs to the scroll position.
 *
 * This file is only fetched by browsers that are going to run the effect
 * (see CinematicDeals), so it costs the others nothing.
 */
import type { HomepageBlock } from '../lib/homepage'
import { between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, progressAt, type Placement, type Rect, type Size } from './fit'
import { LAYOUTS, type LayoutName } from './layouts'
import { loadSequence, type Sequence } from './sequence'

/** Which set of frames (a folder under /cinematic) this build of the site uses. */
export const VERSION = 'v1-blockout'
const BASE = `/cinematic/${VERSION}`

/** The cases may sit this far from the real covers, in pixels, and still be faded straight into them. */
const SEAMLESS_WITHIN = 1
/** How quickly the picture catches up with the scroll position, in milliseconds: long enough to smooth a mouse wheel's steps, short enough to feel direct. */
const CATCH_UP_MS = 90

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

function run(show: Show, { runway, canvas, holder, spacer }: Elements, giveUp: () => void) {
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
