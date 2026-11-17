import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { OfferTable } from '../components/OfferTable'
import { PriceTag } from '../components/PriceTag'
import { Notice, primaryButton, secondaryButton } from '../components/States'
import { VariantList } from '../components/VariantList'
import { ApiError } from '../lib/api'
import { cart, useCart } from '../lib/cart'
import { fetchProduct, type Offer, type ProductDetail } from '../lib/catalog'
import { formatDate, formatMoney } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** One product: what it is, where else the game is sold, and every seller's offer. */
export function ProductPage() {
  const { slug = '' } = useParams()
  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug),
  })

  useDocumentTitle(product.data?.data.name ?? 'Product')

  if (product.isPending) return <ProductSkeleton />

  if (product.error instanceof ApiError && product.error.status === 404) {
    return (
      <div className="pt-8">
        <Notice title="Product not found">
          <p>This product does not exist, or is no longer sold.</p>
          <Link to="/store" className={primaryButton}>
            Browse the store
          </Link>
        </Notice>
      </div>
    )
  }

  if (product.isError) {
    return (
      <div className="pt-8">
        <Notice title="The product could not be loaded" tone="error">
          <p>The server may be starting up. This can take up to a minute.</p>
          <button type="button" className={primaryButton} onClick={() => product.refetch()}>
            Try again
          </button>
        </Notice>
      </div>
    )
  }

  return <ProductView product={product.data.data} />
}

function ProductView({ product }: { product: ProductDetail }) {
  const purchasable = product.offers.filter((offer) => offer.in_stock)
  const best = purchasable[0]
  const cartItems = useCart()
  const inCart = Object.fromEntries(cartItems.map((item) => [item.offerId, item.quantity]))

  // The cart keeps the chosen seller's offer. The name and price stored
  // with it are only what was shown here; the cart re-checks them.
  const addToCart = (offer: Offer) =>
    cart.add({
      offerId: offer.id,
      unitPriceCents: offer.price.amount_cents,
      productName: product.name,
      sellerName: offer.seller.name,
    })

  return (
    <article>
      <nav aria-label="Breadcrumb" className="py-4 text-sm text-muted">
        <Link to="/store" className="underline hover:text-accent">
          Store
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{product.game.title}</span>
      </nav>

      <div className="grid gap-6 md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr_340px]">
        <div className="mx-auto w-44 md:mx-0 md:w-full">
          {product.cover_image_url && (
            <img
              src={product.cover_image_url}
              alt={`Cover of ${product.game.title}`}
              width={600}
              height={800}
              className={`w-full ${product.in_stock ? '' : 'opacity-50 grayscale'}`}
            />
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold leading-tight sm:text-[26px]">{product.name}</h1>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
            <Fact term="Platform" value={product.platform.name} />
            <Fact term="Region" value={product.region.name} highlight />
            <Fact term="Type" value={typeLabels[product.type] ?? product.type} />
            <Fact term="Released" value={product.release_date ? formatDate(product.release_date) : 'Not applicable'} />
          </dl>

          {product.game.description && <p className="mt-6 max-w-prose leading-relaxed text-muted">{product.game.description}</p>}
        </div>

        {/* The buy box: the best price, where it comes from, and how many alternatives there are. */}
        <section aria-label="Best offer" className="self-start bg-panel p-5 md:col-span-2 lg:col-span-1">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{best ? 'Best offer' : 'Availability'}</p>
          <div className="mt-2">
            <PriceTag price={product.price} size="large" />
          </div>
          {best ? (
            <>
              <p className="mt-3 text-sm">
                Sold by <span className="font-extrabold">{best.seller.name}</span>
              </p>
              {purchasable.length > 1 && (
                <p className="mt-1 text-sm text-muted">
                  +{purchasable.length - 1} more {purchasable.length === 2 ? 'offer' : 'offers'}, up to{' '}
                  {formatMoney(purchasable[purchasable.length - 1].price.amount_cents, purchasable[purchasable.length - 1].price.currency)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">Every seller is out of keys for this version right now.</p>
          )}
          {best && (
            <>
              <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={() => addToCart(best)}>
                Add to cart
              </button>
              <p role="status" className="mt-2 min-h-5 text-sm">
                {inCart[best.id] > 0 && (
                  <>
                    {inCart[best.id]} in your cart.{' '}
                    <Link to="/cart" className="font-extrabold underline hover:text-accent">
                      View cart
                    </Link>
                  </>
                )}
              </p>
            </>
          )}
          <a href="#offers" className={`${best ? secondaryButton : primaryButton} ${best ? 'mt-2' : 'mt-5'} w-full`}>
            Compare {product.offers.length} {product.offers.length === 1 ? 'offer' : 'offers'}
          </a>
        </section>
      </div>

      {product.variants.length > 0 && (
        <section aria-labelledby="variants-heading" className="mt-10">
          <h2 id="variants-heading" className="mb-3 text-xl font-bold">
            Other platforms and regions
          </h2>
          <VariantList variants={product.variants} />
        </section>
      )}

      <section id="offers" aria-labelledby="offers-heading" className="mt-10 scroll-mt-4">
        <h2 id="offers-heading" className="mb-1 text-xl font-bold">
          Offers from sellers
        </h2>
        <OfferTable offers={product.offers} inCart={inCart} onAdd={addToCart} />
      </section>
    </article>
  )
}

const typeLabels: Record<string, string> = {
  game: 'Game',
  dlc: 'DLC',
  gift_card: 'Gift card',
  subscription: 'Subscription',
}

function Fact({ term, value, highlight = false }: { term: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-extrabold uppercase text-muted">{term}</dt>
      <dd className={`mt-1 font-extrabold ${highlight ? 'text-region' : ''}`}>{value}</dd>
    </div>
  )
}

function ProductSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="grid animate-pulse gap-6 pt-14 md:grid-cols-[220px_1fr]">
      <div className="mx-auto aspect-[3/4] w-44 bg-card md:w-full" />
      <div className="space-y-4">
        <div className="h-8 w-3/4 bg-card" />
        <div className="h-4 w-1/2 bg-card" />
        <div className="h-24 w-full bg-card" />
      </div>
    </div>
  )
}
