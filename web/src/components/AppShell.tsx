import { useIsFetching, useIsMutating, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { useSession } from '../lib/auth'
import { cartCount, useCart } from '../lib/cart'
import { fetchFilters } from '../lib/catalog'
import { Icon } from './Icon'
import { SearchBox } from './SearchBox'

// An icon with its word beside it; on a phone the icon alone (the link
// keeps its name for screen readers through aria-label).
const navLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-2 px-2 text-sm font-semibold hover:text-accent sm:px-3 ${isActive ? 'text-accent' : 'text-white'}`
const navWord = 'hidden md:inline'

const footerLink = 'hover:text-accent hover:underline'

/** The frame every page sits in: header, categories, main area, footer. */
export function AppShell() {
  const inCart = cartCount(useCart())
  const session = useSession()
  const categories = useCategories()

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:font-extrabold focus:text-black"
      >
        Skip to content
      </a>

      <header>
        {/*
          Wide screens: the wordmark, the categories and the cart and account in
          one row, the search under them. Narrow ones: the wordmark with cart and
          account, then the search, then the categories in a row that scrolls.
        */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 pb-2 pt-4 lg:gap-x-10 lg:pt-6">
          {/* A text wordmark: Eneba's logo is theirs and is not copied. */}
          <Link to="/" className="text-2xl font-black tracking-tight md:text-[28px]">
            key<span className="text-accent">market</span>
          </Link>

          <nav aria-label="Categories" className="order-last w-full lg:order-none lg:w-auto">
            {/* Scrolls sideways on a narrow screen, without drawing a scrollbar. */}
            <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1 text-[15px] font-semibold [scrollbar-width:none] lg:gap-2">
              {categories.map((category) => (
                <li key={category.to} className="shrink-0">
                  <Link
                    to={category.to}
                    aria-current={category.current ? 'page' : undefined}
                    className={`block rounded-control px-3.5 py-1.5 hover:text-white ${category.current ? 'bg-white/10 text-white ring-1 ring-edge/40' : 'text-muted'}`}
                  >
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Main" className="ml-auto flex items-center lg:order-none">
            <NavLink to="/cart" className={navLink} aria-label={inCart === 0 ? 'Cart, empty' : `Cart, ${inCart} ${inCart === 1 ? 'item' : 'items'}`}>
              <span className="relative">
                <Icon name="cart" className="size-6" />
                {inCart > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-2 -top-2 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-extrabold leading-[18px] text-black"
                  >
                    {inCart}
                  </span>
                )}
              </span>
              <span className={navWord}>Cart</span>
            </NavLink>
            {/* A signed-in buyer sees their orders and their own name here. */}
            {session.state === 'signed-in' && (
              <NavLink to="/account/orders" className={navLink} aria-label="Orders">
                <Icon name="orders" className="size-6" />
                <span className={navWord}>Orders</span>
              </NavLink>
            )}
            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-white/25 md:block" />
            <NavLink
              to="/account"
              className={navLink}
              aria-label={session.state === 'signed-in' ? `Account, signed in as ${session.user.name}` : 'Account'}
            >
              <Icon name="user" className="size-6" />
              <span className={navWord}>
                {session.state === 'signed-in' ? <span className="inline-block max-w-28 truncate align-bottom">{session.user.name}</span> : 'Account'}
              </span>
            </NavLink>
          </nav>

          <div className="w-full lg:order-last lg:pt-1">
            <div className="mx-auto max-w-[880px]">
              <SearchBox />
            </div>
          </div>
        </div>
      </header>

      <SlowServerNotice />

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16">
        <Outlet />
      </main>

      <footer className="border-t border-line/60 bg-card text-sm text-muted">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div>
            <p className="text-xl font-black tracking-tight text-white">
              key<span className="text-accent">market</span>
            </p>
            <p className="mt-3 max-w-md">
              A demonstration marketplace built for an internship assignment. Not affiliated with Eneba. No real keys are
              sold here and no real payment is taken.
            </p>
          </div>
          <nav aria-label="Shop">
            <p aria-hidden="true" className="font-extrabold uppercase tracking-wide text-white">Shop</p>
            <ul className="mt-3 space-y-2">
              {categories.map((category) => (
                <li key={category.to}>
                  <Link to={category.to} className={footerLink}>
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Your account">
            <p aria-hidden="true" className="font-extrabold uppercase tracking-wide text-white">Your account</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link to="/account" className={footerLink}>
                  {session.state === 'signed-in' ? 'Account' : 'Sign in or register'}
                </Link>
              </li>
              <li>
                <Link to="/cart" className={footerLink}>
                  Cart
                </Link>
              </li>
              <li>
                <Link to="/account/orders" className={footerLink}>
                  Your orders and keys
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>

      <ScrollRestoration />
    </div>
  )
}

/**
 * The category links under the header and in the footer: the whole store,
 * then one link per product type. The types and their names come from the
 * API (the same answer the store's filter panel uses), so a type added
 * there appears here. Until that answer arrives, or if it fails or is not
 * in the expected shape, there is only "Store".
 *
 * They open the Game Archive, the store as a shelf of boxed games. The
 * list with its filters is one click from there ("Browse all"), and is
 * still what a search and the "Browse the store" buttons open.
 */
function useCategories(): { to: string; label: string; current: boolean }[] {
  const filters = useQuery({ queryKey: ['filters'], queryFn: fetchFilters, staleTime: 5 * 60_000 })
  const location = useLocation()
  // The shelf, the list beside it, and the list at its own address: all three are the store.
  const inStore = ['/archive', '/archive/all', '/store'].includes(location.pathname)
  const chosenType = new URLSearchParams(location.search).get('type')

  return [
    { to: '/archive', label: 'Store', current: inStore && !chosenType },
    ...(filters.data?.data?.types ?? [])
      .filter((type) => type.products_count > 0)
      .map((type) => ({ to: `/archive?type=${type.value}`, label: type.label, current: inStore && chosenType === type.value })),
  ]
}

/** How long a wait is ordinary. Longer than this and the visitor is told why it may be slow. */
const PATIENCE_MS = 4000

/**
 * The API runs on a free hosting plan that puts it to sleep when nobody
 * has used it for a while; the first request afterwards waits for it to
 * start, which can take up to a minute. A visitor who is kept waiting is
 * told so, instead of watching a page that seems stuck.
 *
 * It appears only while a request has gone unanswered for some seconds and
 * goes away with the answer. A request that fails is reported by the page
 * as what it is (see describeFailure), not as "waking up".
 */
function SlowServerNotice() {
  const waiting = useIsFetching() + useIsMutating() > 0
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!waiting) return

    const timer = setTimeout(() => setSlow(true), PATIENCE_MS)

    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [waiting])

  if (!slow) return null

  return (
    <p role="status" className="bg-accent px-4 py-2 text-center text-sm font-extrabold text-black">
      Still waiting for the server. If it was asleep (it sleeps when idle on the free hosting plan), waking up can take up to
      a minute.
    </p>
  )
}
