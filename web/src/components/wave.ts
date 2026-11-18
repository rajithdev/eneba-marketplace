/*
 * The curve of the store's entrance, shared by what draws it: the lit line
 * (WaveEdge.tsx), the mask on the store's canvas (cinematic/stage.ts) and
 * the deals band's top edge (HomeBlocks.tsx).
 *
 * The curve is drawn once, in a box 1000 wide and 100 tall, and stretched
 * to whatever width and depth it is given (preserveAspectRatio="none").
 */

/** From the left edge (0, 0) down to the middle (500, 100) and back up; flat at both ends and in the middle, so it meets the sides and turns without a corner. */
export const WAVE_PATH = 'M0 0 C200 0 300 100 500 100 S800 0 1000 0'

/**
 * A mask that hides what is above the curve and shows what is below it,
 * with a soft step a third of the curve's depth tall just under the line.
 * It is 1.4 times as tall as the curve is deep; below it, a second layer
 * shows everything (see waveMask).
 */
const MASK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 140" preserveAspectRatio="none">' +
  '<filter id="soft" x="-10%" y="-50%" width="120%" height="300%"><feGaussianBlur stdDeviation="8"/></filter>' +
  '<path filter="url(#soft)" d="M-60 10 L0 10 C200 10 300 110 500 110 S800 10 1000 10 L1060 10 L1060 400 L-60 400 Z"/>' +
  '</svg>'
const MASK_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(MASK_SVG)}")`

/**
 * The CSS `mask` for an element whose top edge is cut to the curve, the
 * curve hanging `depth` (a CSS length) in the middle. The second layer
 * starts a pixel before the first ends, so no hairline is left between them.
 */
export function waveMask(depth: string) {
  const tall = `calc(${depth} * 1.4)`
  return `${MASK_IMAGE} 0 0 / 100% ${tall} no-repeat, linear-gradient(#000, #000) 0 calc(${tall} - 1px) / 100% 100% no-repeat`
}

/**
 * How deep the curve hangs where it stays put (no store scene: phones,
 * tablets, reduced motion): 7.5% of the window's width, between 32px and
 * 140px. The same rule as the entrance's at its fullest (cinematic/fit.ts).
 */
export const RESTING_DEPTH = 'clamp(32px, 7.5vw, 140px)'
