import { Link } from 'react-router'
import type { ProductSummary } from '../lib/catalog'
import { PriceTag } from './PriceTag'

/**
 * One product in a grid. The whole card is a single link to the product
 * page. Used by the store; any later list of products (homepage blocks,
 * search results) uses the same component, passing the heading level that
 * fits where it sits on that page.
 */
export function ProductCard({ product, headingLevel: Heading = 'h2' }: { product: ProductSummary; headingLevel?: 'h2' | 'h3' }) {
  return (
    <Link
      to={`/product/${product.slug}`}
      className="group flex h-full flex-col bg-card transition-transform duration-150 hover:-translate-y-1"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-panel">
        {product.cover_image_url && (
          <img
            src={product.cover_image_url}
            // Decorative: the product name is in the text right below.
            alt=""
            // Not lazy-loaded: each cover is about 1 KB, and lazy loading left
            // visible cards blank for a moment on the live site.
            width={600}
            height={800}
            className={`h-full w-full object-cover ${product.in_stock ? '' : 'opacity-40 grayscale'}`}
          />
        )}
        {/* Top right: the cover itself carries a type label (DLC, gift card) top left. */}
        <span className="absolute right-0 top-3 bg-black/60 px-2 py-1 text-[11px] font-extrabold">
          {product.platform.name}
        </span>
        {!product.in_stock && (
          <span className="absolute inset-x-0 bottom-0 bg-black/75 py-1.5 text-center text-xs font-extrabold uppercase tracking-wide">
            Sold out
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Heading className="line-clamp-2 text-[13px] font-extrabold leading-snug group-hover:underline">{product.name}</Heading>
        <p className="text-xs font-extrabold uppercase text-region">{product.region.name}</p>
        <div className="mt-auto pt-1">
          <PriceTag price={product.price} label="From" />
          {product.in_stock && (
            <p className="mt-1 text-xs text-muted">
              {product.offers_count} {product.offers_count === 1 ? 'offer' : 'offers'}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
