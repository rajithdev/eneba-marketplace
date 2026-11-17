import { Link } from 'react-router'
import type { ProductSummary } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { surface } from './States'

/** The same game on other platforms and regions, each linking to its own page. */
export function VariantList({ variants }: { variants: ProductSummary[] }) {
  if (variants.length === 0) return null

  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {variants.map((variant) => (
        <li key={variant.slug}>
          <Link
            to={`/product/${variant.slug}`}
            className={`flex items-center justify-between gap-3 px-4 py-3 ${surface} hover:border-region`}
          >
            <span>
              <span className="block text-sm font-extrabold">{variant.platform.name}</span>
              <span className="block text-xs font-extrabold uppercase text-region">{variant.region.name}</span>
            </span>
            <span className={`text-sm font-extrabold ${variant.price ? '' : 'text-muted'}`}>
              {variant.price ? `From ${formatMoney(variant.price.amount_cents, variant.price.currency)}` : 'Sold out'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
