import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { LoadError, Notice, pageTop, primaryButton } from '../components/States'
import { ApiError } from '../lib/api'
import { cart, useCart } from '../lib/cart'
import { fetchProduct, type Offer, type ProductDetail } from '../lib/catalog'
import { formatDate } from '../lib/money'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { Backdrop, Cover } from '../product/Artwork'
import { BuyBar } from '../product/BuyBar'
import { buyableOffers, chosenOffer, isVersionOf, splitName } from '../product/choices'
import { PurchasePanel } from '../product/PurchasePanel'
import { SellerPicker } from '../product/SellerPicker'
import { VersionGrid } from '../product/VersionGrid'
import '../product/spotlight.css'

/**
 * One product, as a "spotlight": the game's artwork behind its title, a buy
 * panel beside it, every seller's offer, and the game's other versions.
 */
export function ProductPage() {
  const { slug = '' } = useParams()
  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: () => fetchProduct(slug),
    // Switching to another version of the same game keeps this page on
    // screen while the other loads, instead of blanking it; everything that
    // could buy is switched off meanwhile (see `busy`). Any other product
    // starts from the loading state.
    placeholderData: (previous) => (isVersionOf(previous?.data, slug) ? previous : undefined),
  })

  useDocumentTitle(product.isPlaceholderData ? 'Product' : (product.data?.data.name ?? 'Product'))

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

  // Keyed by product, so a newly opened version starts with its own cheapest offer chosen.
  return <ProductView key={product.data.data.slug} product={product.data.data} busy={product.isPlaceholderData} />
}

const typeLabels: Record<string, string> = {
  game: 'Game',
  dlc: 'DLC',
  gift_card: 'Gift card',
  subscription: 'Subscription',
}

const delay = (ms: number) => ({ '--spot-delay': `${ms}ms` }) as CSSProperties

function ProductView({ product, busy }: { product: ProductDetail; busy: boolean }) {
  const [chosenId, setChosenId] = useState<number | null>(null)
  const offer = chosenOffer(product.offers, chosenId)
  const cartItems = useCart()
  const inCart = Object.fromEntries(cartItems.map((item) => [item.offerId, item.quantity]))
  const addButton = useRef<HTMLButtonElement>(null)
  const end = useRef<HTMLDivElement>(null)

  const { title, rest } = splitName(product)
  const soldOut = offer === null
  const inStock = buyableOffers(product.offers).length

  // The cart keeps the chosen seller's offer. The name and price stored
  // with it are only what was shown here; the cart re-checks them.
  const addToCart = (chosen: Offer) =>
    cart.add({
      offerId: chosen.id,
      unitPriceCents: chosen.price.amount_cents,
      productName: product.name,
      sellerName: chosen.seller.name,
    })

  return (
    <article className="relative max-lg:pb-24">
      <Backdrop coverUrl={product.cover_image_url} dimmed={soldOut} />

      <nav aria-label="Breadcrumb" className="pt-6 text-sm text-muted">
        <Link to="/store" className="underline-offset-4 hover:text-accent hover:underline">
          Store
        </Link>
        <span aria-hidden="true" className="px-2 text-white/40">
          /
        </span>
        <span aria-current="page" className="text-white/90">
          {product.game.title}
        </span>
      </nav>

      {/*
        One column on a phone, in reading order: the title, the buy panel,
        the sellers, the versions. On a wide screen the buy panel moves into
        a column of its own beside all three, and stays in view while they
        scroll past, never beyond the end of them.
      */}
      <div className="mt-6 grid gap-x-10 gap-y-10 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto_1fr] xl:grid-cols-[minmax(0,1fr)_392px] xl:gap-x-14">
        <header className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-5 gap-y-6 sm:grid-cols-[11rem_minmax(0,1fr)] md:gap-x-8 lg:col-start-1 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="spot-enter sm:row-span-2" style={delay(80)}>
            <div className="spot-lift">
              <Cover coverUrl={product.cover_image_url} title={product.game.title} soldOut={soldOut} />
            </div>
          </div>

          <div className="spot-enter min-w-0 self-center sm:self-start sm:pt-2" style={delay(160)}>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-edge/40 bg-dusk/50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur">
              <Icon name="star" className="size-3.5 text-accent" />
              {typeLabels[product.type] ?? product.type}
            </p>
            <h1 className="mt-3 text-balance [text-shadow:0_2px_24px_rgb(10_4_32/0.6)]">
              <span className={`block font-black leading-[1.02] tracking-tight ${title.length > 22 ? 'text-[1.7rem] sm:text-4xl xl:text-5xl' : 'text-3xl sm:text-5xl xl:text-6xl'}`}>{title}</span>
              {rest && ' '}
              {rest && <span className="mt-2 block text-base font-bold text-white/75 sm:text-xl">{rest}</span>}
            </h1>

            <ul aria-label="Version" className="mt-4 flex flex-wrap gap-2 text-xs font-bold sm:text-sm">
              <Chip icon="platform">{product.platform.name}</Chip>
              <Chip icon="globe" tone="text-region">
                {product.region.name}
              </Chip>
            </ul>
          </div>

          <div className="spot-enter col-span-2 sm:col-span-1 sm:col-start-2 sm:-mt-2" style={delay(240)}>
            {product.game.description && <p className="max-w-xl text-[15px] leading-relaxed text-white/85">{product.game.description}</p>}

            <dl className="mt-5 grid max-w-md grid-cols-2 gap-3 text-sm">
              <Fact term="Released" value={product.release_date ? formatDate(product.release_date) : 'Not applicable'} />
              <Fact term="Sellers" value={`${inStock} in stock`} tone={inStock > 0 ? 'text-region' : 'text-muted'} />
            </dl>
          </div>
        </header>

        <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="spot-enter lg:pt-2 lg:[@media(min-height:44rem)]:sticky lg:[@media(min-height:44rem)]:top-6" style={delay(300)}>
            <PurchasePanel
              product={product}
              offer={offer}
              inCart={inCart}
              onAdd={addToCart}
              onChooseCheapest={() => setChosenId(null)}
              busy={busy}
              actionRef={addButton}
            />
          </div>
        </div>

        <section id="offers" aria-labelledby="offers-heading" className="scroll-mt-6 lg:col-start-1">
          <SectionHeading id="offers-heading" title="Compare sellers">
            {product.offers.length === 0
              ? `No offers for ${product.platform.name} · ${product.region.name}`
              : `${inStock} of ${product.offers.length} in stock for ${product.platform.name} · ${product.region.name}`}
          </SectionHeading>
          <SellerPicker offers={product.offers} chosenId={offer?.id ?? null} onChoose={(chosen) => setChosenId(chosen.id)} inCart={inCart} busy={busy} />
        </section>

        {product.variants.length > 0 && (
          <section aria-labelledby="versions-heading" className="lg:col-start-1">
            <SectionHeading id="versions-heading" title="Other platforms and regions">
              {product.game.title} is sold in {product.variants.length + 1} versions
            </SectionHeading>
            <VersionGrid product={product} />
          </section>
        )}
      </div>

      <div ref={end} aria-hidden="true" className="h-px" />
      <BuyBar offer={offer} onAdd={addToCart} busy={busy} action={addButton} end={end} />
    </article>
  )
}

