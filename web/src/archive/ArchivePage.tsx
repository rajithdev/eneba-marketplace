import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { LoadError, Notice, pageTop, primaryButton } from '../components/States'
import { ApiError } from '../lib/api'
import { fetchFilters, fetchProducts, type FiltersResponse, type ProductSummary } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { activeFilterCount, apiQuery, selected as chosenValues, withValue, withoutFilters } from '../lib/storeParams'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { StorePage } from '../pages/StorePage'
import { ArchiveRail } from './ArchiveRail'
import { ArchiveStage, type Plate } from './ArchiveStage'
import { CaseDetails } from './CaseDetails'
import './archive.css'

/**
 * Where the stage runs: a window wide and tall enough for a row of cases
 * with room under it, and a visitor who has not asked for reduced motion.
 * Everywhere else gets the rail (see ArchiveRail).
 */
const STAGE_FITS = '(min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)'

/** When the chosen case is this close to the last one fetched, the next page of the catalog is asked for. */
const FETCH_AHEAD = 10

/**
 * The Game Archive: the store's catalog as a shelf of boxed games to walk
 * along, instead of a grid to scan. A prototype, at its own address; the
 * store page is untouched.
 *
 * It is the same catalog, asked for the same way. The address holds the
 * same parameters as the store's (type, platform, region, price, sort,
 * search), this page sends them to the same endpoint, and "Browse all"
 * opens the ordinary filterable list with them kept. The shelf draws what
 * the API answers, in the API's order: which products there are, their
 * names, platforms, regions, prices and stock are never decided here.
 *
 * The API gives the catalog a page at a time. The shelf starts with the
 * first and asks for the next when the visitor gets near the end of what it
 * has, so a long catalog is never fetched whole.
 */
export function ArchivePage() {
  useDocumentTitle('Game Archive')
  const [params] = useSearchParams()
  // Everything the address says except the page: the shelf has no pages.
  const query = apiQuery(withValue(params, 'page', null))
  const spatial = useMatches(STAGE_FITS)

  const shelf = useInfiniteQuery({
    queryKey: ['archive', query],
    queryFn: ({ pageParam }) => fetchProducts([query, pageParam > 1 ? `page=${pageParam}` : ''].filter(Boolean).join('&')),
    initialPageParam: 1,
    getNextPageParam: (page) => (page.meta.current_page < page.meta.last_page ? page.meta.current_page + 1 : undefined),
  })
  const products = useMemo(() => shelf.data?.pages.flatMap((page) => page.data) ?? [], [shelf.data])
  const total = shelf.data?.pages[0].meta.total ?? 0
  const { shelfName, orderName } = useShelfChoices()

  // The API rejected the address itself (a mistyped filter), or its host's firewall refused the search text: see StorePage.
  const invalidAddress = shelf.error instanceof ApiError && shelf.error.status === 422
  const refused = shelf.error instanceof ApiError && shelf.error.status === 403
  const header = <ArchiveHeader total={shelf.data ? total : null} />

  if (products.length > 0) {
    return (
      // A different set of products is a different shelf, starting again at its first case.
      <Shelf
        key={query}
        products={products}
        total={total}
        spatial={spatial}
        fromTop={shelf.isFetchedAfterMount}
        header={header}
        plates={{
          start: { above: 'Keymarket archive', name: shelfName, below: [orderName, `${total} ${total === 1 ? 'title' : 'titles'}`].filter(Boolean) },
          end: shelf.hasNextPage ? null : { above: 'End of shelf', name: shelfName, below: [`${total} ${total === 1 ? 'title' : 'titles'}`] },
        }}
        fetchMore={shelf.hasNextPage && !shelf.isFetchingNextPage ? () => void shelf.fetchNextPage() : null}
      />
    )
  }

  return (
    <>
      {header}
      {/* As tall as the shelf it stands in for, so the footer is not seen to jump away when the shelf arrives. */}
      {shelf.isPending && (
        <div role="status" aria-label="Loading the archive" className="flex min-h-[100svh] items-start justify-center pt-24">
          <div className="aspect-[3/4] w-56 animate-pulse rounded-card bg-card" />
        </div>
      )}
      {(invalidAddress || refused) && (
        <Notice title={invalidAddress ? 'These filters are not valid' : 'This search could not be run'} tone="error">
          <p>{invalidAddress ? 'The address contains a filter the store does not recognise.' : 'The request was refused before it reached the store. Try different words.'}</p>
          <Link to="/archive" className={primaryButton}>
            Show the whole archive
          </Link>
        </Notice>
      )}
      {shelf.isError && !invalidAddress && !refused && <LoadError title="The archive could not be loaded" error={shelf.error} retry={() => void shelf.refetch()} />}
      {shelf.data && (
        <Notice title="Nothing in the archive matches">
          <p>Try another shelf, or remove a filter.</p>
          <Link to="/archive" className={primaryButton}>
            Show the whole archive
          </Link>
        </Notice>
      )}
    </>
  )
}

