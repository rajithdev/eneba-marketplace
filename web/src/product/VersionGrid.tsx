import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import type { ProductDetail } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { allVersions } from './choices'

/**
 * Every version of the game the API returned, this one included and marked,
 * each with its own lowest price or "Sold out". The others link to their own
 * pages. Platforms and regions the game is not sold for do not appear.
 */
export function VersionGrid({ product }: { product: ProductDetail }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {allVersions(product).map((version) => {
        const current = version.slug === product.slug
        const body = (
          <>
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-bold">
                <Icon name="platform" className="size-4 text-muted" />
                <span>{version.platform.name}</span>
              </span>
              <span className="mt-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-region">
                <Icon name="globe" className="size-4" />
                {version.region.name}
              </span>
            </span>
            <span className="text-right">
              {current && <span className="block text-[11px] font-bold uppercase tracking-wide text-accent">Viewing</span>}
              <span className={`block text-sm font-black ${version.price ? 'text-white' : 'text-muted'}`}>
                {version.price ? `From ${formatMoney(version.price.amount_cents, version.price.currency)}` : 'Sold out'}
              </span>
            </span>
          </>
        )
        const card = 'flex items-center justify-between gap-3 rounded-card border px-4 py-3.5'

        return (
          <li key={version.slug} className="spot-reveal">
            {current ? (
              <div aria-current="page" className={`${card} border-edge-lit/70 bg-[linear-gradient(90deg,rgb(106_51_224/0.25),rgb(21_8_53/0.7))]`}>
                {body}
              </div>
            ) : (
              <Link
                to={`/product/${version.slug}`}
                className={`${card} border-edge/25 bg-card-mid/70 transition-[border-color,background-color,translate] hover:border-edge-lit/70 hover:bg-card-top/80 motion-safe:hover:-translate-y-0.5`}
              >
                {body}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
