import { Notice, pageTop, primaryButton } from '../components/States'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * Shown in place of a page that threw an error while drawing itself (a bug,
 * or an answer from the API in a shape the page did not expect). The link
 * is an ordinary one, not a router link: loading the site afresh also
 * clears whatever state led to the error.
 */
export function PageCrashed() {
  useDocumentTitle('Something went wrong')

  return (
    <div className={pageTop}>
      <Notice title="Something went wrong on this page" tone="error" heading="h1">
        <p>The rest of the site still works. Nothing you did was lost on the server.</p>
        <a href="/" className={primaryButton}>
          Go to the homepage
        </a>
      </Notice>
    </div>
  )
}
