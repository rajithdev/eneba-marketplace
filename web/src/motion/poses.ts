/*
 * The arithmetic of the homepage's scroll effects, kept free of the browser
 * so it can be tested: given where something is in the window, how it is
 * drawn. Every answer depends on the position alone, never on the direction
 * or speed of scrolling, so scrolling back up undoes exactly what scrolling
 * down did.
 */
import { clamp, smoothstep } from '../lib/curves'

/** Starts quickly and settles gently. */
const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * The point of the featured artwork that the zoom grows from, as shares of
 * its width and height: the foot of the tree, which therefore stays put
 * while everything around it moves.
 */
export const HERO_FOCUS = { x: 0.62, y: 0.4 }
/** How much larger the artwork has become by the time the banner has left: 12%. */
const HERO_ZOOM = 0.12
/**
 * How far down its banner the artwork has slid by then, as a share of its
 * height. Sliding down inside a banner that is moving up is what makes it
 * travel more slowly than the text. It must stay under HERO_ZOOM x
 * HERO_FOCUS.y, the room the zoom makes above the picture; more would
 * uncover the banner behind the picture's top edge.
 */
const HERO_DRIFT = 0.045
/** How far the banner's text has risen by then, in pixels. */
const HERO_LIFT = 44

/**
 * The featured banner as it scrolls away. `scrolled` is how far the page has
 * been scrolled; `leavesAt` is the scroll position at which the banner's foot
 * reaches the top of the window. `copyTop` and `copyBottom` are where the
 * banner's text has its place, measured down from the top of the window.
 */
export function heroPose(scrolled: number, leavesAt: number, copyTop: number, copyBottom: number) {
  const progress = leavesAt > 0 ? clamp(scrolled / leavesAt, 0, 1) : 0
  const lift = -HERO_LIFT * progress
  // How much of the text, risen as it is, is still below the top of the window.
  const inView = copyBottom > copyTop ? clamp((copyBottom + lift) / (copyBottom - copyTop), 0, 1) : 1

  return {
    /** 0 with the page at its top, 1 once the banner has left. */
    progress,
    zoom: 1 + HERO_ZOOM * progress,
    /** In percent of the artwork's own height. */
    drift: HERO_DRIFT * 100 * progress,
    lift,
    /**
     * The text stays whole while most of it is in view: a half-faded
     * button in the middle of the window would look switched off. It
     * fades over its last 60% of leaving, and is gone when it has left.
     */
    copyAlpha: smoothstep(0, 0.6, inView),
  }
}

/** A card arrives while its top edge climbs this share of the window's height from the window's foot. */
const RISE = 0.4
/** Each card in a row starts this much later than the one on its left, */
const STAGGER = 0.1
/** and takes this much of the climb, so the sixth is in place as the climb ends. */
const SPAN = 0.5
/**
 * A card starts to recede when its top edge comes within this share of the
 * window's height of the top of the window, and has receded fully when its
 * foot gets there. Lower down, in plain view, it is left alone.
 */
const LEAVE = 0.1

/**
 * A card of the best sellers row. `top` and `bottom` are where the card's
 * place in the grid is, measured down from the top of the window (its place,
 * not the card as drawn: the card is moved, its place never is). `column` is
 * how many cards are to its left in its row.
 *
 * Arriving: it starts 32px low, leaning 9 degrees back and transparent, and
 * stands up into its place. Its text follows the picture in. Leaving at the
 * top: it shrinks a little, falls slightly behind the page and dims, as
 * something left behind does.
 */
export function cardPose(top: number, bottom: number, windowHeight: number, column: number) {
  const climbed = (windowHeight - top) / (windowHeight * RISE)
  const arrived = easeOut(clamp((climbed - column * STAGGER) / SPAN, 0, 1))
  const left = smoothstep(0, 1, 1 - bottom / (bottom - top + windowHeight * LEAVE))

  return {
    /** Exactly as the page lays it out: nothing to apply. */
    resting: arrived === 1 && left === 0,
    /** Pixels below its place. */
    drop: (1 - arrived) * 32 + left * 18,
    /** Degrees leaned back, about its foot. */
    tilt: (1 - arrived) * 9,
    scale: 1 - 0.06 * left,
    alpha: arrived * (1 - 0.7 * left),
    /** The title and price: they start once the card is nearly half way in. */
    info: smoothstep(0.45, 1, arrived),
  }
}