function SectionHeading({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="spot-reveal mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="flex items-center gap-3 text-xl font-black sm:text-2xl">
        <span aria-hidden="true" className="h-6 w-1 rounded-full bg-accent" />
        {title}
      </h2>
      <p className="text-sm text-muted">{children}</p>
    </div>
  )
}

function Chip({ icon, tone = 'text-white', children }: { icon: 'platform' | 'globe'; tone?: string; children: ReactNode }) {
  return (
    <li className={`inline-flex items-center gap-2 rounded-full border border-edge/35 bg-dusk/55 px-3 py-1.5 backdrop-blur ${tone}`}>
      <Icon name={icon} className="size-4" />
      {children}
    </li>
  )
}

function Fact({ term, value, tone = '' }: { term: string; value: string; tone?: string }) {
  return (
    <div className="rounded-control border border-edge/20 bg-dusk/45 px-3 py-2.5 backdrop-blur">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">{term}</dt>
      <dd className={`mt-0.5 font-bold ${tone}`}>{value}</dd>
    </div>
  )
}

/** The page's shape while it loads: the dark hero, the cover, the title and the panel. */
function ProductSkeleton() {
  return (
    // At least a screen tall, so the footer is not shown and then pushed away when the page arrives.
    <div role="status" aria-label="Loading product" className="relative min-h-svh">
      <div aria-hidden="true" className="absolute left-1/2 top-[-11rem] -z-10 h-[40rem] w-screen -translate-x-1/2 bg-[radial-gradient(60rem_30rem_at_25%_35%,rgb(90_40_190/0.35),transparent_70%)]" />
      <div className="mt-6 grid animate-pulse gap-10 pt-6 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_392px]">
        <div className="grid grid-cols-[7rem_1fr] gap-5 sm:grid-cols-[11rem_1fr] md:gap-8 xl:grid-cols-[15rem_1fr]">
          <div className="aspect-[3/4] rounded-card bg-card" />
          <div className="space-y-4 pt-2">
            <div className="h-5 w-24 rounded-full bg-card" />
            <div className="h-12 w-4/5 rounded-control bg-card" />
            <div className="h-5 w-1/2 rounded-control bg-card" />
            <div className="h-20 w-full rounded-control bg-card" />
          </div>
        </div>
        <div className="h-96 rounded-[1.25rem] bg-card" />
      </div>
    </div>
  )
}
