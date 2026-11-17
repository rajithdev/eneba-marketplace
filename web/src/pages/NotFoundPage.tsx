import { Link } from 'react-router'
import { Notice, pageTop, primaryButton } from '../components/States'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <div className={pageTop}>
      <Notice title="Page not found" heading="h1">
        <p>There is nothing at this address.</p>
        <Link to="/store" className={primaryButton}>
          Browse the store
        </Link>
      </Notice>
    </div>
  )
}
