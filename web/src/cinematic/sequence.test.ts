import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSequence } from './sequence'

const FRAMES = 20
const url = (frame: number) => `/cinematic/test/f-${frame}.webp`

/** Stands in for the host: answers each frame with `reply`, and lists the frames asked for, in order. */
function host(reply: () => Response = () => new Response('picture', { headers: { 'Content-Type': 'image/webp' } })) {
  const asked: number[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    asked.push(Number(String(input).match(/f-(\d+)/)![1]))
    return reply()
  })

  return asked
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  // jsdom cannot decode pictures; a decoded picture only has to be closable here.
  vi.stubGlobal('createImageBitmap', async () => ({ close: () => {} }))
})
afterEach(() => vi.unstubAllGlobals())

describe('loading the frames', () => {
  it('is ready after every eighth frame and the last, and fetches no more until asked', async () => {
    const asked = host()
    const sequence = loadSequence(url, FRAMES, 5)

    await sequence.ready
    await settled()

    expect([...asked].sort((a, b) => a - b)).toEqual([0, 8, 16, 19])
    expect(sequence.stats().framesLoaded).toBe(4)
    sequence.dispose()
  })

  it('fetches the rest once, when asked to fill in', async () => {
    const asked = host()
    const sequence = loadSequence(url, FRAMES, 5)
    await sequence.ready

    sequence.fill()
    sequence.fill()
    await vi.waitFor(() => expect(sequence.stats().framesLoaded).toBe(FRAMES))

    expect(asked).toHaveLength(FRAMES) // each frame once, however often it is asked
    sequence.dispose()
  })

  it('shows the nearest frame it has while the one wanted is still to come', async () => {
    host()
    const sequence = loadSequence(url, FRAMES, 5)
    await sequence.ready

    expect(sequence.picture(0)).not.toBeNull() // decoded as part of getting ready
    expect(sequence.picture(3)).not.toBeNull() // frame 3 is not in yet: frame 0 stands in
    sequence.dispose()
  })

  it('does not take the site\'s own page for a frame', async () => {
    // What a host answers for a missing file when every unknown address serves the app.
    host(() => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    const sequence = loadSequence(url, FRAMES, 5)

    await expect(sequence.ready).rejects.toThrow('not a picture')
    sequence.dispose()
  })

  it('cannot get ready when the frames are missing', async () => {
    host(() => new Response('Not found', { status: 404 }))
    const sequence = loadSequence(url, FRAMES, 5)

    await expect(sequence.ready).rejects.toThrow('HTTP 404')
    sequence.dispose()
  })
})
