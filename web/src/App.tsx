import { createBrowserRouter, RouterProvider } from 'react-router'
import { AccountPage } from './pages/AccountPage'
import { HomePage } from './pages/HomePage'

// Routes are added per feature: store, search, product, cart, checkout, orders.
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/account', element: <AccountPage /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
