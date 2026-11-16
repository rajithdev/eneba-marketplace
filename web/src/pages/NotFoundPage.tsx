import { Link } from 'react-router'
import { Notice, primaryButton } from '../components/States'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <div className="pt-8">
      <Notice title="Page not found">
        <p>There is nothing at this address.</p>
        <Link to="/store" className={primaryButton}>
          Browse the store
        </Link>
      </Notice>
    </div>
  )
}
