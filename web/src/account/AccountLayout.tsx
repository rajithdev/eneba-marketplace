import { useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { LoadError, pageTop, Spinner } from '../components/States'
import { ApiError, describeFailure } from '../lib/api'
import { useLogout, useSession, type Session } from '../lib/auth'
import { AuthScreen } from './AuthScreen'
import type { AccountContext } from './context'
import { panel } from './parts'

/**
 * Where the visitor was heading when they were asked to sign in, e.g.
 * "/cart". Only a path inside this site is accepted, never a full address.
 */
function useReturnTo(): string | null {
  const next = useSearchParams()[0].get('next')

  return next && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : null
}

// `short` is the label in the phone's tab bar, where four must fit side by side.
const sections: { to: string; label: string; short: string; icon: IconName; signInTitle: string }[] = [
  { to: '/account', label: 'Overview', short: 'Overview', icon: 'home', signInTitle: 'Welcome back' },
  { to: '/account/orders', label: 'My orders', short: 'Orders', icon: 'orders', signInTitle: 'Sign in to see your orders' },
  { to: '/account/keys', label: 'My game keys', short: 'Keys', icon: 'key', signInTitle: 'Sign in to see your game keys' },
  { to: '/account/profile', label: 'Profile', short: 'Profile', icon: 'user', signInTitle: 'Sign in to see your profile' },
]

/**
 * /account and the pages under it. Their content is drawn only once the
 * server has confirmed who is signed in; until then, or if that check fails,
 * the page says so. A visitor is asked to sign in right here, and once they
 * have, the page they asked for appears in place.
 */
export function AccountLayout() {
  const session = useSession()
  const returnTo = useReturnTo()
  const { pathname } = useLocation()
  const logout = useLogout()
  const ended = useSessionEnding(session)

  if (session.state === 'checking') return <Checking />

  if (session.state === 'unknown') {
    return (
      <div className={`mx-auto max-w-xl ${pageTop}`}>
        <LoadError title="We could not check that you are signed in" error={session.error} retry={session.retry} heading="h1" />
      </div>
    )
  }

  if (session.state === 'signed-out') {
    const section = sections.find((candidate) => candidate.to === pathname)

    return (
      <AuthScreen
        mode="login"
        // Signing in here shows this same page; signing up elsewhere comes back to it.
        next={returnTo ?? (pathname === '/account' ? null : pathname)}
        title={section?.signInTitle}
        notice={<SignInNotice ended={ended.why} continuing={returnTo !== null} />}
      />
    )
  }

  if (returnTo) return <Navigate to={returnTo} replace />

  const context: AccountContext = {
    user: session.user,
    signOut: {
      run: () => {
        ended.signingOut()
        logout.mutate(undefined, { onError: ended.signOutFailed })
      },
      isPending: logout.isPending,
      // A 401 means the session had already ended: that is signed out, not a failure.
      error: logout.error instanceof ApiError && logout.error.status === 401 ? null : logout.error,
    },
  }

  return (
    <div className={`${pageTop} grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8`}>
      <Sidebar context={context} />
      <div className="min-w-0">
        <Outlet context={context} />
      </div>
    </div>
  )
}

/**
 * Why a signed-in session became a signed-out one, so the sign-in form can
 * say it: the buyer pressed "Sign out", or the session ended on its own
 * (it expired, or was ended in another tab, and the server answered 401).
 */
function useSessionEnding(session: Session) {
  const [previous, setPrevious] = useState(session.state)
  const [wasSignedIn, setWasSignedIn] = useState(session.state === 'signed-in')
  const [pressedSignOut, setPressedSignOut] = useState(false)
  const [why, setWhy] = useState<'signed-out' | 'ended' | null>(null)

  // Worked out while drawing, from the change of state (React's pattern for
  // state that follows other state), rather than in an effect afterwards.
  if (previous !== session.state) {
    setPrevious(session.state)
    if (session.state === 'signed-in') {
      setWasSignedIn(true)
      setWhy(null)
    } else if (session.state === 'signed-out' && wasSignedIn) {
      setWasSignedIn(false)
      setWhy(pressedSignOut ? 'signed-out' : 'ended')
      setPressedSignOut(false)
    }
  }

  return {
    why,
    signingOut: () => setPressedSignOut(true),
    signOutFailed: () => setPressedSignOut(false),
  }
}

function SignInNotice({ ended, continuing }: { ended: 'signed-out' | 'ended' | null; continuing: boolean }) {
  const message =
    ended === 'ended'
      ? 'Your session has ended. Sign in again to continue.'
      : ended === 'signed-out'
        ? 'You have signed out. Your orders and keys are no longer shown on this browser.'
        : continuing
          ? 'Sign in or create an account to continue.'
          : null

  if (!message) return null

  return (
    <p role="status" className={`rounded-control border px-4 py-3 text-sm ${ended === 'ended' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-edge/30 bg-white/5 text-muted'}`}>
      {message}
    </p>
  )
}

function Checking() {
  return (
    <div className={`${pageTop} flex justify-center py-24`}>
      <p role="status" className="flex items-center text-muted">
        <Spinner />
        Checking that you are signed in…
      </p>
    </div>
  )
}

/**
 * The buyer, the account's sections and "Sign out". On a wide screen a
 * column beside the page; on a phone a header with the four sections as a
 * row of tabs beneath. One set of elements for both, rearranged.
 */
function Sidebar({ context }: { context: AccountContext }) {
  const { user, signOut } = context

  return (
    <aside aria-label="Your account" className={`${panel} flex flex-wrap items-center gap-4 p-4 lg:sticky lg:top-4 lg:flex-col lg:flex-nowrap lg:items-stretch lg:self-start lg:p-5`}>
      <div className="order-1 flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:border-b lg:border-edge/15 lg:pb-5">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-panel-top to-band text-lg font-bold ring-1 ring-edge/40">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <nav aria-label="Account sections" className="order-3 w-full lg:order-2">
        <ul className="grid grid-cols-4 gap-1 lg:flex lg:flex-col">
          {sections.map((section) => (
            <li key={section.to}>
              <NavLink
                to={section.to}
                end
                aria-label={section.label}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 rounded-control px-1 py-2 text-xs font-extrabold lg:flex-row lg:gap-3 lg:px-4 lg:py-3 lg:text-[15px] ${
                    isActive ? 'bg-panel text-white shadow-[inset_0_0_0_1px_rgb(176_140_255/0.35)]' : 'text-muted hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <Icon name={section.icon} className="size-5" />
                <span aria-hidden="true" className="lg:hidden">
                  {section.short}
                </span>
                <span aria-hidden="true" className="hidden lg:inline">
                  {section.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="order-2 lg:order-3 lg:border-t lg:border-edge/15 lg:pt-4">
        <button
          type="button"
          onClick={signOut.run}
          disabled={signOut.isPending}
          className="flex items-center gap-2 rounded-control px-3 py-2 text-sm font-extrabold text-muted hover:bg-white/5 hover:text-white disabled:opacity-60 lg:w-full lg:gap-3 lg:px-4 lg:py-3 lg:text-[15px]"
        >
          {signOut.isPending ? <Spinner /> : <Icon name="logout" className="size-5" />}
          {signOut.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {signOut.error != null && (
        <p role="alert" className="order-4 w-full text-sm text-danger">
          You are still signed in. {describeFailure(signOut.error)}
        </p>
      )}
    </aside>
  )
}

/** "AL" for Ada Lovelace; one letter for a single name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words

  return letters.map((word) => [...word][0]?.toUpperCase() ?? '').join('') || '?'
}

/**
 * /account/register: the sign-up form. Someone already signed in has an
 * account, and is sent on to where they were heading.
 */
export function RegisterPage() {
  const session = useSession()
  const returnTo = useReturnTo()

  if (session.state === 'checking') return <Checking />
  if (session.state === 'signed-in') return <Navigate to={returnTo ?? '/account'} replace />
  if (session.state === 'unknown') {
    return (
      <div className={`mx-auto max-w-xl ${pageTop}`}>
        <LoadError title="We could not check that you are signed in" error={session.error} retry={session.retry} heading="h1" />
      </div>
    )
  }

  return <AuthScreen mode="register" next={returnTo} notice={returnTo ? <SignInNotice ended={null} continuing /> : undefined} />
}

/** /orders, the order history's old address, now part of the account. */
export function OrdersRedirect() {
  const { search } = useLocation()

  return <Navigate to={`/account/orders${search}`} replace />
}
