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
 * sweep      0..1: how far a band of light has crossed the row, or null
 *            when there is none.
 *
 * Seamless: the cards fade in over cases that sit exactly under them, so
 * the picture does not seem to change. Otherwise the cases show other
 * covers than the cards, or sit a little off them, and fading one into
 * the other in place would look like one product turning into another.
 * So a band of light crosses the row instead: ahead of it the cases,
 * behind it the real cards, the two easing into each other only inside
 * the light (see sweepEdge). The frame and the block both stay solid;
 * where each one shows is decided by the light.
 */
export function phases(progress: number, seamless: boolean) {
  const sweep = seamless ? null : smoothstep(0.875, 0.985, progress)

  return {
    settle: smoothstep(0.68, 0.86, progress),
    frameAlpha: sweep === 1 ? 0 : 1,
    cardsAlpha: sweep === null ? smoothstep(0.9, 0.98, progress) : sweep > 0 ? 1 : 0,
    sweep,
  }
}

/** How wide the stretch is in which cases and cards ease into each other, for a row this wide. */
export const sweepSoftness = (rowWidth: number) => rowWidth * 0.1

/**
 * Where the light's leading edge is, in stage pixels. Right of it only the
 * cases show; `soft` pixels left of it and beyond, only the cards. It
 * starts with nothing of the row revealed and ends with all of it.
 */
export function sweepEdge(sweep: number, rowLeft: number, rowRight: number, soft: number) {
  const margin = soft / 2

  return rowLeft - margin + sweep * (rowRight - rowLeft + soft + 2 * margin)
}
