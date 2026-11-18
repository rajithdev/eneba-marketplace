import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { ProductSummary } from '../lib/catalog'
import { coverArt } from '../lib/coverArt'
import { GameCase } from './GameCase'
import { approach, drawnAround, keyTarget, placeAt, poseAt, REACH, scrollFor, travel } from './shelf'

/** How quickly the shelf catches up with the scroll position, in milliseconds: long enough to smooth a mouse wheel's steps and to glide into a chosen case, short enough to feel direct. */
const CATCH_UP_MS = 110
/** Scrolling counts as stopped once the scroll position has not changed for this long, in milliseconds. */
const REST_AFTER_MS = 140
/** How many cases either side of the middle have their reflection in the floor drawn. */
const MIRRORED = 4
/** The lamp takes its colour from the chosen cover once the choice has stood for this long, in milliseconds: not from every case a fast scroll passes. */
const TINT_AFTER_MS = 260
/** The archive's own violet, which a cover's colour is mixed with: red, green, blue. */
const VIOLET = [139, 92, 246]
/** A press that moves this far, in pixels, is a drag of the shelf and not a click on a case. */
const DRAG_FROM = 6

/** What is lettered on the plate at one end of the shelf: a small line above, the shelf's name, and small lines below. */
export interface Plate {
  above: string
  name: string
  below: string[]
}

/** The time now, in milliseconds, on the clock the browser's display frames are timed by. */
const clock = () => performance.now()

interface Props {
  products: ProductSummary[]
  /** Which product is the chosen one, and how the stage says another has been chosen. */
  selected: number
  onSelect: (index: number) => void
  /** Opens the chosen product's offers. */
  onOpen: (product: ProductSummary) => void
  /** What each case is called, for screen readers. */
  label: (product: ProductSummary) => string
  /** The plates that stand before the first case and after the last; `end` is null while more of the collection is still to be fetched. */
  plates: { start: Plate; end: Plate | null }
  /** Shown above the shelf and under it, inside the stage, so they stay while the shelf is scrolled. */
  header: ReactNode
  children: ReactNode
}

/**
 * The archive on a wide window: the cases stand in an arc that opens
 * toward the visitor, the chosen one nearest and in the middle, the others
 * stepping back into the dark on either side. Behind them a room: the rim
 * of a great circle, a round floor, and a lamp tinted by the chosen cover.
 *
 * The page's own scrolling moves the shelf. The stage stays in place while
 * an empty stretch (the runway) scrolls past, one case per notch of the
 * wheel, so scrolling back runs the shelf back, the scrollbar shows how far
 * along the collection is, and nothing is taken from the browser. A click,
 * the arrow keys and the two arrow buttons scroll the page to the case
 * asked for; a sideways swipe or drag scrolls it too.
 *
 * Only the cases near the middle are in the page (see drawnAround). While
 * the shelf moves, each of them is given a transform and a brightness and
 * nothing else; when it has come to rest no code runs at all.
 */
