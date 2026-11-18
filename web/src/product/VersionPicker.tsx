import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { fetchProduct, type Money, type ProductDetail } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { platformChoices, regionChoices } from './choices'

/*
 * Switching between the versions of a game, in the buy panel: one control
 * for the platform, one for the region. Each lists only versions the API
 * returned, so a platform or region the game is not sold for is never
 * offered, and a sold-out version says so. Every choice is a link to that
 * version's own page, which loads its own offers.
 *
 * A control with a single choice is shown as plain text: there is nothing
 * to pick.
 */

/** Asks for a version's page before it is opened (on hover or focus), so switching is instant. */
function usePrefetch() {
  const queryClient = useQueryClient()

  return (slug: string) => void queryClient.prefetchQuery({ queryKey: ['product', slug], queryFn: () => fetchProduct(slug), staleTime: 30_000 })
}

export function VersionPicker({ product }: { product: ProductDetail }) {
  const prefetch = usePrefetch()
  const platforms = platformChoices(product)
  const regions = regionChoices(product)

  return (
    <dl className="grid gap-2 text-sm">
      <Row icon="platform" term="Platform">
        <Choice
          label={`Platform: ${product.platform.name}`}
          value={product.platform.name}
          options={platforms.map((choice) => ({
            key: choice.platform.slug,
            slug: choice.target.slug,
            name: choice.platform.name,
            current: choice.current,
            price: choice.from,
            // A platform may be cheaper in another region than the one it opens.
            priceLabel: 'from',
          }))}
          prefetch={prefetch}
        />
      </Row>
      <Row icon="globe" term="Region">
        <Choice
          label={`Region: ${product.region.name}`}
          value={product.region.name}
          options={regions.map((version) => ({
            key: version.slug,
            slug: version.slug,
            name: version.region.name,
            current: version.slug === product.slug,
            price: version.price,
            priceLabel: '',
          }))}
          prefetch={prefetch}
        />
      </Row>
    </dl>
  )
}

function Row({ icon, term, children }: { icon: 'platform' | 'globe'; term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
      <dt className="flex items-center gap-2 text-muted">
        <Icon name={icon} className="size-4" />
        {term}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

interface Option {
  key: string
  slug: string
  name: string
  current: boolean
  price: Money | null
  priceLabel: string
}

const field = 'flex h-10 w-full items-center justify-between gap-2 rounded-control border border-edge/35 bg-dusk/60 px-3 text-left font-bold'

/**
 * A button that opens a short list of links (the disclosure pattern: no
 * arrow-key menu to learn, just links in tab order). Escape, or a click
 * anywhere else, closes it; Escape returns the focus to the button.
 */
function Choice({ label, value, options, prefetch }: { label: string; value: string; options: Option[]; prefetch: (slug: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (options.length < 2) return <p className={`${field} border-transparent bg-white/5`}>{value}</p>

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
      // Tabbing out of the list closes it.
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`${field} hover:border-edge-lit`}
        onClick={() => setOpen((was) => !was)}
        onPointerEnter={() => options.forEach((option) => !option.current && prefetch(option.slug))}
      >
        <span className="truncate">{value}</span>
        <Icon name="chevron" className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          id={listId}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-control border border-edge/40 bg-card-mid p-1 shadow-[0_24px_48px_-16px_rgb(4_1_18/0.95)]"
        >
          {options.map((option) => (
            <li key={option.key}>
              <Link
                to={`/product/${option.slug}`}
                // The panel stays where it is (it may be the sticky one, half-way down the page).
                preventScrollReset
                aria-current={option.current ? 'page' : undefined}
                onFocus={() => prefetch(option.slug)}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 rounded-[0.45rem] px-3 py-2.5 hover:bg-white/8 ${option.current ? 'bg-white/6' : ''}`}
              >
                <span className="flex items-center gap-2 font-bold">
                  <Icon name="check" className={`size-4 ${option.current ? 'text-accent' : 'invisible'}`} />
                  {option.name}
                </span>
                <span className={`text-xs font-bold ${option.price ? 'text-muted' : 'text-danger'}`}>
                  {option.price ? `${option.priceLabel ? `${option.priceLabel} ` : ''}${formatMoney(option.price.amount_cents, option.price.currency)}` : 'Sold out'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
