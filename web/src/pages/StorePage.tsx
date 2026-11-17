import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { FilterPanel } from '../components/FilterPanel'
import { Pagination } from '../components/Pagination'
import { ProductCard } from '../components/ProductCard'
import { LoadError, Notice, pageTitle, pageTop, primaryButton, productGrid, ProductGridSkeleton, secondaryButton } from '../components/States'
import { ApiError } from '../lib/api'
import { fetchFilters, fetchProducts } from '../lib/catalog'
import { activeFilterCount, apiQuery, withValue, withoutFilters } from '../lib/storeParams'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * The catalog. Which filters, sort order and page are showing is decided by
 * the URL alone: this component reads the address, asks the API for exactly
 * that, and changes the address when the visitor changes something.
 */
export function StorePage() {
  const [params, setParams] = useSearchParams()
  const query = apiQuery(params)
  // The search text, typed in the header's search box, lives in the address
  // like every other part of the store's state.
  const searchTerm = (params.get('q') ?? '').trim()
  useDocumentTitle(searchTerm ? `Search: ${searchTerm}` : 'Store')
  const filtersPanelId = useId()
  const [filtersOpen, setFiltersOpen] = useState(false)

  const filters = useQuery({ queryKey: ['filters'], queryFn: fetchFilters, staleTime: 5 * 60_000 })
  const products = useQuery({
    queryKey: ['products', query],
    queryFn: () => fetchProducts(query),
    // Keep showing the current page while the next one loads, instead of
    // flashing a skeleton on every click.
    placeholderData: keepPreviousData,
  })

  const activeFilters = activeFilterCount(params)
  // While searching there is one more order, "best match", and it is the
  // default; without a search the store's usual default applies.
  const options = filters.data?.data
  const sortOptions = options ? (searchTerm ? [options.search.sort, ...options.sorts] : options.sorts) : []
  const defaultSort = options ? (searchTerm ? options.search.sort.value : options.default_sort) : ''
  const sort = params.get('sort') ?? defaultSort
  // The API rejected the address itself (for example a mistyped filter).
  const invalidAddress = products.error instanceof ApiError && products.error.status === 422
  // The API host's firewall answers 403 by itself when text looks like an
  // attack ("1 OR 1=1"). Trying again cannot help, so say what would.
  const refused = products.error instanceof ApiError && products.error.status === 403

  return (
    <>
      <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-6 ${pageTop}`}>
        <h1 className={pageTitle}>{searchTerm ? <>Results for “{searchTerm}”</> : 'Store'}</h1>
        {searchTerm && (
          <Link to={{ search: withValue(params, 'q', null).toString() }} className="text-sm font-extrabold underline hover:text-accent">
            Clear search
          </Link>
        )}
      </div>

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        <aside aria-label="Filters">
          <button
            type="button"
            className={`${secondaryButton} mb-4 w-full lg:hidden`}
            aria-expanded={filtersOpen}
            aria-controls={filtersPanelId}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            {filtersOpen ? 'Hide filters' : 'Filters'}
            {activeFilters > 0 && ` (${activeFilters})`}
          </button>

          <div id={filtersPanelId} className={`${filtersOpen ? 'mb-6 block' : 'hidden'} lg:block`}>
            {filters.isPending && <div role="status" aria-label="Loading filters" className="h-64 animate-pulse bg-card" />}
            {filters.isError && <p className="bg-card p-4 text-sm text-danger">The filters could not be loaded.</p>}
            {filters.data && <FilterPanel options={filters.data.data} params={params} onChange={setParams} />}
          </div>
        </aside>

        <section aria-label="Products">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* Announced to screen readers whenever the results change. */}
            <p aria-live="polite" className="text-sm text-muted">
              {products.data && (
                <>
                  <span className="font-extrabold text-white">{products.data.meta.total}</span>{' '}
                  {products.data.meta.total === 1 ? 'product' : 'products'}
                  {searchTerm ? ' found' : activeFilters > 0 ? ' match your filters' : ''}
                </>
              )}
            </p>

            <div className="flex items-center gap-4">
              {activeFilters > 0 && (
                <Link to={{ search: withoutFilters(params).toString() }} className="text-sm font-extrabold underline hover:text-accent">
                  Clear filters
                </Link>
              )}
              {filters.data && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Sort by</span>
                  <select
                    value={sort}
                    onChange={(event) =>
                      // The default order needs no parameter: /store stays /store.
                      setParams(withValue(params, 'sort', event.target.value === defaultSort ? null : event.target.value))
                    }
                    className="h-10 border border-line bg-card px-2 font-extrabold text-white"
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {products.isPending && <ProductGridSkeleton />}

          {invalidAddress && (
            <Notice title="These filters are not valid" tone="error">
              <p>The address contains a filter the store does not recognise.</p>
              <Link to="/store" className={primaryButton}>
                Show all products
              </Link>
            </Notice>
          )}

          {refused && (
            <Notice title="This search could not be run" tone="error">
              <p>The request was refused before it reached the store. Try different words.</p>
              <Link to="/store" className={primaryButton}>
                Show all products
              </Link>
            </Notice>
          )}

          {products.isError && !invalidAddress && !refused && (
            <LoadError title="The products could not be loaded" error={products.error} retry={() => products.refetch()} />
          )}

          {products.data && products.data.data.length === 0 && searchTerm && (
            <Notice title={`No products match “${searchTerm}”`}>
              <p>
                {activeFilters > 0
                  ? 'Check the spelling, try fewer words, or remove a filter.'
                  : 'Check the spelling or try fewer words. Small typos are understood; abbreviations are not.'}
              </p>
              {activeFilters > 0 && (
                <Link to={{ search: withoutFilters(params).toString() }} className={primaryButton}>
                  Clear filters
                </Link>
              )}
              <Link to="/store" className={activeFilters > 0 ? 'font-extrabold underline hover:text-accent' : primaryButton}>
                Show all products
              </Link>
            </Notice>
          )}

          {products.data && products.data.data.length === 0 && !searchTerm && (
            <Notice title="No products match these filters">
              <p>Try removing a filter or widening the price range.</p>
              <Link to={{ search: withoutFilters(params).toString() }} className={primaryButton}>
                Clear filters
              </Link>
            </Notice>
          )}

          {products.data && products.data.data.length > 0 && (
            <>
              <ul className={`${productGrid} ${products.isPlaceholderData ? 'opacity-60' : ''}`}>
                {products.data.data.map((product) => (
                  <li key={product.slug}>
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
              <Pagination
                currentPage={products.data.meta.current_page}
                lastPage={products.data.meta.last_page}
                hrefFor={(page) => `?${withValue(params, 'page', page > 1 ? String(page) : null).toString()}`}
              />
            </>
          )}
        </section>
      </div>
    </>
  )
}
