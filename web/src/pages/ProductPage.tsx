import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { OfferTable } from '../components/OfferTable'
import { PriceTag } from '../components/PriceTag'
import { LoadError, Notice, pageTitle, pageTop, primaryButton, raised, secondaryButton, sectionTitle } from '../components/States'
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
      <div className={pageTop}>
        <Notice title="Product not found" heading="h1">
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
      <div className={pageTop}>
        <LoadError title="The product could not be loaded" error={product.error} retry={() => product.refetch()} heading="h1" />
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
      <nav aria-label="Breadcrumb" className={`pb-4 text-sm text-muted ${pageTop}`}>
        <Link to="/store" className="underline hover:text-accent">
          Store
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{product.game.title}</span>
      </nav>

      {/*
        On a phone: a small cover beside the title, then straight to the
        price and "Add to cart", then the details. The details come first
        in the page's own order (and on wider screens); `order` only moves
        what a phone shows, and nothing in them takes keyboard focus.
      */}
      <div className="grid grid-cols-[104px_1fr] gap-x-4 gap-y-5 md:grid-cols-[220px_1fr] md:gap-6 lg:grid-cols-[220px_1fr_340px]">
        <div className="order-1 md:order-none">
          {product.cover_image_url && (
            <img
              src={product.cover_image_url}
              alt={`Cover of ${product.game.title}`}
              width={600}
              height={800}
              className={`w-full rounded-card shadow-card ${product.in_stock ? '' : 'opacity-50 grayscale'}`}
            />
          )}
        </div>

        <div className="contents md:block">
          <h1 className={`order-2 self-center md:order-none ${pageTitle}`}>{product.name}</h1>

          <dl className="order-4 col-span-2 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4 md:order-none md:mt-5 md:grid-cols-2 xl:grid-cols-4">
            <Fact term="Platform" value={product.platform.name} />
            <Fact term="Region" value={product.region.name} highlight />
            <Fact term="Type" value={typeLabels[product.type] ?? product.type} />
            <Fact term="Released" value={product.release_date ? formatDate(product.release_date) : 'Not applicable'} />
          </dl>

          {product.game.description && (
            <p className="order-5 col-span-2 max-w-prose leading-relaxed text-muted md:order-none md:mt-6">{product.game.description}</p>
          )}
        </div>

        {/* The buy box: the best price, where it comes from, and how many alternatives there are. */}
        <section aria-label="Best offer" className={`order-3 col-span-2 self-start p-5 md:order-none lg:sticky lg:top-4 lg:col-span-1 ${raised}`}>
          <p className={`text-xs font-extrabold uppercase tracking-wide ${best ? 'text-accent' : 'text-muted'}`}>{best ? 'Best offer' : 'Availability'}</p>
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
              <button type="button" className={`${primaryButton} mt-5 h-12 w-full text-base`} onClick={() => addToCart(best)}>
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
          <h2 id="variants-heading" className={`mb-3 ${sectionTitle}`}>
            Other platforms and regions
          </h2>
          <VariantList variants={product.variants} />
        </section>
      )}

      <section id="offers" aria-labelledby="offers-heading" className="mt-10 scroll-mt-4">
        <h2 id="offers-heading" className={`mb-2 ${sectionTitle}`}>
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
    <div role="status" aria-label="Loading product" className="grid animate-pulse grid-cols-[104px_1fr] gap-x-4 gap-y-5 pt-[68px] md:grid-cols-[220px_1fr] md:gap-6">
      <div className="aspect-[3/4] w-full rounded-card bg-card" />
      <div className="space-y-4">
        <div className="h-8 w-3/4 rounded-control bg-card" />
        <div className="h-4 w-1/2 rounded-control bg-card" />
        <div className="h-24 w-full rounded-card bg-card" />
      </div>
    </div>
  )
}
