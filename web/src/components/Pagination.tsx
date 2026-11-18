import { Link } from 'react-router'

interface Props {
  currentPage: number
  lastPage: number
  /** The address of a given page, keeping every other parameter. */
  hrefFor: (page: number) => string
}

/** Page numbers to show: first, last, and those around the current one. */
function pagesToShow(current: number, last: number): (number | 'gap')[] {
  const wanted = new Set([1, last, current - 1, current, current + 1].filter((page) => page >= 1 && page <= last))
  const sorted = [...wanted].sort((a, b) => a - b)

  return sorted.flatMap((page, index) => (index > 0 && page - sorted[index - 1] > 1 ? ['gap' as const, page] : [page]))
}

/**
 * Page links. They are real links, not buttons with click handlers, so each
 * page has its own address that can be opened in a new tab or shared.
 */
export function Pagination({ currentPage, lastPage, hrefFor }: Props) {
  if (lastPage <= 1) return null

  const cell = 'flex h-10 min-w-10 items-center justify-center rounded-control px-3 text-sm font-extrabold'

  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-center gap-1">
      {currentPage > 1 && (
        <Link to={hrefFor(currentPage - 1)} rel="prev" className={`${cell} hover:text-accent`}>
          Previous
        </Link>
      )}
      {pagesToShow(currentPage, lastPage).map((page, index) =>
        page === 'gap' ? (
          <span key={`gap-${index}`} aria-hidden="true" className={cell}>
            …
          </span>
        ) : page === currentPage ? (
          <span key={page} aria-current="page" aria-label={`Page ${page}, current page`} className={`${cell} bg-accent text-black`}>
            {page}
          </span>
        ) : (
          <Link key={page} to={hrefFor(page)} aria-label={`Page ${page}`} className={`${cell} border border-edge/30 bg-card-mid hover:border-edge-lit hover:text-accent`}>
            {page}
          </Link>
        ),
      )}
      {currentPage < lastPage && (
        <Link to={hrefFor(currentPage + 1)} rel="next" className={`${cell} hover:text-accent`}>
          Next
        </Link>
      )}
    </nav>
  )
}
