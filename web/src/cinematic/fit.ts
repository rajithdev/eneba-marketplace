/*
 * The arithmetic of the scroll-controlled section, kept free of the browser
 * so it can be tested: how far through the scroll we are, which frame that
 * is, where the frame is drawn, and how well the cases in the last frame
 * sit on the real product cards.
 */
import { clamp, smoothstep } from '../lib/curves'

/** A rectangle: left, top, width, height. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  width: number
  height: number
}

/** Where a frame is drawn on the stage: its pixels times `scale`, moved by (x, y). */
export interface Placement {
  scale: number
  x: number
  y: number
}

/**
 * Scroll progress through the pinned stretch. `top` is how far the section's
 * top edge is below the top of the window (negative once it has scrolled
 * past); `pin` is how many pixels of scrolling the animation lasts.
 */
export const progressAt = (top: number, pin: number) => clamp(-top / pin, 0, 1)

/**
 * Where the scroll is among the frames, as a frame number with a fraction:
 * 12.4 is four tenths of the way from frame 12 to frame 13. Frames advance
 * during the first `travel` share of the scroll; after that the last frame
 * is held while what can be pressed appears.
 */
export const framePosition = (progress: number, travel: number, frames: number) => clamp(progress / travel, 0, 1) * (frames - 1)

/** The frame nearest to where the scroll is: the one shown once scrolling has stopped. */
export const frameAt = (progress: number, travel: number, frames: number) => Math.round(framePosition(progress, travel, frames))

/**
 * What is drawn for a position between two frames: the earlier frame, and
 * over it the later one, as solid as the position is far along (`mix`, 0
 * to 1). Moving slowly, the picture then passes from one frame into the
 * next instead of jumping.
 */
export function blendAt(position: number, frames: number) {
  // On a frame, or as good as: that frame alone.
  const whole = Math.round(position)
  if (Math.abs(position - whole) < 0.001) return { index: clamp(whole, 0, frames - 1), mix: 0 }
  const index = clamp(Math.floor(position), 0, frames - 1)

  return { index, mix: index === frames - 1 ? 0 : clamp(position - index, 0, 1) }
}

/**
 * How far the picture is from the nearest whole frame, in frames (-0.5 to
 * 0.5). Two frames laid over each other are fine in motion but soft to
 * look at, so once scrolling has stopped the picture is eased by this much,
 * onto a single sharp frame. The nearest one whichever way it was reached,
 * so the same scroll position always rests on the same picture.
 */
export const toWholeFrame = (position: number) => Math.round(position) - position

/** The frame scaled to cover the whole stage, centred (some of it may be cut off). */
export function coverPlacement(frame: Size, stage: Size): Placement {
  const scale = Math.max(stage.width / frame.width, stage.height / frame.height)
  return { scale, x: (stage.width - frame.width * scale) / 2, y: (stage.height - frame.height * scale) / 2 }
}

/**
 * The frame placed so that the row of cases in it lies on the row of real
 * card covers: the row's left and right ends meet, and its top edge.
 * `slots` are the cases' fronts as fractions of the frame (from Blender);
 * `covers` are the cards' cover pictures in stage pixels (measured).
 */
export function handoffPlacement(frame: Size, slots: Rect[], covers: Rect[]): Placement {
  const first = slots[0]
  const last = slots[slots.length - 1]
  const bakedLeft = first.x * frame.width
  const bakedRight = (last.x + last.w) * frame.width
  const realLeft = covers[0].x
  const realRight = covers[covers.length - 1].x + covers[covers.length - 1].w
  const scale = (realRight - realLeft) / (bakedRight - bakedLeft)

  return { scale, x: realLeft - bakedLeft * scale, y: covers[0].y - first.y * frame.height * scale }
}

/** Where a case's front ends up on the stage under a placement. */
export const placed = (frame: Size, slot: Rect, at: Placement): Rect => ({
  x: slot.x * frame.width * at.scale + at.x,
  y: slot.y * frame.height * at.scale + at.y,
  w: slot.w * frame.width * at.scale,
  h: slot.h * frame.height * at.scale,
})

/** How far, in pixels, each case's front is from its card's cover: the worst of its four edges. */
export function mismatches(frame: Size, slots: Rect[], covers: Rect[], at: Placement): number[] {
  return slots.map((slot, index) => {
    const box = placed(frame, slot, at)
    const cover = covers[index]

    return Math.max(
      Math.abs(box.x - cover.x),
      Math.abs(box.y - cover.y),
      Math.abs(box.x + box.w - (cover.x + cover.w)),
      Math.abs(box.y + box.h - (cover.y + cover.h)),
    )
  })
}

/** A placement part of the way from one to another. */
export const between = (from: Placement, to: Placement, t: number): Placement => ({
  scale: from.scale + (to.scale - from.scale) * t,
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
})

/**
 * What is on screen at a given progress.
 *
 * settle     0..1: how far the frame has moved from filling the stage to
 *            lying on the cards. It only starts once the camera has left
 *            the corridor, when everything around the cases is the flat
 *            page colour and moving the frame cannot be seen.
 * frameAlpha how solid the rendered frame is.
 * cardsAlpha how solid the real block (its title and cards) is.
 * rounding   0..1: how far the cases' corners have been rounded off to the
 *            shape of the covers they landed on, for cards that round
 *            theirs. It starts once the frame has settled, ahead of the
 *            cards, so no square corner is left showing around a card.
 *
 * Seamless: the cards fade in over cases that sit exactly under them, so
 * the picture does not seem to change. Otherwise a dissolve: the cases
 * fade away first, then the cards fade in, so two misplaced copies are
 * never seen at once.
 */
