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
 * lit (1 is fully), how much of the lettering on its spine is inked in (a
 * spine seen almost edge-on would only show a row of specks), how much it
 * is the chosen case (1 in the middle, 0 by the time it is a neighbour:
 * the lit rim of the chosen case).
 */
export interface Pose {
  x: number
  z: number
  turn: number
  light: number
  ink: number
  focus: number
}

// The cases stand in an arc that opens toward the visitor: the chosen one in the middle and nearest,
// the others stepping back and aside along each arm, turned to face the middle.
// The first neighbour on either side of the chosen case...
const FIRST_X = 1.2
const FIRST_Z = -1.3
const FIRST_TURN = 33
// ...and each case after it: this much further out, further back and a little more turned.
const GAP = 0.96
const DEPTH = 1.45
const MAX_TURN = 50
const TURN_EASE = 3
// The chosen case is turned enough to show its spine, and turns this fast (degrees a place) as it leaves the middle.
const SHOWN_SPINE = 22
const THROUGH = 18
// Light falls off with distance: the first neighbour keeps this much, and each further case loses a share of what is left.
const FIRST_LIGHT = 0.84
const LIGHT_EASE = 4.2
const DARKEST = 0.2
// A spine's lettering appears as the case turns from this angle to that one.
const INK_FROM = 24
const INK_FULL = 32
// A case stops being the chosen one this far from the middle.
const FOCUS_ENDS = 0.7

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** From 0 to 1 as `t` goes from 0 to 1, starting and stopping gently; 0 before and 1 after. */
function smooth(t: number) {
  const within = clamp(t, 0, 1)

  return within * within * (3 - 2 * within)
}

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
  // How fast a case is still turning as it reaches the first place: the pace the rest of the row carries on at.
  const settling = (MAX_TURN - FIRST_TURN) / TURN_EASE
  // Left of the middle a case turns its cover to the right, toward the middle; right of it, to the left.
  // Both sides start from the chosen case's own turn at the same pace, so a case passing the middle turns steadily and never back.
  const turn = side < 0 ? curve(near, SHOWN_SPINE, THROUGH, FIRST_TURN, settling) + turnBeyond : curve(near, SHOWN_SPINE, -THROUGH, -FIRST_TURN, -settling) - turnBeyond

  return {
    // Straight through the middle at a steady speed, then easing into the row's own step.
    x: side * (curve(near, 0, (3 * FIRST_X - GAP) / 2, FIRST_X, GAP) + beyond * GAP),
    z: curve(near, 0, 0, FIRST_Z, -DEPTH) - beyond * DEPTH,
    turn,
    ink: clamp((Math.abs(turn) - INK_FROM) / (INK_FULL - INK_FROM), 0, 1),
    light: Math.max(DARKEST, curve(near, 1, 0, FIRST_LIGHT, -FIRST_LIGHT / LIGHT_EASE) * Math.exp(-beyond / LIGHT_EASE)),
    // Eased in and out, so the rim never switches on.
    focus: smooth(1 - far / FOCUS_ENDS),
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

/** How many cases either side of the chosen one are drawn. Further ones are too small and too dark to be seen. */
export const REACH = 7

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