export function ArchiveStage({ products, selected, onSelect, onOpen, label, plates, header, children }: Props) {
  const runway = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<number, HTMLElement>())
  const optionId = useId()
  const count = products.length

  // Which cases are in the page follows where the shelf is drawn, which trails the choice by a moment.
  const [middle, setMiddle] = useState(selected)
  const [first, last] = drawnAround(middle, count)
  const drawn: number[] = []
  for (let index = first; index <= last; index++) drawn.push(index)
  // The chosen case is always in the page, even before the shelf has travelled to it: it is what the keyboard is on.
  if (count > 0 && (selected < first || selected > last)) drawn.push(selected)

  // The lamp over the row takes its colour from the chosen cover.
  const tint = useTint(coverArt(useSettled(products[selected], TINT_AFTER_MS)?.cover_image_url ?? null))

  /** Keeps track of the element standing at a place on the shelf, so the drawing loop can move it. */
  const standsAt = (index: number) => (slot: HTMLElement | null) => {
    if (slot) slots.current.set(index, slot)

    return () => {
      slots.current.delete(index)
    }
  }

  // What the drawing loop needs, kept where it can read the latest without being restarted.
  const live = useRef({ count, selected, onSelect, shown: selected as number, unit: 0, aim: null as number | null, aimedAt: 0, dragged: false, wake: () => {}, place: () => {}, ask: (_index: number) => {} })
  useLayoutEffect(() => {
    Object.assign(live.current, { count, selected, onSelect })
  })

  useLayoutEffect(() => {
    const state = live.current
    const stageBox = runway.current!.firstElementChild as HTMLElement
    let request = 0
    let lastTime = 0
    let aimed = -1 // where the scroll position puts the shelf, as last seen,
    let movedAt = 0 // and when that last changed
    let travelled = false // whether the page has scrolled at all since a case was asked for

    /** How far the page has been scrolled into the runway, in pixels. */
    const scrolled = () => stageBox.getBoundingClientRect().top - runway.current!.getBoundingClientRect().top

    /** Stands every case in the page where it belongs for the shelf's place. */
    const place = () => {
      for (const [index, slot] of slots.current) {
        const pose = poseAt(index - state.shown)
        slot.style.transform = `translate3d(${(pose.x * state.unit).toFixed(1)}px,0,${(pose.z * state.unit).toFixed(1)}px) rotateY(${pose.turn.toFixed(2)}deg)`
        slot.style.setProperty('--ga-lit', pose.light.toFixed(3))
        slot.style.setProperty('--ga-ink', pose.ink.toFixed(2))
        slot.style.setProperty('--ga-focus', pose.focus.toFixed(2))
      }
    }

    /** Sizes the stage to the window, and the cases to the room that leaves: the chosen one fills most of the scene's height. */
    const measure = () => {
      // How far down the page the archive starts (the site's header is above it). The stage is as
      // tall as the window less that, so all of it is in view before the page has been scrolled,
      // and stays so under the header, which is kept in the window while the stage is (archive.css).
      const from = runway.current!.getBoundingClientRect().top + window.scrollY
      runway.current!.style.setProperty('--ga-head', `${Math.min(Math.max(from, 0), window.innerHeight * 0.3).toFixed(0)}px`)
      const room = scene.current!.clientHeight
      const height = Math.min(Math.max(room * 0.78, 180), 540)
      state.unit = height * 0.75
      scene.current!.style.setProperty('--ga-w', `${state.unit.toFixed(1)}px`)
      scene.current!.style.setProperty('--ga-h', `${height.toFixed(1)}px`)
      scene.current!.style.setProperty('--ga-t', `${(state.unit * 0.13).toFixed(1)}px`)
      wake()
    }

    const tick = (now: number) => {
      request = 0
      const at = placeAt(scrolled(), state.count)
      // Far more than a scroll could cover in one frame: the page was put somewhere (going back to it, a jump to the top). Be there, rather than fly past everything between.
      const jumped = aimed < 0 || Math.abs(at - aimed) > REACH
      const moved = at !== aimed
      if (moved) {
        aimed = at
        movedAt = now
      }
      // Once scrolling has stopped, the shelf settles with one case squarely in the middle.
      // (Asking for a case counts as movement: the page is about to scroll to it.)
      const resting = now - Math.max(movedAt, state.aimedAt) > REST_AFTER_MS
      const goal = resting ? Math.round(at) : at
      state.shown = jumped ? goal : approach(state.shown, goal, now - lastTime, CATCH_UP_MS)
      lastTime = now
      place()
      setMiddle(Math.round(state.shown))

      // The chosen case is whichever the scroll position has in the middle. A case asked for by a
      // click or a key is the chosen one from that moment instead, while the page scrolls to it;
      // when the page comes to rest, wherever that is, the scroll position speaks again.
      const inMiddle = Math.round(at)
      if (state.aim === null) {
        if (moved && inMiddle !== state.selected && state.count > 0) state.onSelect(inMiddle)
      } else {
        travelled ||= moved
        if (resting) {
          if (travelled && inMiddle !== state.selected) state.onSelect(inMiddle)
          state.aim = null
          travelled = false
        }
      }

      if (state.shown !== goal || !resting) request = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (request) return
      lastTime = clock()
      request = requestAnimationFrame(tick)
    }
    state.wake = wake
    state.place = place
    // A case asked for by a click or a key: remembered, with the moment, until the page has scrolled to it.
    state.ask = (index) => {
      state.aim = index
      state.aimedAt = clock()
      wake()
    }

    // Scrolling by hand takes over from a case that was asked for.
    const byHand = () => {
      state.aim = null
    }
    // A sideways swipe on a trackpad moves the shelf, as its direction suggests it should.
    const onWheel = (event: WheelEvent) => {
      byHand()
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      window.scrollBy({ top: event.deltaX, behavior: 'instant' })
    }

    // Dragging the shelf sideways, with a mouse or a finger. (A finger moving up or down scrolls the page, as anywhere.)
    let dragFrom: { x: number; moved: number } | null = null
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragFrom = { x: event.clientX, moved: 0 }
      state.dragged = false
    }
    const onMove = (event: PointerEvent) => {
      if (!dragFrom) return
      const by = event.clientX - dragFrom.x
      dragFrom.x = event.clientX
      dragFrom.moved += Math.abs(by)
      if (dragFrom.moved < DRAG_FROM) return
      if (!state.dragged) {
        state.dragged = true
        byHand()
        scene.current!.setPointerCapture(event.pointerId)
        scene.current!.dataset.dragging = ''
      }
      // The shelf follows the hand: a case's width of dragging is about a case's width of shelf.
      window.scrollBy({ top: (-by / (state.unit * 0.9)) * scrollFor(1), behavior: 'instant' })
    }
    const onUp = () => {
      dragFrom = null
      delete scene.current?.dataset.dragging
    }

    const room = scene.current!
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    sized?.observe(room)
    measure()
    // At once, not a frame later: the first picture the visitor sees is already the right one.
    cancelAnimationFrame(request)
    tick(clock())
    window.addEventListener('scroll', wake, { passive: true })
    window.addEventListener('resize', measure)
    room.addEventListener('wheel', onWheel, { passive: false })
    room.addEventListener('pointerdown', onDown)
    room.addEventListener('pointermove', onMove)
    room.addEventListener('pointerup', onUp)
    room.addEventListener('pointercancel', onUp)
    window.addEventListener('touchmove', byHand, { passive: true })

    return () => {
      cancelAnimationFrame(request)
      sized?.disconnect()
      window.removeEventListener('scroll', wake)
      window.removeEventListener('resize', measure)
      room.removeEventListener('wheel', onWheel)
      room.removeEventListener('pointerdown', onDown)
      room.removeEventListener('pointermove', onMove)
      room.removeEventListener('pointerup', onUp)
      room.removeEventListener('pointercancel', onUp)
      window.removeEventListener('touchmove', byHand)
    }
  }, [])

  // A case that has just come into the page is stood in its place before it is first seen.
  useLayoutEffect(() => {
    live.current.place()
  }, [first, last, selected])

  // More of the collection arriving makes the runway longer; the shelf has not moved.
  useEffect(() => {
    live.current.wake()
  }, [count])

  /** Chooses a case and scrolls the page to where that case is in the middle. */
  const go = (index: number) => {
    if (index < 0 || index >= count || !runway.current) return
    // Where the stage rests in the window while its runway passes.
    const rest = parseFloat(getComputedStyle(runway.current.firstElementChild!).top) || 0
    live.current.ask(index)
    onSelect(index)
    window.scrollTo({ top: window.scrollY + runway.current.getBoundingClientRect().top - rest + scrollFor(index), behavior: 'smooth' })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && products[selected]) return onOpen(products[selected])
    const target = keyTarget(event.key, live.current.aim ?? selected, count)
    if (target === null) return
    event.preventDefault()
    go(target)
  }

  return (
    // The runway: the stage, plus the stretch of scrolling that takes the shelf from its first case to its last.
    <div ref={runway} className="ga-ground" style={{ height: `calc(100svh - var(--ga-head, 9rem) + ${travel(count)}px)` }}>
      <div className="ga-stage">
        <div className="ga-room" aria-hidden="true">
          <div className="ga-halo" />
        </div>
        <div className="mx-auto w-full max-w-7xl px-4">{header}</div>

        <p id={`${optionId}-keys`} hidden>
          Left and right arrow keys move along the shelf. Enter opens the chosen game's offers.
        </p>
        <div
          ref={scene}
          className="ga-scene"
          role="listbox"
          tabIndex={0}
          aria-label="Games in the archive"
          aria-orientation="horizontal"
          aria-activedescendant={count > 0 ? `${optionId}-${selected}` : undefined}
          aria-describedby={`${optionId}-keys`}
          onKeyDown={onKeyDown}
          style={tint ? ({ '--ga-tint': tint } as CSSProperties) : undefined}
        >
          <div className="ga-floor" aria-hidden="true" />
          <div className="ga-rig" role="presentation">
            {first === 0 && <ShelfPlate plate={plates.start} place={standsAt(-1)} />}
            {plates.end && last === count - 1 && <ShelfPlate plate={plates.end} place={standsAt(count)} />}
            {drawn.map((index) => {
              const product = products[index]

              return (
                <div
                  key={product.slug}
                  id={`${optionId}-${index}`}
                  ref={standsAt(index)}
                  role="option"
                  aria-selected={index === selected}
                  aria-label={label(product)}
                  aria-posinset={index + 1}
                  aria-setsize={count}
                  className="ga-slot"
                  onClick={() => {
                    // Letting go of a drag over a case is not a click on it.
                    if (live.current.dragged) return
                    if (index === selected) onOpen(product)
                    else go(index)
                  }}
                >
                  {/* Far along the row a case is too dark for its reflection to be seen. */}
                  <GameCase product={product} reflect={Math.abs(index - middle) <= MIRRORED} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4">
          {children}
          <ShelfArrow direction="previous" disabled={selected <= 0} onClick={() => go((live.current.aim ?? selected) - 1)} />
          <ShelfArrow direction="next" disabled={selected >= count - 1} onClick={() => go((live.current.aim ?? selected) + 1)} />
        </div>
      </div>
    </div>
  )
}

/** The plate that stands at an end of the shelf. Decoration: what it says is in the page's heading too. */
function ShelfPlate({ plate, place }: { plate: Plate; place: (slot: HTMLElement | null) => () => void }) {
  return (
    <div ref={place} className="ga-slot" aria-hidden="true">
      <span className="ga-case">
        <span className="ga-face ga-plate">
          <span>{plate.above}</span>
          <strong>{plate.name}</strong>
          <i />
          {plate.below.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
        <span className="ga-shadow" />
      </span>
    </div>
  )
}

/** A value once it has stopped changing: what `value` was `ms` ago, if it has not changed since. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)

    return () => clearTimeout(timer)
  }, [value, ms])

  return settled
}

/**
 * The colour of a picture taken as a whole, as light for the room: its
 * average, brightened, and mixed half and half with the archive's violet so
 * that no cover can turn the room another colour altogether. Null until the
 * picture has been read, and where it cannot be.
 *
 * The picture is drawn very small and its few pixels averaged, once per
 * picture; nothing here runs while the shelf moves.
 */
function useTint(source: string | null): string | null {
  const [tint, setTint] = useState<string | null>(null)

  useEffect(() => {
    if (!source) return
    let wanted = true
    const picture = new Image()
    picture.onload = () => {
      const side = 8
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = side
      const context = canvas.getContext('2d')
      if (!wanted || !context) return
      context.drawImage(picture, 0, 0, side, side)
      const pixels = context.getImageData(0, 0, side, side).data
      const sum = [0, 0, 0]
      for (let at = 0; at < pixels.length; at += 4) for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[at + channel]
      // Brightened until its strongest channel is a clear light, whatever the cover's own darkness.
      const lift = 210 / Math.max(...sum.map((total) => total / (side * side)), 1)
      setTint(`rgb(${sum.map((total, channel) => Math.round(((total / (side * side)) * lift + VIOLET[channel]) / 2)).join(' ')})`)
    }
    picture.src = source

    return () => {
      wanted = false
    }
  }, [source])

  return tint
}

/** One of the two arrows beside what is written under the shelf: the way along it for a mouse without a wheel, or a screen reader. */
export function ShelfArrow({ direction, disabled, onClick }: { direction: 'previous' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? 'Previous game' : 'Next game'}
      disabled={disabled}
      onClick={onClick}
      className={`ga-glass absolute top-0 flex size-11 items-center justify-center rounded-full disabled:opacity-30 lg:top-11 lg:size-14 ${direction === 'previous' ? 'left-4 lg:left-[5%]' : 'right-4 lg:right-[5%]'}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-5 lg:size-6 ${direction === 'previous' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 12h15m-6-6 6 6-6 6" />
      </svg>
    </button>
  )
}
