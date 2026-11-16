import { useQuery } from '@tanstack/react-query'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { fetchSuggestions } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { storeSearchPath } from '../lib/storeParams'
import { useDebouncedValue } from '../lib/useDebouncedValue'

/** Wait this long after the last keystroke before asking for suggestions. */
const DEBOUNCE_MS = 250
/**
 * The server answers shorter terms with an empty list and rejects longer
 * ones; these two only avoid sending requests that cannot be useful.
 */
const MIN_LENGTH = 2
const MAX_LENGTH = 80

/**
 * The search box in the header.
 *
 * Typing shows a few suggestions from the server. Choosing one opens that
 * product; pressing Enter (or "See all results") opens the store with the
 * search in its address, where it combines with filters and sorting. Both use
 * the same search on the server, so they agree on what matches.
 *
 * It follows the standard "combobox" keyboard pattern: arrow keys move
 * through the suggestions, Enter chooses, Escape closes.
 */
export function SearchBox() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const listId = useId()

  // On the store, the address holds the search text; the box shows it.
  const termInAddress = location.pathname === '/store' ? (params.get('q') ?? '') : ''
  const [text, setText] = useState(termInAddress)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  // Whenever the page changes (a search was run, Back was pressed, a link was
  // followed), the box follows the address again and the list closes.
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (seenLocation !== location.key) {
    setSeenLocation(location.key)
    setText(termInAddress)
    setOpen(false)
    setActive(-1)
  }

  const term = text.trim().replace(/\s+/g, ' ')
  const settledTerm = useDebouncedValue(term, DEBOUNCE_MS)
  const worthAsking = settledTerm.length >= MIN_LENGTH

  const suggestions = useQuery({
    queryKey: ['suggestions', settledTerm],
    // React Query cancels this signal when a newer term replaces this one,
    // so an answer to "eld" can never arrive late and overwrite "elden".
    queryFn: ({ signal }) => fetchSuggestions(settledTerm, signal),
    enabled: worthAsking,
    staleTime: 60_000,
  })

  // While the visitor is still typing, the settled term lags behind: the
  // list only shows answers for exactly what is in the box.
  const upToDate = worthAsking && settledTerm === term
  const products = upToDate ? (suggestions.data?.data ?? []) : []
  const waiting = term.length >= MIN_LENGTH && (!upToDate || suggestions.isPending)
  const showList = open && term.length >= MIN_LENGTH

  // The options a keyboard user can move through: each product, then
  // "see all results".
  const optionCount = products.length + 1
  const optionId = (index: number) => `${listId}-option-${index}`

  function openStore() {
    setOpen(false)
    navigate(storeSearchPath(text))
  }

  function choose(index: number) {
    if (index >= 0 && index < products.length) {
      setOpen(false)
      setText('')
      navigate(`/product/${products[index].slug}`)
    } else {
      openStore()
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    choose(showList ? active : -1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!showList) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      // From "nothing highlighted", Down goes to the first and Up to the last.
      setActive(active === -1 ? (step === 1 ? 0 : optionCount - 1) : (active + step + optionCount) % optionCount)
    } else if (event.key === 'Escape' && open) {
      // Close the list but keep what was typed, and stay in the box.
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  let status = ''
  if (showList) {
    if (waiting) status = 'Searching…'
    else if (suggestions.isError) status = 'Suggestions are unavailable. Press Enter to search the store.'
    else status = products.length === 0 ? 'No suggestions.' : `${products.length} ${products.length === 1 ? 'suggestion' : 'suggestions'}.`
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="relative w-full"
      // Close when focus leaves the whole search (tabbing away, clicking elsewhere).
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <div className="flex">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search products
        </label>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          maxLength={MAX_LENGTH}
          placeholder="Search for games, gift cards and more"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full min-w-0 border border-line bg-panel px-3 text-white placeholder:text-muted"
        />
        <button type="submit" className="h-11 shrink-0 bg-accent px-4 text-sm font-extrabold text-black hover:bg-accent-strong">
          Search
        </button>
      </div>

      {/* Read out by screen readers as results arrive; not shown. */}
      <p role="status" className="sr-only">
        {status}
      </p>

      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!showList}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-auto border border-line bg-card shadow-2xl"
      >
        {showList && (
          <>
            {waiting && products.length === 0 && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted">
                Searching…
              </li>
            )}
            {!waiting && products.length === 0 && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted">
                {suggestions.isError ? 'Suggestions are unavailable right now.' : `No suggestions for “${term}”.`}
              </li>
            )}

            {products.map((product, index) => (
              <li
                key={product.slug}
                id={optionId(index)}
                role="option"
                aria-selected={active === index}
                // Keep focus in the text box while clicking a suggestion.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${active === index ? 'bg-panel' : ''}`}
              >
                {product.cover_image_url && (
                  <img src={product.cover_image_url} alt="" width={36} height={48} className="h-12 w-9 shrink-0 object-cover" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{product.name}</span>
                  <span className="block text-xs font-extrabold uppercase text-region">{product.region.name}</span>
                </span>
                <span className={`shrink-0 text-sm font-extrabold ${product.price ? '' : 'text-muted'}`}>
                  {product.price ? formatMoney(product.price.amount_cents, product.price.currency) : 'Sold out'}
                </span>
              </li>
            ))}

            <li
              id={optionId(products.length)}
              role="option"
              aria-selected={active === products.length}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(products.length)}
              onClick={openStore}
              className={`cursor-pointer border-t border-line px-3 py-3 text-sm font-extrabold text-accent ${active === products.length ? 'bg-panel' : ''}`}
            >
              See all results for “{term}”
            </li>
          </>
        )}
      </ul>
    </form>
  )
}
