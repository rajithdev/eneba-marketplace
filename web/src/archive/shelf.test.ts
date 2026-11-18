import { describe, expect, it } from 'vitest'
import { approach, drawnAround, keyTarget, placeAt, poseAt, REACH, scrollFor, shelfMark, STEP, travel } from './shelf'

describe('where a case stands', () => {
  it('has the chosen case in the middle, nearest the visitor, fully lit and rimmed, showing its spine', () => {
    const chosen = poseAt(0)

    expect(chosen.x).toBe(0)
    expect(chosen.light).toBe(1)
    expect(chosen.turn).toBeGreaterThan(15)
    expect(chosen.turn).toBeLessThan(30)
    // The chosen case, and no other, has the lit rim, which comes up gradually.
    expect(chosen.focus).toBe(1)
    expect(poseAt(0.3).focus).toBeGreaterThan(0)
    expect(poseAt(0.3).focus).toBeLessThan(1)
    expect(poseAt(1).focus).toBe(0)
    expect(poseAt(-1).focus).toBe(0)
    for (const offset of [-3, -1, 1, 3]) expect(poseAt(offset).z).toBeLessThan(chosen.z)
  })

  it('stands the two sides as mirror images, each turned to face the middle', () => {
    for (const offset of [0.3, 1, 1.5, 4, 9]) {
      const [left, right] = [poseAt(-offset), poseAt(offset)]

      expect(left.x).toBeCloseTo(-right.x)
      expect(left.z).toBeCloseTo(right.z)
      expect(left.light).toBeCloseTo(right.light)
      // A cover on the left is turned to the right and one on the right to the left, by the same amount
      // either side of the chosen case's own slight turn, which is gone by the first place.
      expect(left.turn).toBeGreaterThan(right.turn)
      const lean = (left.turn + right.turn) / 2
      if (offset < 1) expect(lean).toBeGreaterThan(0)
      else expect(lean).toBeCloseTo(0)
      expect(lean).toBeLessThan(poseAt(0).turn)
    }
  })

  it('runs off into the distance: each case further out, further back, more edge-on and darker than the last', () => {
    for (let offset = 1; offset < REACH; offset++) {
      const [nearer, further] = [poseAt(offset), poseAt(offset + 1)]

      expect(further.x).toBeGreaterThan(nearer.x)
      expect(further.z).toBeLessThan(nearer.z)
      expect(Math.abs(further.turn)).toBeGreaterThan(Math.abs(nearer.turn))
      expect(further.light).toBeLessThan(nearer.light)
    }
    // Never turned past edge-on, where its back would show, and never quite black.
    expect(Math.abs(poseAt(40).turn)).toBeLessThan(90)
    expect(poseAt(40).light).toBeGreaterThan(0)
  })

  it('moves every case smoothly as the shelf is scrolled, with no stop or jump at the first place', () => {
    // Small enough that the bend of the curve itself is not mistaken for a jump.
    const step = 0.00001
    for (const part of ['x', 'z', 'turn', 'light'] as const) {
      const before = (poseAt(1)[part] - poseAt(1 - step)[part]) / step
      const after = (poseAt(1 + step)[part] - poseAt(1)[part]) / step

      // The same speed arriving at the first place as leaving it.
      expect(before).toBeCloseTo(after, 1)
    }
    // Nor at the middle, where the chosen case's own turn is let go of on either side.
    expect((poseAt(0).turn - poseAt(-step).turn) / step).toBeCloseTo((poseAt(step).turn - poseAt(0).turn) / step, 1)
    // A case never goes backwards on its way through, sideways or in its turning.
    for (let offset = -3; offset < 3; offset += 0.05) {
      expect(poseAt(offset + 0.05).x).toBeGreaterThan(poseAt(offset).x)
      expect(poseAt(offset + 0.05).turn).toBeLessThan(poseAt(offset).turn)
    }
  })

  it('inks in the lettering of a spine only once it is turned enough to be read', () => {
    expect(poseAt(0).ink).toBe(0)
    expect(poseAt(0.3).ink).toBe(0)
    expect(poseAt(-1).ink).toBe(1)
    expect(poseAt(1).ink).toBe(1)
  })
})

describe('the shelf and the scroll position', () => {
  it('moves one case along for every step of scrolling', () => {
    for (const index of [0, 1, 17, 70]) expect(placeAt(scrollFor(index), 71)).toBe(index)
    expect(placeAt(STEP * 2.5, 71)).toBe(2.5)
  })

  it('stays on the first case before the runway and on the last after it', () => {
    expect(placeAt(-400, 71)).toBe(0)
    expect(placeAt(travel(71) + 900, 71)).toBe(70)
    expect(placeAt(300, 0)).toBe(0)
  })

  it('is as long as it takes to go from the first case to the last', () => {
    expect(travel(71)).toBe(scrollFor(70))
    expect(travel(1)).toBe(0)
    expect(travel(0)).toBe(0)
  })

  it('draws only the cases near the middle', () => {
    expect(drawnAround(30.4, 71)).toEqual([30 - REACH, 30 + REACH])
    expect(drawnAround(0, 71)).toEqual([0, REACH])
    expect(drawnAround(70, 71)).toEqual([70 - REACH, 70])
    expect(drawnAround(1, 3)).toEqual([0, 2])
  })
})

describe('catching up', () => {
  it('goes most of the way, and all of it once the difference could not be seen', () => {
    const once = approach(0, 10, 16, 110)

    expect(once).toBeGreaterThan(0)
    expect(once).toBeLessThan(10)
    expect(approach(9.9995, 10, 16, 110)).toBe(10)
    expect(approach(10, 10, 16, 110)).toBe(10)
  })

  it('covers the same ground in the same time, however many frames that time is cut into', () => {
    const inOne = approach(0, 10, 32, 110)
    const inTwo = approach(approach(0, 10, 16, 110), 10, 16, 110)

    expect(inTwo).toBeCloseTo(inOne)
  })
})

describe('the keyboard', () => {
  it('moves a case at a time with the arrows, five with the page keys, and to either end', () => {
    expect(keyTarget('ArrowRight', 4, 71)).toBe(5)
    expect(keyTarget('ArrowLeft', 4, 71)).toBe(3)
    expect(keyTarget('PageDown', 4, 71)).toBe(9)
    expect(keyTarget('PageUp', 4, 71)).toBe(0)
    expect(keyTarget('Home', 40, 71)).toBe(0)
    expect(keyTarget('End', 40, 71)).toBe(70)
  })

  it('stops at the ends, and leaves other keys alone', () => {
    expect(keyTarget('ArrowLeft', 0, 71)).toBe(0)
    expect(keyTarget('ArrowRight', 70, 71)).toBe(70)
    expect(keyTarget('Tab', 4, 71)).toBeNull()
    expect(keyTarget('a', 4, 71)).toBeNull()
    expect(keyTarget('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('the shelf mark', () => {
  it('has as many digits as the count needs, three at least', () => {
    expect(shelfMark(7, 71)).toBe('007')
    expect(shelfMark(71, 71)).toBe('071')
    expect(shelfMark(12, 12000)).toBe('00012')
  })
})
