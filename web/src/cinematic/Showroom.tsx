import { useId, useState } from 'react'
import { Link } from 'react-router'
import { AddToCart, BuyNow } from '../components/BuyButtons'
import { pageTitle } from '../components/States'
import { coverGame } from '../lib/coverArt'
import type { HomepageBlock } from '../lib/homepage'
import { formatMoney } from '../lib/money'
import type { Panel } from './stage'

type Product = NonNullable<HomepageBlock['data']['products']>[number]

/*
 * The deals block as a showroom: the scroll section's last frame shows each
 * product on a lit panel, and the panels themselves are the cards. Pointing
 * at one (or pressing it, or reaching it with the keyboard) brings up what
 * the API says about that product, with buttons to add it to the cart or
 * buy it. Nothing is read from the picture: a panel only knows which game
 * it shows, and the product is the one in the block for that game.
 *
 * stage.ts puts each item where its panel is drawn. An item's own shape,
 * the outline that lights up and the area that answers the pointer, comes
 * from the panel's corners.
 */
export function Showroom({ block, panels }: { block: HomepageBlock; panels: Panel[] }) {
  const headingId = useId()
  const [pinned, setPinned] = useState<string | null>(null) // the game whose details were opened by pressing its panel
  const products = block.data.products ?? []

  return (
    <section aria-labelledby={headingId} className="h-full" onKeyDown={(event) => event.key === 'Escape' && setPinned(null)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-[linear-gradient(180deg,rgb(8_3_24/0.75),transparent)] px-6 pb-16 pt-8 sm:px-10">
        <h2 id={headingId} className={pageTitle}>
          {block.title ?? 'Deals'}
        </h2>
        <p className="mt-1 text-sm font-bold text-muted">Choose a game to see its price and buy it.</p>
      </div>

      <ul>
        {panels.map((panel, index) => {
          const product = products.find((candidate) => coverGame(candidate.cover_image_url) === panel.game)

          return product ? <PanelItem key={panel.game} index={index} panel={panel} product={product} open={pinned === panel.game} onToggle={() => setPinned(pinned === panel.game ? null : panel.game)} /> : null
        })}
      </ul>
    </section>
  )
}

/** The panel's corners inside the box that holds them, as percentages of it: "12.5% 0%, ...". */
function shapeOf(panel: Panel) {
  const xs = panel.quad.map(([x]) => x)
  const ys = panel.quad.map(([, y]) => y)
  const [left, top] = [Math.min(...xs), Math.min(...ys)]
  const [width, height] = [Math.max(...xs) - left, Math.max(...ys) - top]

  return panel.quad.map(([x, y]) => [((x - left) / width) * 100, ((y - top) / height) * 100])
}

const details =
  'pointer-events-auto invisible absolute left-[var(--details-left,0px)] top-[58%] z-10 w-60 rounded-xl border border-[#b08cff]/70 ' +
  'bg-[linear-gradient(180deg,rgb(31_12_73/0.97)_0%,rgb(14_5_38/0.97)_100%)] p-3 text-center opacity-0 shadow-[0_0_22px_-2px_rgb(168_85_247/0.7)] ' +
  'transition-[opacity,transform,visibility] duration-200 motion-safe:translate-y-2 ' +
  'group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 ' +
  'data-[open=true]:visible data-[open=true]:translate-y-0 data-[open=true]:opacity-100'

function PanelItem({ index, panel, product, open, onToggle }: { index: number; panel: Panel; product: Product; open: boolean; onToggle: () => void }) {
  const shape = shapeOf(panel)
  const clip = `polygon(${shape.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(', ')})`
  const price = product.price

  return (
    // The box around the panel answers nothing itself: only the panel's own shape and the details do.
    <li data-panel={index} className="group pointer-events-none absolute">
      {/* The panel's outline, lit while it is chosen. */}
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[open=true]:opacity-100">
        <polygon points={shape.map(([x, y]) => `${x},${y}`).join(' ')} fill="rgb(255 255 255 / 0.06)" stroke="#fff" strokeWidth="3" vectorEffect="non-scaling-stroke" className="drop-shadow-[0_0_10px_rgb(216_180_254)]" />
      </svg>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${product.name}: price and buying`}
        className="absolute inset-0 cursor-pointer"
        // Pressable once the camera has arrived (stage.ts says when).
        style={{ clipPath: clip, pointerEvents: 'var(--panel-pointer, auto)' as 'auto' }}
        onClick={onToggle}
      />

      <div className={details} data-open={open}>
        <Link to={`/product/${product.slug}`} className="block text-sm font-black uppercase leading-tight tracking-wide hover:underline">
          {product.name}
        </Link>
        {price === null ? (
          <p className="mt-2 text-lg font-extrabold text-muted">Sold out</p>
        ) : (
          <>
            <p className="mt-2 flex items-center justify-center gap-2">
              {price.discount_percent !== null && (
                <span className="rounded-md border border-[#c4a2ff]/40 bg-[linear-gradient(180deg,#8b4dff_0%,#5b21c9_100%)] px-2 py-0.5 text-sm font-black leading-tight">
                  <span className="sr-only">Save </span>−{price.discount_percent}%
                </span>
              )}
              <span className="text-2xl font-black leading-tight">{formatMoney(price.amount_cents, price.currency)}</span>
            </p>
            <p className="text-xs font-bold text-muted">
              {price.original_amount_cents !== null && (
                <>
                  <s>
                    <span className="sr-only">Was </span>
                    {formatMoney(price.original_amount_cents, price.currency)}
                  </s>
                  {' · '}
                </>
              )}
              {product.offers_count} {product.offers_count === 1 ? 'offer' : 'offers'}
            </p>
          </>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AddToCart product={product} />
          <BuyNow product={product} />
        </div>
      </div>
    </li>
  )
}
