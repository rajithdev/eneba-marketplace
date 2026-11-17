import { describe, expect, it } from 'vitest'
import { between, coverPlacement, frameAt, handoffPlacement, mismatches, phases, progressAt, type Rect } from './fit'

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
    expect(phases(0.3, true)).toEqual({ settle: 0, frameAlpha: 1, cardsAlpha: 0, rounding: 0 })
    expect(phases(1, true).cardsAlpha).toBe(1)
    expect(phases(1, false)).toMatchObject({ frameAlpha: 0, cardsAlpha: 1 })
  })

  it('keeps the cases solid and in place while the cards appear over them, and rounds their corners first', () => {
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const { settle, frameAlpha, cardsAlpha, rounding } = phases(progress, true)
      expect(frameAlpha).toBe(1) // the covers never fade or swap
      if (cardsAlpha > 0) expect(settle).toBe(1) // nothing appears before the cases have landed
      expect(rounding).toBeGreaterThanOrEqual(cardsAlpha) // corners are rounded ahead of the cards
    }
    expect(phases(0.86, true).rounding).toBe(0)
    expect(phases(1, true)).toMatchObject({ cardsAlpha: 1, rounding: 1 })
  })

  it('in a dissolve, never shows the cases and the cards at full strength together', () => {
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const { frameAlpha, cardsAlpha } = phases(progress, false)
      expect(frameAlpha + cardsAlpha).toBeLessThanOrEqual(1.25)
    }
  })
})