/**
 * "Browse all": the ordinary catalog, with its filters, sorting and pages,
 * for anyone who would rather scan a list than walk a shelf. It is the
 * store page itself, not a copy of it, under the archive's two-way switch.
 */
export function ArchiveBrowsePage() {
  return (
    <>
      <div className={`flex justify-end ${pageTop}`}>
        <ViewSwitch view="list" />
      </div>
      {/* The store page brings its own space above its title; the switch already left some. */}
      <div className="-mt-4">
        <StorePage />
      </div>
    </>
  )
}

/** A shelf of products and which one is chosen. */
function Shelf({
  products,
  total,
  spatial,
  fromTop,
  header,
  plates,
  fetchMore,
}: {
  products: ProductSummary[]
  total: number
  spatial: boolean
  /** Whether this shelf had to be waited for (a first visit, a reload, another filter), as opposed to coming back to one already fetched. */
  fromTop: boolean
  header: ReactNode
  plates: { start: Plate; end: Plate | null }
  fetchMore: (() => void) | null
}) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(0)
  const chosen = products[Math.min(selected, products.length - 1)]
  // As it was when the shelf first appeared; the answer changes once a shelf that was kept has been fetched again.
  const [waitedFor] = useState(fromTop)

  useEffect(() => {
    if (fetchMore && selected >= products.length - FETCH_AHEAD) fetchMore()
  }, [selected, products.length, fetchMore])

  const View = spatial ? ArchiveStage : ArchiveRail

  return (
    <>
      {waitedFor && <StartAtTop />}
      <View
        products={products}
        selected={selected}
        onSelect={setSelected}
        onOpen={(product) => void navigate(`/product/${product.slug}`)}
        label={(product) => `${product.name}, ${product.price ? `from ${formatMoney(product.price.amount_cents, product.price.currency)}` : 'sold out'}`}
        plates={plates}
        header={header}
      >
        <CaseDetails product={chosen} position={selected + 1} total={total} />
      </View>
    </>
  )
}

/**
 * A shelf that had to be waited for starts at its first case. While it was
 * on its way the page was too short to be put back where a reload or a
 * revisit last left it, and would otherwise open a few hundred pixels down,
 * on whichever case that happens to be. (Coming back from a product page
 * finds the shelf still held, and returns to the case that was left.)
 */
