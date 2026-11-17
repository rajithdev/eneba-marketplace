import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BestSellersBlock, DealsBlock, FeaturedBlock, HeroBlock } from '../components/HomeBlocks'
import { primaryButton, secondaryButton } from '../components/States'
import { fetchHomepage, type HomepageBlock } from '../lib/homepage'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** Which component draws which type of block. A type not listed here is skipped. */
const blockComponents: Record<string, (props: { block: HomepageBlock }) => ReactNode> = {
  hero_banner: HeroBlock,
  best_sellers: BestSellersBlock,
  deals: DealsBlock,
  featured: FeaturedBlock,
}

/**
 * The homepage. It asks the API for the blocks and draws them in the order
 * they arrive, each with the component for its type. Which blocks there
 * are, their order, titles, banners and products are all the backend's
 * (see BuildHomepage); changing the homepage is a database change.
 *
 * The only content of its own is the introduction shown when there are no
 * blocks to draw or the API cannot be reached, so the page is never blank.
 */
export function HomePage() {
  useDocumentTitle('Digital game keys')
  const homepage = useQuery({ queryKey: ['homepage'], queryFn: fetchHomepage })

  if (homepage.isPending) return <HomeSkeleton />

  const blocks = (homepage.data?.data.blocks ?? []).filter((block) => block.type in blockComponents)

  if (blocks.length === 0) {
    return (
      <section className="py-16 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-black leading-tight sm:text-5xl">Game keys, gift cards and subscriptions</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">Compare offers from several sellers and pick the price that suits you.</p>
        {homepage.isError && (
          <p role="alert" className="mt-4 max-w-xl text-danger">
            The homepage could not be loaded. The server may be starting up, which can take up to a minute.
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/store" className={primaryButton}>
            Browse the store
          </Link>
          {homepage.isError && (
            <button type="button" className={secondaryButton} onClick={() => homepage.refetch()}>
              Try again
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <>
      <h1 className="sr-only">Game keys, gift cards and subscriptions</h1>
      {blocks.map((block) => {
        const Component = blockComponents[block.type]
        return <Component key={block.id} block={block} />
      })}
    </>
  )
}

/** Grey shapes where the hero and the first shelf will be. */
function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading the homepage" className="animate-pulse pt-6">
      <div className="h-[300px] bg-panel sm:h-[380px]" />
      <div className="mt-10 h-8 w-48 bg-card" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[120px] bg-card" />
        ))}
      </div>
    </div>
  )
}
