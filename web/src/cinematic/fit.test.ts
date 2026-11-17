import { describe, expect, it } from 'vitest'
import { between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, progressAt, sweepEdge, sweepSoftness, type Rect } from './fit'

const frame = { width: 640, height: 360 }

/** Six covers in a row, as the page lays them out: each `width` wide, `gap` apart, starting at (left, top). */
const row = (count: number, left: number, top: number, width: number, gap: number): Rect[] =>
  Array.from({ length: count }, (_, index) => ({ x: left + index * (width + gap), y: top, w: width, h: (width * 4) / 3 }))

/** The same row as fractions of a frame, as Blender reports it. */
const asSlots = (covers: Rect[], scale: number, dx: number, dy: number): Rect[] =>
  covers.map((cover) => ({ x: (cover.x * scale + dx) / frame.width, y: (cover.y * scale + dy) / frame.height, w: (cover.w * scale) / frame.width, h: (cover.h * scale) / frame.height }))

describe('scroll arithmetic', () => {
  it('turns the section position into progress from 0 to 1 and no further', () => {
    expect(progressAt(300, 2000)).toBe(0) // still below the top of the window
    expect(progressAt(-500, 2000)).toBe(0.25)
    expect(progressAt(-5000, 2000)).toBe(1)
  })

  it('advances frames during the travel and holds the last one after it', () => {
    expect(frameAt(0, 0.86, 96)).toBe(0)
    expect(frameAt(0.43, 0.86, 96)).toBe(48)
    expect(frameAt(0.86, 0.86, 96)).toBe(95)
    expect(frameAt(1, 0.86, 96)).toBe(95)
  })

  it('gives the same frame for the same position whichever way it was reached', () => {
    const down = [0.1, 0.2, 0.3].map((progress) => frameAt(progress, 0.86, 96))
    const up = [0.3, 0.2, 0.1].map((progress) => frameAt(progress, 0.86, 96)).reverse()
    expect(up).toEqual(down)
  })
})

describe('placing the frame', () => {
  it('covers the stage, centred, whatever its shape', () => {
    expect(coverPlacement(frame, { width: 1440, height: 900 })).toEqual({ scale: 2.5, x: -80, y: 0 })
    expect(coverPlacement(frame, { width: 1280, height: 600 })).toEqual({ scale: 2, x: 0, y: -60 })
  })

  it('lays the row of cases exactly on covers that have the proportions it was rendered for', () => {
    const covers = row(6, 96, 300, 192, 18)
    const slots = asSlots(covers, 0.4, 20, 10)
    const at = handoffPlacement(frame, slots, covers)

    expect(at.scale).toBeCloseTo(2.5)
    expect(Math.max(...mismatches(frame, slots, covers, at))).toBeLessThan(0.001)
  })

  it('reports how far off the cases are when the page spaces its cards differently', () => {
    const rendered = row(6, 96, 300, 192, 18)
    const slots = asSlots(rendered, 0.4, 20, 10)
    const narrower = row(6, 16, 300, 150, 18) // the same 18px gap around smaller cards
    const off = mismatches(frame, slots, narrower, handoffPlacement(frame, slots, narrower))

    expect(Math.max(...off)).toBeGreaterThan(1)
  })

  it('moves evenly from one placement to another', () => {
    expect(between({ scale: 1, x: 0, y: 0 }, { scale: 3, x: 10, y: -20 }, 0.5)).toEqual({ scale: 2, x: 5, y: -10 })
  })
})

describe('what is on screen', () => {
  it('shows only the frame during the travel and only the cards at the end', () => {
    expect(phases(0.3, true)).toEqual({ settle: 0, frameAlpha: 1, cardsAlpha: 0, sweep: null })
    expect(phases(0.3, false)).toEqual({ settle: 0, frameAlpha: 1, cardsAlpha: 0, sweep: 0 })
    expect(phases(1, true).cardsAlpha).toBe(1)
    expect(phases(1, false)).toMatchObject({ frameAlpha: 0, cardsAlpha: 1, sweep: 1 })
  })

  it('starts the light only once the frame has settled on the cards, and finishes before the section lets go', () => {
    expect(phases(0.86, false)).toMatchObject({ settle: 1, sweep: 0, cardsAlpha: 0 })
    expect(phases(0.93, false)).toMatchObject({ frameAlpha: 1, cardsAlpha: 1 })
    expect(phases(0.93, false).sweep).toBeCloseTo(0.5)
    expect(phases(0.99, false).sweep).toBe(1)
  })

  it('moves the light the same way forwards and backwards, never jumping', () => {
    const positions = Array.from({ length: 101 }, (_, step) => phases(step / 100, false).sweep!)
    for (let step = 1; step <= 100; step++) {
      expect(positions[step]).toBeGreaterThanOrEqual(positions[step - 1])
      expect(positions[step] - positions[step - 1]).toBeLessThan(0.15)
    }
  })

  it('reveals nothing of the row before the light and all of it after', () => {
    const [left, right] = [96, 1344]
    const soft = sweepSoftness(right - left)

    expect(sweepEdge(0, left, right, soft)).toBeLessThan(left) // cards show only left of (edge - soft)
    expect(sweepEdge(1, left, right, soft) - soft).toBeGreaterThan(right)
    expect(sweepEdge(0.5, left, right, soft) - soft / 2).toBeCloseTo((left + right) / 2) // half way: the light is over the middle of the row
  })
})
