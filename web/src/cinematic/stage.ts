/*
 * The scroll-controlled stage: loads the frames for this window's layout
 * and, once armed, draws the frame that belongs to the scroll position.
 *
 * This file is only fetched by browsers that are going to run the effect
 * (see CinematicDeals), so it costs the others nothing.
 */
import type { HomepageBlock } from '../lib/homepage'
import { coverGame } from '../lib/coverArt'
import { arrival, panelsPlacement, showroomFits, between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, placed, progressAt, type Placement, type Rect, type Size } from './fit'
import { LAYOUTS, type LayoutName } from './layouts'
import { loadSequence, type Sequence } from './sequence'

/** Which set of frames (a folder under /cinematic) this build of the site uses. VITE_CINEMATIC_VERSION picks another, for trying a set locally. */
export const VERSION: string = import.meta.env.VITE_CINEMATIC_VERSION ?? 'v1-blockout'
const BASE = `/cinematic/${VERSION}`

/** The cases may sit this far from the real covers, in pixels, and still be faded straight into them. */
const SEAMLESS_WITHIN = 1
/** How quickly the picture catches up with the scroll position, in milliseconds: long enough to smooth a mouse wheel's steps, short enough to feel direct. */
const CATCH_UP_MS = 90
/** A case's own edge may show this far around its front, in pixels; it is let go of as the corners are rounded. */
const CASE_RIM = 3

/** A product's picture in the last frame of a showroom: which game it shows, and its four corners (top left, top right, bottom right, bottom left) as fractions of the frame. */
export interface Panel {
  game: string
  quad: [number, number][]
}

interface Layout {
  frames: number
  width: number
  height: number
  /** With {frame} where the three-digit frame number goes. */
  path: string
  bytes: number
  travel: number
  /** Where each case's front is in the last frame, as fractions of it, and the product it was rendered for. Empty when the frames do not end on a row of cases. */
  slots: (Rect & { slug: string })[]
  /**
   * The colour around the cases in each frame, when it is not the page's
   * in all of them: a colour-graded frame's wall is darker than the page
   * until the grade lets go. Used to fill the stage around a frame that
   * no longer covers all of it.
   */
  backdrops?: string[]
  /**
   * For a showroom: frames that end on the products themselves, each on a
   * panel. The last frame then stays, and the panels are what is pressed
   * (see Showroom.tsx); nothing lands on the cards or gives way to them.
   */
  panels?: Panel[]
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
  /** In a showroom, the box over the stage that holds an item for each panel; null otherwise. */
  hotspots: HTMLElement | null
}

export interface Armed {
  /** The panels to put the products on, when the frames are a showroom. */
  panels: Panel[] | null
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

  // A showroom shows particular games. It is only used when they are the
  // block's products, all of them and no others: otherwise a panel would
  // have nothing to sell, or a product no panel.
  if (layout.panels) {
    const games = products.map((product) => coverGame(product.cover_image_url))
    if (!showroomFits(games, layout.panels.map((panel) => panel.game))) return null
  }

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
    panels: layout.panels ?? null,
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

function run(show: Show, { runway, canvas, holder, spacer, hotspots }: Elements, giveUp: () => void) {
  const { layout, sequence } = show
  const showroom = layout.panels && hotspots ? { panels: layout.panels, box: hotspots } : null
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
  let radius = 0 // how round the cards' covers are at the top, in pixels

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
    cover = coverPlacement(frame, stage)
    drawn = ''

    // Frames that do not end on a row of cases (a filmed or generated shot,
    // say) list no slots. There is nothing to land on the cards, so the
    // frame stays where it is and gives way to the block in a dissolve.
    if (layout.slots.length === 0) {
      handoff = cover
      offBy = []
      seamless = false
      radius = 0
      if (showroom) {
        // The frame comes to rest with every panel inside the window (it is
        // eased there as the camera arrives), and the items go where the
        // panels then are.
        const xs = showroom.panels.flatMap((panel) => panel.quad.map(([x]) => x))
        handoff = panelsPlacement(frame, stage, Math.min(...xs), Math.max(...xs))
        placeHotspots(showroom.panels, showroom.box)
      }
      return
    }

    const images = [...holder.querySelectorAll('li img')].slice(0, layout.slots.length)
    const covers = images.map((image) => {
      const at = image.getBoundingClientRect()
      return { x: at.left - box.left, y: at.top - box.top, w: at.width, h: at.height }
    })
    // The cards are not where they were expected: leave the block as it is.
    if (covers.length < layout.slots.length) return giveUp()

    handoff = handoffPlacement(frame, layout.slots, covers)
    offBy = mismatches(frame, layout.slots, covers, handoff)
    seamless = show.sameProducts && Math.max(...offBy) <= SEAMLESS_WITHIN
    radius = parseFloat(getComputedStyle(images[0]).borderTopLeftRadius) || 0
  }

