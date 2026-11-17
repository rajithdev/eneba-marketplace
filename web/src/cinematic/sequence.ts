/*
 * The frames of the animation: fetching them, and keeping only a few of
 * them decoded.
 *
 * A frame is small as a file and large once decoded (width x height x 4
 * bytes), so the files are all kept, as fetched, and at most `keep`
 * decoded pictures exist at a time: the ones nearest the frame on screen.
 * As the visitor moves through the sequence, the picture furthest from
 * where they are now is released to make room for the next.
 *
 * Loading is in two passes. The coarse pass fetches every eighth frame and
 * the last one; when it is done the animation can already be scrubbed from
 * end to end, just in bigger steps. The second pass fills in the rest.
 */

const COARSE_STEP = 8
const PARALLEL = 6

export interface Sequence {
  /** Settles when the coarse pass is in and the first frame is decoded. Rejects if it cannot be loaded. */
  ready: Promise<void>
  /** The decoded picture for a frame, or the nearest one there is while that frame is fetched or decoded. */
  picture(frame: number): ImageBitmap | null
  /** Called whenever another picture has been decoded, so the stage can draw again. */
  onPicture: () => void
  stats(): { framesLoaded: number; bytesLoaded: number; coarseBytes: number; decoded: number }
  /** Lets go of every decoded picture (the files stay): for when the section is off screen. */
  release(): void
  dispose(): void
}

export function loadSequence(urlFor: (frame: number) => string, frames: number, keep: number): Sequence {
  const files: (Blob | undefined)[] = Array.from({ length: frames })
  const pictures = new Map<number, ImageBitmap>()
  let current = 0 // the frame last asked for
  let direction = 1 // which way the visitor is moving through the frames
  const decoding = new Set<number>()
  const abort = new AbortController()
  let coarseBytes = 0
  let disposed = false
  let resting = false // released and not asked for a picture since

  const fetchFrame = async (frame: number) => {
    const reply = await fetch(urlFor(frame), { signal: abort.signal })
    if (!reply.ok) throw new Error(`frame ${frame}: HTTP ${reply.status}`)
    files[frame] = await reply.blob()
  }

  /** The loaded frame closest to the one asked for. */
  const nearestLoaded = (frame: number) => {
    for (let distance = 0; distance < frames; distance++) {
      if (files[frame - distance]) return frame - distance
      if (files[frame + distance]) return frame + distance
    }
    return -1
  }

  const decode = async (frame: number) => {
    const file = files[frame]
    if (!file || pictures.has(frame) || decoding.has(frame)) return
    decoding.add(frame)
    try {
      const picture = await createImageBitmap(file)
      // Finished after everything was let go: this one is not wanted either.
      if (disposed || resting) return picture.close()
      pictures.set(frame, picture)
      // Over the limit: release whichever picture is furthest from the frame on screen.
      while (pictures.size > keep) {
        const furthest = [...pictures.keys()].reduce((a, b) => (Math.abs(a - current) >= Math.abs(b - current) ? a : b))
        pictures.get(furthest)!.close()
        pictures.delete(furthest)
      }
      sequence.onPicture()
    } finally {
      decoding.delete(frame)
    }
  }

  const coarse = Array.from({ length: frames }, (_, frame) => frame).filter((frame) => frame % COARSE_STEP === 0 || frame === frames - 1)

  const ready = Promise.all(coarse.map(fetchFrame)).then(async () => {
    coarseBytes = files.reduce((total, file) => total + (file?.size ?? 0), 0)
    await decode(0)

    // The rest, a few at a time, without holding up the page: failures here
    // only mean bigger steps between frames.
    const rest = Array.from({ length: frames }, (_, frame) => frame).filter((frame) => !files[frame])
    const worker = async () => {
      while (rest.length > 0 && !disposed) await fetchFrame(rest.shift()!).catch(() => {})
    }
    void Promise.all(Array.from({ length: PARALLEL }, worker))
  })

  const sequence: Sequence = {
    ready,
    onPicture: () => {},
    picture(frame) {
      resting = false
      if (frame !== current) direction = frame > current ? 1 : -1
      current = frame
      const wanted = nearestLoaded(frame)
      const exact = pictures.get(wanted)
      if (exact) {
        // Get the next few ready, in the direction of travel, and one behind in case of a change of mind.
        for (const step of [1, 2, 3, -1]) void decode(nearestLoaded(clampFrame(frame + step * direction, frames)))
        return exact
      }
      if (wanted >= 0) void decode(wanted)

      // Meanwhile, whichever decoded picture is closest.
      let best: ImageBitmap | null = null
      let bestDistance = Infinity
      for (const [index, picture] of pictures) {
        if (Math.abs(index - frame) < bestDistance) {
          best = picture
          bestDistance = Math.abs(index - frame)
        }
      }
      return best
    },
    stats: () => ({
      framesLoaded: files.filter(Boolean).length,
      bytesLoaded: files.reduce((total, file) => total + (file?.size ?? 0), 0),
      coarseBytes,
      decoded: pictures.size,
    }),
    release() {
      resting = true
      for (const picture of pictures.values()) picture.close()
      pictures.clear()
    },
    dispose() {
      disposed = true
      abort.abort()
      sequence.release()
    },
  }

  return sequence
}

const clampFrame = (frame: number, frames: number) => Math.min(frames - 1, Math.max(0, frame))
