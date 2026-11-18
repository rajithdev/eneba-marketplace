import { describe, expect, it } from 'vitest'
import { cardPose, HERO_FOCUS, heroPose } from './poses'

describe('the featured banner as it scrolls away', () => {
  // The banner's foot reaches the top of the window after 570px of scrolling;
  // its text is 300px tall and starts 210px down the page.
  const leavesAt = 570
  const at = (scrolled: number) => heroPose(scrolled, leavesAt, 210 - scrolled, 510 - scrolled)

  it('is untouched with the page at its top', () => {
    expect(at(0)).toEqual({ progress: 0, zoom: 1, drift: 0, lift: -0, copyAlpha: 1 })
  })

  it('grows, slides down and loses its text by the time it has left, and no further', () => {
    const gone = at(leavesAt)
    expect(gone.progress).toBe(1)
    expect(gone.zoom).toBeCloseTo(1.12)
    expect(gone.drift).toBeCloseTo(4.5)
    expect(gone.lift).toBe(-44)
    expect(gone.copyAlpha).toBe(0)
    expect(at(5000)).toMatchObject({ progress: 1, zoom: gone.zoom, drift: gone.drift, lift: -44, copyAlpha: 0 })
  })

  it('keeps the text whole while most of it is in view, and fades it as it leaves', () => {
    expect(at(210).copyAlpha).toBe(1) // its top edge is at the top of the window
    expect(at(300).copyAlpha).toBe(1) // a third of it has left
    const leaving = at(400).copyAlpha // two thirds have
    expect(leaving).toBeGreaterThan(0)
    expect(leaving).toBeLessThan(1)
    expect(at(480).copyAlpha).toBe(0) // risen as it is, all of it has
  })

  it('never slides the artwork further than the zoom has made room for above it', () => {
    for (const scrolled of [1, 100, 285, 400, 570]) {
      const pose = at(scrolled)
      // The zoom, growing from the focus, lifts the picture's top edge by this share of its height.
      const room = (pose.zoom - 1) * HERO_FOCUS.y * 100
      expect(pose.drift).toBeLessThanOrEqual(room)
    }
  })

  it('depends on the position alone, so scrolling back restores it', () => {
    const down = [0, 150, 300, 420].map(at)
    const up = [420, 300, 150, 0].map(at).reverse()
    expect(up).toEqual(down)
  })

  it('does nothing for a banner it cannot measure', () => {
    expect(heroPose(200, 0, 0, 0)).toMatchObject({ progress: 0, copyAlpha: 1 })
  })
})

describe('a best sellers card', () => {
  const windowHeight = 800
  // A card 320px tall whose top edge is `top` below the top of the window.
  const at = (top: number, column = 0) => cardPose(top, top + 320, windowHeight, column)

  it('is transparent, low and leaning back while still under the window', () => {
    expect(at(800)).toMatchObject({ resting: false, drop: 32, tilt: 9, scale: 1, alpha: 0, info: 0 })
    expect(at(1200)).toEqual(at(800))
  })

  it('is exactly in its place once it has climbed, and stays so across the window', () => {
    // The first in a row needs half of the climb (40% of the window): 160px.
    expect(at(640)).toEqual({ resting: true, drop: 0, tilt: 0, scale: 1, alpha: 1, info: 1 })
    expect(at(300).resting).toBe(true)
    expect(at(80).resting).toBe(true) // a tenth of the window from the top: about to recede
    expect(at(79).resting).toBe(false)
  })

  it('brings each card in a row in after the one on its left', () => {
    const row = [0, 1, 2, 3, 4, 5].map((column) => at(660, column).alpha)
    for (let column = 1; column < row.length; column++) expect(row[column]).toBeLessThan(row[column - 1])
    // The sixth is in place exactly as the climb ends, 320px up.
    expect(at(481, 5).resting).toBe(false)
    expect(at(480, 5).resting).toBe(true)
  })

  it('brings the text in after the picture', () => {
    const half = at(720) // half way through its own arrival
    expect(half.alpha).toBeGreaterThan(0.8)
    expect(half.info).toBeLessThan(half.alpha)
    expect(half.info).toBeGreaterThan(0)
  })

  it('recedes as it leaves at the top: smaller, dimmer, a little behind', () => {
    const leaving = at(-120) // half of the way from starting to recede to being gone
    expect(leaving.resting).toBe(false)
    expect(leaving.scale).toBeCloseTo(0.97)
    expect(leaving.alpha).toBeCloseTo(0.65)
    expect(leaving.drop).toBeCloseTo(9)
    expect(leaving.tilt).toBe(0)

    expect(at(-320)).toMatchObject({ scale: 0.94, drop: 18 })
    expect(at(-320).alpha).toBeCloseTo(0.3)
    expect(at(-900)).toEqual(at(-320))
  })

  it('depends on the position alone, so scrolling back restores it', () => {
    const down = [700, 400, 0, -200].map((top) => at(top, 2))
    const up = [-200, 0, 400, 700].map((top) => at(top, 2)).reverse()
    expect(up).toEqual(down)
  })
})
