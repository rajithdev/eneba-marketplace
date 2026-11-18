import type { RouteObject } from 'react-router'
import { AppShell } from './components/AppShell'
import { AccountPage } from './pages/AccountPage'
import { CartPage } from './pages/CartPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OrderPage } from './pages/OrderPage'
import { OrdersPage } from './pages/OrdersPage'
import { PageCrashed } from './pages/PageCrashed'
import { ProductPage } from './pages/ProductPage'
import { StorePage } from './pages/StorePage'

/**
 * Puts pages inside the shared shell (header, navigation, footer). If a
 * page fails while drawing itself, that page is replaced by a message and
 * the shell around it stays, so the visitor can still go somewhere else.
 */
export const inShell = (pages: RouteObject[]): RouteObject[] => [
  {
    element: <AppShell />,
    // Last resort, should the shell itself fail: the message on its own.
    errorElement: (
      <div className="px-4">
        <PageCrashed />
      </div>
    ),
    children: [{ errorElement: <PageCrashed />, children: pages }],
  },
]

export const routes: RouteObject[] = inShell([
  { path: '/', element: <HomePage /> },
  { path: '/store', element: <StorePage /> },
  // The Game Archive prototype: the catalog as a shelf of boxed games, and the ordinary list beside it.
  // Its code is fetched only when one of its two addresses is opened.
  { path: '/archive', lazy: () => import('./archive/ArchivePage').then((archive) => ({ Component: archive.ArchivePage })) },
  { path: '/archive/all', lazy: () => import('./archive/ArchivePage').then((archive) => ({ Component: archive.ArchiveBrowsePage })) },
  { path: '/product/:slug', element: <ProductPage /> },
  { path: '/cart', element: <CartPage /> },
  { path: '/orders', element: <OrdersPage /> },
  { path: '/orders/:id', element: <OrderPage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '*', element: <NotFoundPage /> },
])
