import type { RouteObject } from 'react-router'
import { AppShell } from './components/AppShell'
import { AccountPage } from './pages/AccountPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/ProductPage'
import { StorePage } from './pages/StorePage'

/** Every page is shown inside the shared shell (header, navigation, footer). */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/store', element: <StorePage /> },
      { path: '/product/:slug', element: <ProductPage /> },
      { path: '/account', element: <AccountPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
