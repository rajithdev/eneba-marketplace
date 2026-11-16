import { Link } from 'react-router'
import { primaryButton } from '../components/States'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * A simple landing page for now. The real homepage, assembled from blocks
 * that the backend defines (banner, best sellers, deals), is a later phase.
 */
export function HomePage() {
  useDocumentTitle('Digital game keys')

  return (
    <section className="py-16 sm:py-24">
      <h1 className="max-w-2xl text-4xl font-black leading-tight sm:text-5xl">Game keys, gift cards and subscriptions</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">Compare offers from several sellers and pick the price that suits you.</p>
      <Link to="/store" className={`${primaryButton} mt-8`}>
        Browse the store
      </Link>
    </section>
  )
}