function StartAtTop() {
  useLayoutEffect(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  return null
}

/**
 * The top of the archive: its title, the switch to the ordinary list, and
 * the shelves to choose from. The shelves are the product types the API
 * reports, with its own names for them, and the orders are the ones it
 * offers; choosing one changes the address, as on the store page.
 */
function ArchiveHeader({ total }: { total: number | null }) {
  const [params, setParams] = useSearchParams()
  const { options, types, searchTerm, sortOptions, defaultSort, sort } = useShelfChoices()
  // Filters set in "Browse all" (a platform, a region, a price) narrow the shelf too.
  const narrowed = activeFilterCount(params) - types.length > 0 || searchTerm !== ''

  return (
    // Two rows: the title with the order and the switch, then the shelves. On a wide window, one.
    <div className="pt-4 sm:pt-5 xl:flex xl:items-center xl:gap-4 xl:pt-7">
      <div className="flex items-center gap-2 sm:gap-3 xl:contents">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 xl:flex-none">
          <Icon name="gamepad" className="hidden size-6 text-(--ga-violet-lit) min-[350px]:block min-[390px]:size-7 sm:size-9" />
          <h1 className="text-xl font-black leading-none tracking-tight whitespace-nowrap min-[390px]:text-[1.375rem] sm:text-[1.75rem]">Game Archive</h1>
          {/* Announced to screen readers whenever the shelf changes. (In a narrow window it is read out but not shown: the count is under the shelf.) */}
          <p aria-live="polite" className="sr-only text-sm text-muted md:not-sr-only md:ml-1 md:border-l md:border-white/15 md:pl-4 md:whitespace-nowrap">
            {total !== null && (
              <>
                <span className="font-extrabold text-white">{total}</span> {total === 1 ? 'title' : 'titles'}
                {narrowed && ' match your filters'}
              </>
            )}
          </p>
          {narrowed && (
            <Link to={{ search: withValue(withoutFilters(params), 'q', null).toString() }} className="text-sm font-extrabold whitespace-nowrap underline hover:text-(--ga-violet-lit)">
              Clear filters
            </Link>
          )}
        </div>

        {/* Its place is kept while the orders are on their way, so the switch beside it does not move when they arrive. */}
        <div className="min-h-10 min-w-10 shrink-0 min-[390px]:min-w-11 sm:min-w-40 xl:order-3 xl:ml-auto xl:border-l xl:border-white/15 xl:pl-4">
          {options && (
            <label className="flex items-center gap-3 text-sm">
              <span className="sr-only text-muted lg:not-sr-only xl:sr-only">Shelved by</span>
              <span className="relative">
                {/* On a phone the menu is a button with a picture; its list still names every order. */}
                <select
                  value={sort}
                  // The default order needs no parameter: /archive stays /archive.
                  onChange={(event) => setParams(withValue(params, 'sort', event.target.value === defaultSort ? null : event.target.value))}
                  className="ga-glass ga-select h-10 w-10 rounded-xl font-extrabold min-[390px]:w-11 sm:w-auto sm:pr-9 sm:pl-3.5"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Icon name="sort" className="pointer-events-none absolute top-1/2 left-1/2 size-[18px] -translate-1/2 sm:hidden" />
                <Icon name="chevron" className="pointer-events-none absolute top-1/2 right-3 hidden size-4 -translate-y-1/2 sm:block" />
              </span>
            </label>
          )}
        </div>
        <ViewSwitch view="shelf" className="xl:order-4" />
      </div>

      {/* The shelves: on a phone a row that scrolls sideways, edge to edge. */}
      <nav aria-label="Shelves" className="-mx-4 mt-3 min-w-0 sm:mx-0 sm:mt-3.5 xl:order-2 xl:mt-0">
        <ul className="flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-0">
          <li className="shrink-0">
            <Link to={{ search: withValue(params, 'type', null).toString() }} aria-current={types.length === 0 ? 'true' : undefined} className={chip}>
              All
            </Link>
          </li>
          {(options?.types ?? [])
            .filter((type) => type.products_count > 0)
            .map((type) => (
              <li key={type.value} className="shrink-0">
                <Link to={{ search: withValue(params, 'type', type.value).toString() }} aria-current={types.length === 1 && types[0] === type.value ? 'true' : undefined} className={chip}>
                  {type.label}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  )
}

/** A shelf to choose: a pill, solid violet when it is the one being looked at (see .ga-glass). */
const chip = 'ga-glass flex h-10 items-center rounded-full px-4 text-sm font-extrabold xl:px-3.5'

/**
 * What the address says about the shelf, read against what the API offers:
 * which type of product it holds and in what order, with the API's own
 * names for both. (The store page reads its sort menu the same way.)
 */
function useShelfChoices() {
  const [params] = useSearchParams()
  const filters = useQuery({ queryKey: ['filters'], queryFn: fetchFilters, staleTime: 5 * 60_000 })
  const options: FiltersResponse['data'] | undefined = filters.data?.data
  const searchTerm = (params.get('q') ?? '').trim()
  const types = chosenValues(params, 'type')
  // While searching there is one more order, "best match", and it is the default.
  const sortOptions = options ? (searchTerm ? [options.search.sort, ...options.sorts] : options.sorts) : []
  const defaultSort = options ? (searchTerm ? options.search.sort.value : options.default_sort) : ''
  const sort = params.get('sort') ?? defaultSort

  return {
    options,
    types,
    searchTerm,
    sortOptions,
    defaultSort,
    sort,
    // One type chosen is a shelf of its own; none, or several, is the whole collection.
    shelfName: (types.length === 1 && options?.types.find((type) => type.value === types[0])?.label) || 'All titles',
    orderName: sortOptions.find((option) => option.value === sort)?.label ?? '',
  }
}

/** The two ways to look at the catalog. Each is a link, and takes the filters, order and search of the other with it. */
function ViewSwitch({ view, className = '' }: { view: 'shelf' | 'list'; className?: string }) {
  const [params] = useSearchParams()
  // The page number belongs to the list it was a page of.
  const search = withValue(params, 'page', null).toString()
  const side = 'ga-glass flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl text-sm font-extrabold min-[390px]:min-w-11 lg:px-3.5'
  // In a narrow window each is a picture; its name is still what a screen reader says.
  const name = 'sr-only lg:not-sr-only'

  return (
    <nav aria-label="Catalog view" className={`flex shrink-0 gap-2 ${className}`}>
      <Link to={{ pathname: '/archive', search }} aria-current={view === 'shelf' ? 'page' : undefined} className={side}>
        <Icon name="shelf" className="size-[18px]" />
        <span className={name}>Archive</span>
      </Link>
      <Link to={{ pathname: '/archive/all', search }} aria-current={view === 'list' ? 'page' : undefined} className={side}>
        <Icon name="grid" className="size-[18px]" />
        <span className={name}>Browse all</span>
      </Link>
    </nav>
  )
}

/** Whether a media query matches, kept up to date. False where the browser cannot say. */
function useMatches(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const media = window.matchMedia(query)
      media.addEventListener('change', changed)

      return () => media.removeEventListener('change', changed)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  )
}
