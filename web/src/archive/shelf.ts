/*
 * The arithmetic of the Game Archive's shelf: where a case stands for how
 * far it is from the middle, which case a scroll position means, and which
 * cases are worth drawing. Nothing here touches the browser, so all of it
 * is unit-tested (shelf.test.ts).
 *
 * Lengths are in case widths, so the same shelf fits any window: the stage
 * multiplies by the width it gave the cases.
 */

/**
 * How a case stands: sideways from the middle and toward the viewer (both
 * in case widths), turned about its upright axis (degrees), how brightly
 * lit (1 is fully), and how much of the lettering on its spine is inked in
 * (the chosen case shows its spine almost edge-on, where lettering would
 * only be a row of specks).
 */
export interface Pose {
  x: number
  z: number
  turn: number
  light: number
  ink: number
}

// The first neighbour on either side of the chosen case...
const FIRST_X = 1.05
const FIRST_Z = -0.95
const FIRST_TURN = 56
// ...and each case after it: this much further out, further back and more edge-on.
const GAP = 0.5
const DEPTH = 0.5
const MAX_TURN = 74
const TURN_EASE = 4
// The chosen case stands a little forward of the row, turned just enough to show its spine.
const LIFT = 0.3
const SHOWN_SPINE = 9
// Light falls off with distance: the first neighbour keeps this much, and each further case loses a share of what is left.
const FIRST_LIGHT = 0.72
const LIGHT_EASE = 5
const DARKEST = 0.16
// A spine's lettering appears as the case turns from this angle to that one.
const INK_FROM = 14
const INK_FULL = 34

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** A smooth curve from `from` (leaving at slope `fromSlope`) to `to` (arriving at slope `toSlope`), for t from 0 to 1. */
function curve(t: number, from: number, fromSlope: number, to: number, toSlope: number) {
  const t2 = t * t
  const t3 = t2 * t

  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * fromSlope + (-2 * t3 + 3 * t2) * to + (t3 - t2) * toSlope
}

/**
 * Where the case `offset` places from the middle stands (-1.5: halfway
 * between the first and second case on the left).
 *
 * Between the middle and the first neighbour a case swings round, steps
 * back and moves aside; beyond it the row simply carries on, a fixed step
 * per case. The two parts meet at the same speed, so a case passing the
 * first place neither stops nor jumps as the shelf is scrolled.
 */
export function poseAt(offset: number): Pose {
  const side = Math.sign(offset)
  const far = Math.abs(offset)
  const near = Math.min(far, 1)
  const beyond = far - near
  const turnBeyond = (MAX_TURN - FIRST_TURN) * (1 - Math.exp(-beyond / TURN_EASE))
  // Left of the middle a case turns its cover to the right, toward the middle; right of it, to the left.
  // The chosen case's own slight turn is let go of by the first place, gently at both ends, so the turning never changes pace abruptly.
  const turn = SHOWN_SPINE * (1 - near * near) ** 2 - side * (curve(near, 0, (3 * FIRST_TURN - (MAX_TURN - FIRST_TURN) / TURN_EASE) / 2, FIRST_TURN, (MAX_TURN - FIRST_TURN) / TURN_EASE) + turnBeyond)

  return {
    // Straight through the middle at a steady speed, then easing into the row's own step.
    x: side * (curve(near, 0, (3 * FIRST_X - GAP) / 2, FIRST_X, GAP) + beyond * GAP),
    z: curve(near, LIFT, 0, FIRST_Z, -DEPTH) - beyond * DEPTH,
    turn,
    ink: clamp((Math.abs(turn) - INK_FROM) / (INK_FULL - INK_FROM), 0, 1),
    light: Math.max(DARKEST, curve(near, 1, 0, FIRST_LIGHT, -FIRST_LIGHT / LIGHT_EASE) * Math.exp(-beyond / LIGHT_EASE)),
  }
}

/** How many pixels of scrolling move the shelf along by one case: about one notch of a mouse wheel. */
export const STEP = 96

/** Where on the shelf a scroll distance into the runway is: 2.5 is halfway from the third case to the fourth. */
export function placeAt(scrolled: number, count: number): number {
  return count > 0 ? clamp(scrolled / STEP, 0, count - 1) : 0
}

/** How far into the runway the page has to be scrolled for a case to be the chosen one. */
export const scrollFor = (index: number) => index * STEP

/** How long the runway is beyond the stage itself: the scrolling it takes to go from the first case to the last. */
export const travel = (count: number) => Math.max(count - 1, 0) * STEP

/** How many cases either side of the chosen one are drawn. Further ones are too dark and too small to be seen. */
export const REACH = 9

/** The first and last case worth drawing around a place on the shelf. */
export function drawnAround(place: number, count: number): [first: number, last: number] {
  const middle = Math.round(place)

  return [Math.max(middle - REACH, 0), Math.min(middle + REACH, count - 1)]
}

/**
 * One step of the picture catching up with where it should be: most of the
 * way there, more the longer it has been since the last step, and exactly
 * there once the difference could not be seen.
 */
export function approach(shown: number, goal: number, elapsedMs: number, catchUpMs: number): number {
  const next = goal + (shown - goal) * Math.exp(-elapsedMs / catchUpMs)

  return Math.abs(next - goal) < 0.001 ? goal : next
}

/** The case a key press moves to, or null for a key the shelf does not use. */
export function keyTarget(key: string, selected: number, count: number): number | null {
  const moves: Record<string, number> = { ArrowLeft: selected - 1, ArrowRight: selected + 1, PageUp: selected - 5, PageDown: selected + 5, Home: 0, End: count - 1 }

  return key in moves && count > 0 ? clamp(moves[key], 0, count - 1) : null
}

/** "007" for the seventh of 71 or of 150: as many digits as the count needs, three at least, like a shelf mark. */
export function shelfMark(position: number, count: number): string {
  return String(position).padStart(Math.max(3, String(count).length), '0')
}
