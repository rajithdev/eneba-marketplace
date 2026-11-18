import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { ProductSummary } from '../lib/catalog'
import { ShelfArrow } from './ArchiveStage'
import { GameCase } from './GameCase'
import { keyTarget } from './shelf'

/** How many cases either side of the chosen one are drawn as boxes (and their covers fetched); the rest keep their place as outlines. */
const DRAWN = 4

interface Props {
  products: ProductSummary[]
  selected: number
  onSelect: (index: number) => void
  onOpen: (product: ProductSummary) => void
  label: (product: ProductSummary) => string
  /** The stage's end plates; the row has none. */
  plates?: unknown
  /** Shown above the row and under it. */
  header: ReactNode
  children: ReactNode
}

/**
 * The archive where the stage does not run: a phone or a small window, and
 * anywhere the visitor has asked for reduced motion. The same cases, with
 * the same sides, in one row that is scrolled sideways with a finger (or
 * the arrow keys, or the two arrow buttons), each coming to rest in the
 * middle. The chosen case is the one in the middle.
 *
 * The scrolling and the coming to rest are the browser's own (scroll
 * snapping). The only script that runs while the row moves reads how far
 * it has been scrolled, once per display frame, to know which case is in
 * the middle.
 */
export function ArchiveRail({ products, selected, onSelect, onOpen, label, header, children }: Props) {
  const rail = useRef<HTMLDivElement>(null)
  const optionId = useId()
  const count = products.length
  // A case asked for by a tap or a key is the chosen one at once, while the row scrolls to it.
  const live = useRef({ selected, onSelect, aim: null as number | null })
  useEffect(() => {
    Object.assign(live.current, { selected, onSelect })
  })

  /** The distance from one case to the next, in pixels. */
  const pitch = () => {
    const items = rail.current?.children

    return items && items.length > 1 ? (items[1] as HTMLElement).offsetLeft - (items[0] as HTMLElement).offsetLeft : 0
  }

  useEffect(() => {
    const row = rail.current!
    let request = 0
    let settled = 0
    const read = () => {
      request = 0
      const step = pitch()
      if (step <= 0) return
      const inMiddle = Math.min(Math.max(Math.round(row.scrollLeft / step), 0), row.children.length - 1)
      // While the row is on its way to a case that was asked for, the cases it passes are not chosen.
      if (live.current.aim !== null && inMiddle !== live.current.aim) return
      live.current.aim = null
      if (inMiddle !== live.current.selected) live.current.onSelect(inMiddle)
    }
    const onScroll = () => {
      if (!request) request = requestAnimationFrame(read)
      // If the row stops somewhere else than asked (a finger caught it), the middle speaks again.
      clearTimeout(settled)
      settled = window.setTimeout(() => {
        live.current.aim = null
        read()
      }, 160)
    }
    row.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      row.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(request)
      clearTimeout(settled)
    }
  }, [])

  /** Chooses a case and brings it to the middle. */
  const go = (index: number) => {
    if (index < 0 || index >= count) return
    live.current.aim = index
    onSelect(index)
    // Moved there in one step where the visitor has asked for reduced motion.
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rail.current?.scrollTo?.({ left: index * pitch(), behavior: calm ? 'instant' : 'smooth' })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && products[selected]) return onOpen(products[selected])
    const target = keyTarget(event.key, live.current.aim ?? selected, count)
    if (target === null) return
    event.preventDefault()
    go(target)
  }

  return (
    <>
      {header}
      <p id={`${optionId}-keys`} hidden>
        Left and right arrow keys move along the shelf. Enter opens the chosen game's offers.
      </p>
      <div
        ref={rail}
        className="ga-rail"
        role="listbox"
        tabIndex={0}
        aria-label="Games in the archive"
        aria-orientation="horizontal"
        aria-activedescendant={count > 0 ? `${optionId}-${selected}` : undefined}
        aria-describedby={`${optionId}-keys`}
        onKeyDown={onKeyDown}
      >
        {products.map((product, index) => (
          <div
            key={product.slug}
            id={`${optionId}-${index}`}
            role="option"
            aria-selected={index === selected}
            aria-label={label(product)}
            className="ga-rail-item"
            onClick={() => (index === selected ? onOpen(product) : go(index))}
          >
            {/* Each box is several layers for the browser to hold, so only the ones that can be seen are built. */}
            {Math.abs(index - selected) <= DRAWN && <GameCase product={product} />}
          </div>
        ))}
      </div>

      <div className="relative">
        {children}
        <ShelfArrow direction="previous" disabled={selected <= 0} onClick={() => go((live.current.aim ?? selected) - 1)} />
        <ShelfArrow direction="next" disabled={selected >= count - 1} onClick={() => go((live.current.aim ?? selected) + 1)} />
      </div>
    </>
  )
}
