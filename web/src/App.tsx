import { createBrowserRouter, RouterProvider } from 'react-router'
import { HomePage } from './pages/HomePage'

// Routes are added per feature: store, search, product, cart, checkout, orders.
const router = createBrowserRouter([{ path: '/', element: <HomePage /> }])

export default function App() {
  return <RouterProvider router={router} />
}