export function phases(progress: number, seamless: boolean) {
  return {
    settle: smoothstep(0.68, 0.86, progress),
    frameAlpha: seamless ? 1 : 1 - smoothstep(0.86, 0.93, progress),
    cardsAlpha: seamless ? smoothstep(0.9, 0.98, progress) : smoothstep(0.91, 0.99, progress),
    rounding: smoothstep(0.86, 0.93, progress),
  }
}

/**
 * In a showroom (frames that end on the products themselves, each on a
 * panel) nothing gives way to anything: the last frame stays, and what can
 * be pressed on it fades in over this stretch, once the camera has stopped.
 */
export const arrival = (progress: number) => smoothstep(0.86, 0.93, progress)

/**
 * Whether a showroom can stand in for the block: its panels show exactly
 * the games of the block's products, in any order. One product without a
 * panel, or one panel without a product, and the ordinary block is used.
 */
export const showroomFits = (games: (string | null)[], shown: string[]) => games.length === shown.length && shown.every((game) => games.includes(game))

/**
 * Where a showroom's last frame rests: covering the stage where that shows
 * every panel, and otherwise as large as still fits the row of panels (from
 * `left` to `right`, as fractions of the frame) inside the stage with a
 * little room at each side. A window narrower than the picture would cut
 * the outer panels off, and a product must never be out of reach.
 */
export function panelsPlacement(frame: Size, stage: Size, left: number, right: number, room = 0.02): Placement {
  const scale = Math.min(coverPlacement(frame, stage).scale, (stage.width * (1 - 2 * room)) / ((right - left) * frame.width))
  // The row in the middle, without uncovering either side of the stage.
  const x = clamp(stage.width / 2 - ((left + right) / 2) * frame.width * scale, stage.width - frame.width * scale, 0)

  return { scale, x, y: (stage.height - frame.height * scale) / 2 }
}

/**
 * How far the picture fades into the page at the stage's top and bottom
 * edges, in pixels. The stage is a dark picture set into a page of another
 * colour: scrolled into with a hard edge, it looks cut out of the page. So
 * while its top edge is still coming up the window the picture's top fades
 * into the page, less and less until the stage fills the window; and the
 * same at its bottom edge once the stage is let go and scrolls away.
 *
 * `top` and `bottom` are where the stage's edges are, measured down from
 * the top of the window, which is `windowHeight` tall.
 *
 * The stage now comes in behind a curved edge instead (see entrance), so
 * only `bottom` is used; `top` is the straight fade it replaced.
 */
export function softEdges(top: number, bottom: number, windowHeight: number, stageHeight: number) {
  const reach = windowHeight * 0.6 // an edge this far inside the window has its full fade
  const most = stageHeight * 0.3

  return { top: clamp(top / reach, 0, 1) * most, bottom: clamp((windowHeight - bottom) / reach, 0, 1) * most }
}

/** How deep the entrance's curve hangs in the middle, as a share of the window's width, so it keeps its shape at every width; */
const WAVE_SHARE = 0.075
/** but never shallower or deeper than this, in pixels. (RESTING_DEPTH in components/wave.ts is the same rule in CSS.) */
const WAVE_DEPTH = { least: 32, most: 140 }

/**
 * The store's entrance: the stage comes up the window behind a curved
 * edge, the best sellers above it and the store showing below it (see
 * components/WaveEdge.tsx). `top` is where the stage's top edge is,
 * measured down from the top of the window.
 *
 * depth  how far the middle of the curve hangs below the stage's top, in
 *        pixels. Full while the stage's top is in the lower 40% of the
 *        window; then less and less, so the edge rises faster in the
 *        middle than at the sides and flattens out, until it is 0 as the
 *        stage reaches the top of the window. That is where the camera
 *        starts to move, so it starts with nothing hidden.
 * glow   how bright the lit line along the curve is, 0 to 1: it goes out
 *        over the last 30% of the window, a little ahead of the curve.
 *
 * Like everything that follows the scroll, it depends on the position
 * alone, so scrolling back up undoes it exactly.
 */
export function entrance(top: number, windowHeight: number, width: number) {
  const full = clamp(width * WAVE_SHARE, WAVE_DEPTH.least, WAVE_DEPTH.most)

  return { depth: full * smoothstep(0, windowHeight * 0.6, top), glow: smoothstep(0, windowHeight * 0.3, top) }
}

/**
 * How dark the page around the stage is, from 0 (as it always is) to 1 (the
 * store's own darkness). The stage is a dark room set into a lighter page;
 * with this, the page dims as the room comes up the window, so by the time
 * the room fills the window there is no brighter page left around it to
 * cross a line from. It lets go the same way once the stage scrolls away.
 *
 * `top` and `bottom` are the section's edges, measured down from the top of
 * the window. The dimming takes three quarters of a window of scrolling.
 */
export function dusk(top: number, bottom: number, windowHeight: number) {
  const reach = windowHeight * 0.75

  return smoothstep(0, reach, reach - top) * (1 - smoothstep(0, reach, windowHeight - bottom))
}
