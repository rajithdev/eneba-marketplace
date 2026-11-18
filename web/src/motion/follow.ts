/*
 * What every scroll effect on the page shares: one scroll listener and one
 * requestAnimationFrame, however many effects there are.
 *
 * Scrolling itself is never touched. The page scrolls as the browser scrolls
 * it; an effect only looks at where things have got to and draws them
 * accordingly, with transforms and opacity, which move nothing else on the
 * page.
 */

/**
 * One effect's work for a frame, in two halves: called, it reads what it
 * needs from the page (positions) and returns the function that writes the
 * result (styles), or nothing when there is nothing to write.
 */
export type Step = () => (() => void) | void

const steps = new Set<Step>()
let request = 0

function frame() {
  request = 0
  // All the reading first, then all the writing. A read that came after
  // another effect's write would make the browser lay the page out again in
  // the middle of the frame.
  const writes = [...steps].map((step) => step())
  for (const write of writes) write?.()
}

/** At most one frame is ever waiting, however many scroll events arrive before it. */
const schedule = () => {
  if (!request) request = requestAnimationFrame(frame)
}

// Things also change place when the page changes length without being
// scrolled: a notice appearing above them, say.
const lengthWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null

/**
 * Runs `step` now, and then once in every display frame during which the
 * page was scrolled, the window resized or the page changed length.
 * Returns the function that stops it.
 */
export function follow(step: Step): () => void {
  if (steps.size === 0) {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    lengthWatch?.observe(document.body)
  }
  steps.add(step)
  // At once, not a frame later: the first picture the visitor sees is already the right one.
  step()?.()

  return () => {
    steps.delete(step)
    if (steps.size > 0) return
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    lengthWatch?.disconnect()
    cancelAnimationFrame(request)
    request = 0
  }
}

/**
 * Runs an effect for as long as the visitor has not asked for reduced
 * motion. `start` begins it and returns what ends it (and puts everything
 * back); it is called again if the setting is switched back.
 */
export function whileMotionAllowed(start: () => () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
  let stop: (() => void) | null = null
  const update = () => {
    stop?.()
    stop = calm.matches ? null : start()
  }
  update()
  calm.addEventListener('change', update)

  return () => {
    calm.removeEventListener('change', update)
    stop?.()
  }
}

/** The styles an effect may set, emptied: an element given these is exactly as its classes make it. */
export const AT_REST = { transform: '', 'transform-origin': '', opacity: '' }

const painted = new WeakMap<HTMLElement, string>()

/** Sets inline styles on an element, and leaves it alone when they are the ones it was last given. */
export function paint(element: HTMLElement | null, styles: Record<string, string>) {
  if (!element) return
  const wanted = JSON.stringify(styles)
  if (painted.get(element) === wanted) return
  painted.set(element, wanted)
  for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value)
}