  /** Puts each panel's item where the panel is drawn, and its details where they stay on the stage. */
  const placeHotspots = (panels: Panel[], box: HTMLElement) => {
    for (const item of box.querySelectorAll<HTMLElement>('[data-panel]')) {
      const corners = panels[Number(item.dataset.panel)].quad.map(([x, y]) => [x * frame.width * handoff.scale + handoff.x, y * frame.height * handoff.scale + handoff.y])
      const left = Math.min(...corners.map(([x]) => x))
      const top = Math.min(...corners.map(([, y]) => y))
      const width = Math.max(...corners.map(([x]) => x)) - left
      item.style.left = `${left.toFixed(1)}px`
      item.style.top = `${top.toFixed(1)}px`
      item.style.width = `${width.toFixed(1)}px`
      item.style.height = `${(Math.max(...corners.map(([, y]) => y)) - top).toFixed(1)}px`
      // The details sit under the middle of the panel, moved in from the stage's edge where they would cross it.
      const wide = (item.lastElementChild as HTMLElement).offsetWidth
      const wanted = Math.min(Math.max(left + width / 2 - wide / 2, 12), stage.width - wide - 12)
      item.style.setProperty('--details-left', `${(wanted - left).toFixed(1)}px`)
    }
  }

  const draw = (progress: number) => {
    const phase = phases(progress, seamless)
    const arrived = showroom ? arrival(progress) : 0
    // In a showroom the frame never gives way and the block never appears.
    const { settle, rounding } = phase
    const frameAlpha = showroom ? 1 : phase.frameAlpha
    const cardsAlpha = showroom ? 0 : phase.cardsAlpha
    const index = frameAt(progress, layout.travel, layout.frames)
    const picture = sequence.picture(index)
    const at = between(cover, handoff, settle)

    // Nothing is drawn again unless what would be drawn has changed.
    const state = [index, at.scale.toFixed(4), at.x.toFixed(1), at.y.toFixed(1), frameAlpha.toFixed(3), cardsAlpha.toFixed(3), rounding.toFixed(3), arrived.toFixed(3)].join()
    if (state === drawn) return
    drawn = state

    const density = canvas.width / stage.width
    context.globalAlpha = 1
    context.fillStyle = layout.backdrops?.[index] ?? show.background
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (picture && frameAlpha > 0) {
      context.globalAlpha = frameAlpha
      context.imageSmoothingQuality = 'high'
      // Cards whose covers have rounded top corners: once the cases have
      // landed, only as much of each is drawn as its cover's shape allows,
      // the corners rounding a little at a time. Around them is the flat
      // colour the stage was just filled with.
      const shaped = radius > 0 && rounding > 0
      if (shaped) {
        const spare = CASE_RIM * (1 - rounding)
        context.save()
        context.beginPath()
        for (const slot of layout.slots) {
          const box = placed(frame, slot, at)
          roundedTop(context, (box.x - spare) * density, (box.y - spare) * density, (box.w + 2 * spare) * density, (box.h + 2 * spare) * density, radius * rounding * density)
        }
        context.clip()
      }
      context.drawImage(picture, at.x * density, at.y * density, frame.width * at.scale * density, frame.height * at.scale * density)
      if (shaped) context.restore()
      // A showroom's frame that has been eased back no longer reaches the
      // top and bottom of the stage. Its own first and last rows are drawn
      // out to the edges, so ceiling and floor simply carry on.
      if (showroom && at.y > 0) {
        const [x, wide, tall] = [at.x * density, frame.width * at.scale * density, at.y * density]
        context.drawImage(picture, 0, 0, picture.width, 1, x, 0, wide, tall + 1)
        context.drawImage(picture, 0, picture.height - 1, picture.width, 1, x, canvas.height - tall - 1, wide, tall + 1)
      }
    }

    // The real block is always in the page (for screen readers and the
    // keyboard); until it shows, it just cannot be clicked by accident.
    holder.style.opacity = String(cardsAlpha)
    holder.style.pointerEvents = cardsAlpha < 0.5 ? 'none' : ''
    if (showroom) {
      showroom.box.style.opacity = String(arrived)
      showroom.box.style.setProperty('--panel-pointer', arrived < 0.5 ? 'none' : 'auto')
    }

    if (debugging) {
      window.__cinematic = {
        version: VERSION, layout: show.name, progress, frame: index, handoff: showroom ? 'showroom' : seamless ? 'seamless' : 'dissolve',
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
  // What is reached with the keyboard: the block, or in a showroom the panels,
  // which stand in for it. The block is then taken out of the way entirely.
  const reached = showroom ? showroom.box : holder
  if (showroom) {
    holder.inert = true
    holder.style.visibility = 'hidden'
    holder.style.position = 'absolute'
  }
  measure()
  canvas.dataset.armed = 'true'
  if (debugging) window.__cinematicPictures = () => sequence.stats().decoded
  onScreen.observe(runway)
  window.addEventListener('resize', measure)
  reached.addEventListener('focusin', onFocus)

  return () => {
    cancelAnimationFrame(request)
    onScreen.disconnect()
    window.removeEventListener('resize', measure)
    reached.removeEventListener('focusin', onFocus)
    holder.inert = false
    holder.style.visibility = ''
    holder.style.position = ''
    delete canvas.dataset.armed
    context.clearRect(0, 0, canvas.width, canvas.height)
    holder.style.opacity = ''
    holder.style.pointerEvents = ''
  }
}

/** Adds to the path a rectangle whose two top corners are rounded. */
function roundedTop(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.moveTo(x, y + h)
  context.lineTo(x, y + r)
  context.arcTo(x, y, x + r, y, r)
  context.lineTo(x + w - r, y)
  context.arcTo(x + w, y, x + w, y + r, r)
  context.lineTo(x + w, y + h)
  context.closePath()
}

// Measurements for the prototype, published only when the address asks for them (?cinematic-debug).
const debugging = new URLSearchParams(window.location.search).has('cinematic-debug')
declare global {
  interface Window {
    __cinematic?: Record<string, unknown>
    __cinematicPictures?: () => number
  }
}
