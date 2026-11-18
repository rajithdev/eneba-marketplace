/*
 * The arithmetic of the scroll-controlled section, kept free of the browser
 * so it can be tested: how far through the scroll we are, which frame that
 * is, where the frame is drawn, and how well the cases in the last frame
 * sit on the real product cards.
 */

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

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** 0 below `from`, 1 above `to`, an S-curve between: starts and ends gently. */
export function smoothstep(from: number, to: number, value: number) {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Scroll progress through the pinned stretch. `top` is how far the section's
 * top edge is below the top of the window (negative once it has scrolled
 * past); `pin` is how many pixels of scrolling the animation lasts.
 */
export const progressAt = (top: number, pin: number) => clamp(-top / pin, 0, 1)

/**
 * The frame to show. Frames advance during the first `travel` share of the
 * scroll; after that the last frame is held while the real cards appear.
 */
export const frameAt = (progress: number, travel: number, frames: number) => Math.round(clamp(progress / travel, 0, 1) * (frames - 1))

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
