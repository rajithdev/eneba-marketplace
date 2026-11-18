import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { cart } from '../lib/cart'
import { fetchProduct, type ProductSummary } from '../lib/catalog'
import { useSingleFlight } from '../lib/useSingleFlight'
import { Icon } from './Icon'
import { Spinner } from './States'

/*
 * Buying from a place that only shows a product's best price: a deals card,
 * a panel in the showroom. Such a place does not know which seller's offer
 * that price is, so the product is asked for first (the same request the
 * product page makes) and its first offer that can be bought is taken: the
 * API lists offers that can be bought first, cheapest first. The cart then
 * holds that offer, exactly as if it had been added on the product page,
 * and the cart page has the server check it before anything is paid.
 */

const base = 'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-extrabold text-white active:translate-y-px disabled:opacity-70 sm:text-sm'
const filled = `${base} border border-[#c4a2ff]/50 bg-[linear-gradient(180deg,#9a5cff_0%,#6d2fe0_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110`
const outlined = `${base} border border-[#c4a2ff]/70 bg-white/5 hover:border-white hover:bg-white/10`

/** Puts the product's best offer that can be bought in the cart. Answers whether there was one. */
function useAddBestOffer(product: ProductSummary) {
  const queryClient = useQueryClient()

  return useSingleFlight(async () => {
    const { data } = await queryClient.fetchQuery({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug) })
    const best = data.offers.find((offer) => offer.in_stock)
    if (!best) return false

    cart.add({ offerId: best.id, unitPriceCents: best.price.amount_cents, productName: data.name, sellerName: best.seller.name })
    return true
  })
}

/**
 * Buys at the price shown: the best offer goes in the cart and the cart
 * opens. If that cannot be done (sold out in the meantime, or the request
 * fails) the product page opens instead, which shows what is the matter.
 */
export function BuyNow({ product }: { product: ProductSummary }) {
  const navigate = useNavigate()
  const add = useAddBestOffer(product)
  const [busy, setBusy] = useState(false)

  const buy = async () => {
    setBusy(true)
    try {
      await navigate((await add()) ? '/cart' : `/product/${product.slug}`)
    } catch {
      await navigate(`/product/${product.slug}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={filled} disabled={busy || !product.in_stock} aria-label={`Buy ${product.name} now`} onClick={() => void buy()}>
      {busy ? <Spinner /> : <Icon name="cart" className="size-4" />}
      {product.in_stock ? 'Buy Now' : 'Sold out'}
    </button>
  )
}

/** Puts the best offer in the cart and stays where it is, saying so for a moment. Opens the product page if it cannot. */
export function AddToCart({ product }: { product: ProductSummary }) {
  const navigate = useNavigate()
  const add = useAddBestOffer(product)
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle')

  // "Added" goes back to the button after a moment.
  useEffect(() => {
    if (state !== 'added') return
    const timer = setTimeout(() => setState('idle'), 2500)
    return () => clearTimeout(timer)
  }, [state])

  const addIt = async () => {
    setState('busy')
    try {
      if (await add()) return setState('added')
      await navigate(`/product/${product.slug}`)
    } catch {
      await navigate(`/product/${product.slug}`)
    }
    setState('idle')
  }

  return (
    <button type="button" className={outlined} disabled={state === 'busy' || !product.in_stock} aria-label={`Add ${product.name} to the cart`} onClick={() => void addIt()}>
      {state === 'busy' && <Spinner />}
      {/* Announced when it changes, for those who cannot see the button. */}
      <span aria-live="polite">{state === 'added' ? 'Added ✓' : 'Add to cart'}</span>
    </button>
  )
}
