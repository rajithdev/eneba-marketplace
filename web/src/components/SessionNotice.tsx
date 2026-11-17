import { Link } from 'react-router'
import type { Session } from '../lib/auth'
import { LoadError, Notice, primaryButton } from './States'

/**
 * What a page that belongs to a signed-in buyer shows instead of its
 * content while there is no confirmed session: still checking, could not
 * check, or nobody signed in. Such a page renders its content only when
 * the session's state is "signed-in".
 *
 * `what` completes "Sign in to see ...", `next` is where to return to.
 */
export function SessionNotice({
  session,
  what,
  next,
  heading,
}: {
  session: Exclude<Session, { state: 'signed-in' }>
  what: string
  next: string
  /** "h1" when the notice is the whole page. */
  heading?: 'h1' | 'h2'
}) {
  if (session.state === 'checking') return <p role="status">Checking that you are signed in…</p>

  if (session.state === 'unknown') {
    return <LoadError title="We could not check that you are signed in" error={session.error} retry={session.retry} heading={heading} />
  }

  return (
    <Notice title={`Sign in to see ${what}`} heading={heading}>
      <p>Orders and their keys are only shown to the account that placed them.</p>
      <Link to={`/account?next=${next}`} className={primaryButton}>
        Sign in
      </Link>
    </Notice>
  )
}
