/*
 * Two small pieces of arithmetic shared by everything that follows the
 * scroll position: the store's scroll section (cinematic/fit.ts) and the
 * homepage's scroll effects (motion/poses.ts).
 */

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** 0 below `from`, 1 above `to`, an S-curve between: starts and ends gently. */
export function smoothstep(from: number, to: number, value: number) {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}
