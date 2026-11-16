import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { SearchBox } from './SearchBox'

const navLink = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 text-sm font-extrabold hover:text-accent ${isActive ? 'text-accent' : 'text-white'}`

/** The frame every page sits in: header, navigation, main area, footer. */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:font-extrabold focus:text-black"
      >
        Skip to content
      </a>

      <header className="bg-page">
        {/* One row on wide screens; on narrow ones the search drops to its own row. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          {/* A text wordmark: Eneba's logo is theirs and is not copied. */}
          <Link to="/" className="text-2xl font-black tracking-tight">
            key<span className="text-accent">market</span>
          </Link>
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <SearchBox />
          </div>
          <nav aria-label="Main" className="ml-auto flex items-center">
            <NavLink to="/store" className={navLink}>
              Store
            </NavLink>
            <NavLink to="/account" className={navLink}>
              Account
            </NavLink>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16">
        <Outlet />
      </main>

      <footer className="bg-card px-4 py-6 text-center text-sm text-muted">
        A demonstration marketplace built for an internship assignment. Not affiliated with Eneba. No real keys are
        sold here.
      </footer>

      <ScrollRestoration />
    </div>
  )
}
