import type { RouteObject } from 'react-router'
import { AppShell } from './components/AppShell'
import { AccountLayout, OrdersRedirect, RegisterPage } from './account/AccountLayout'
import { KeysTab } from './account/KeysTab'
import { OrdersTab } from './account/OrdersTab'
import { OverviewPage } from './account/OverviewPage'
import { ProfileTab } from './account/ProfileTab'
import { CartPage } from './pages/CartPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OrderPage } from './pages/OrderPage'
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
  // The Game Archive, which "Store" in the header opens: the catalog as a shelf of boxed games, and the ordinary list beside it.
  // Its code is fetched only when one of its two addresses is opened.
  { path: '/archive', lazy: () => import('./archive/ArchivePage').then((archive) => ({ Component: archive.ArchivePage })) },
  { path: '/archive/all', lazy: () => import('./archive/ArchivePage').then((archive) => ({ Component: archive.ArchiveBrowsePage })) },
  { path: '/product/:slug', element: <ProductPage /> },
  { path: '/cart', element: <CartPage /> },
  // The order history moved into the account; its old address still works.
  { path: '/orders', element: <OrdersRedirect /> },
  { path: '/orders/:id', element: <OrderPage /> },
  // The account: signed out, the sign-in form; signed in, the dashboard and its sections.
  {
    path: '/account',
    element: <AccountLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'orders', element: <OrdersTab /> },
      { path: 'keys', element: <KeysTab /> },
      { path: 'profile', element: <ProfileTab /> },
    ],
  },
  { path: '/account/register', element: <RegisterPage /> },
  { path: '*', element: <NotFoundPage /> },
])
