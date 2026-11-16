import { useEffect } from 'react'

/** Sets the browser tab's title for the current page. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | keymarket`
  }, [title])
}
