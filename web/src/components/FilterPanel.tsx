import { useState, type FormEvent } from 'react'
import type { FiltersResponse } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { smallSecondaryButton } from './States'
import { centsToEuros, eurosToCents, selected, withToggled, withValue, type ListFilter } from '../lib/storeParams'

interface Props {
  /** Everything listed here comes from GET /api/filters. */
  options: FiltersResponse['data']
  params: URLSearchParams
  /** Called with the new URL parameters whenever a filter changes. */
  onChange: (next: URLSearchParams) => void
}

/**
 * The store's filters. It keeps no state of its own about what is selected:
 * it reads the URL parameters it is given and reports the parameters it
 * would like instead.
 */
export function FilterPanel({ options, params, onChange }: Props) {
  return (
    <div className="space-y-3">
      {/* The key makes the fields start again from the URL whenever the URL's
          price changes by other means (back button, "Clear filters"). */}
      <PriceRange
        key={`${params.get('min_price')}|${params.get('max_price')}`}
        options={options}
        params={params}
        onChange={onChange}
      />
      <CheckboxGroup
        title="Product type"
        filter="type"
        items={options.types.map((type) => ({ value: type.value, label: type.label, count: type.products_count }))}
        params={params}
        onChange={onChange}
      />
      <CheckboxGroup
        title="Platform"
        filter="platform"
        items={options.platforms.map((item) => ({ value: item.slug, label: item.name, count: item.products_count }))}
        params={params}
        onChange={onChange}
      />
      <CheckboxGroup
        title="Region"
        filter="region"
        items={options.regions.map((item) => ({ value: item.slug, label: item.name, count: item.products_count }))}
        params={params}
        onChange={onChange}
      />
    </div>
  )
}

const groupTitle = 'bg-panel px-4 py-3 text-base font-extrabold'

function CheckboxGroup(props: {
  title: string
  filter: ListFilter
  items: { value: string; label: string; count: number }[]
  params: URLSearchParams
  onChange: (next: URLSearchParams) => void
}) {
  const chosen = selected(props.params, props.filter)

  return (
    <fieldset className="bg-card">
      <legend className={`${groupTitle} float-left w-full`}>{props.title}</legend>
      <ul className="clear-both space-y-1 p-3">
        {props.items.map((item) => (
          <li key={item.value}>
            <label className="flex cursor-pointer items-center gap-3 px-1 py-1.5 text-sm hover:text-accent">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={chosen.includes(item.value)}
                onChange={() => props.onChange(withToggled(props.params, props.filter, item.value))}
              />
              <span className="flex-1">{item.label}</span>
              <span className="text-xs text-muted" aria-label={`${item.count} products`}>
                {item.count}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

function PriceRange({ options, params, onChange }: Props) {
  const [min, setMin] = useState(centsToEuros(params.get('min_price')))
  const [max, setMax] = useState(centsToEuros(params.get('max_price')))

  function apply(event: FormEvent) {
    event.preventDefault()
    onChange(withValue(withValue(params, 'min_price', eurosToCents(min)), 'max_price', eurosToCents(max)))
  }

  const { min_cents, max_cents, currency } = options.price
  const field = 'h-10 w-full min-w-0 border border-line bg-page px-2 text-sm text-white placeholder:text-muted'

  return (
    <form onSubmit={apply} className="bg-card">
      <fieldset>
        <legend className={`${groupTitle} float-left w-full`}>Price range ({currency})</legend>
        <div className="clear-both space-y-3 p-3">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="min-price">
              Minimum price
            </label>
            <input id="min-price" inputMode="decimal" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} className={field} />
            <span aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="max-price">
              Maximum price
            </label>
            <input id="max-price" inputMode="decimal" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} className={field} />
          </div>
          {min_cents !== null && max_cents !== null && (
            <p className="text-xs text-muted">
              Currently {formatMoney(min_cents, currency)} to {formatMoney(max_cents, currency)}
            </p>
          )}
          <button type="submit" className={`${smallSecondaryButton} w-full`}>
            Apply price
          </button>
        </div>
      </fieldset>
    </form>
  )
}
