import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { LoadError, pageTitle, pageTop, primaryButton, secondaryButton, Spinner, surface } from '../components/States'
import { ApiError, describeFailure } from '../lib/api'
import { useLogin, useLogout, useRegister, useSession, type User } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** Sign up, sign in and sign out. */
export function AccountPage() {
  const session = useSession()
  useDocumentTitle('Account')
  // Where the visitor was heading when they were asked to sign in, e.g.
  // "/cart". Only a path inside this site is accepted, never a full address.
  const next = useSearchParams()[0].get('next')
  const returnTo = next && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : null

  if (session.state === 'signed-in' && returnTo) return <Navigate to={returnTo} replace />

  return (
    <div className={`mx-auto max-w-md ${pageTop}`}>
      <h1 className={pageTitle}>Account</h1>

      <div className="mt-6">
        {session.state === 'checking' && <p role="status">Checking that you are signed in…</p>}

        {session.state === 'unknown' && (
          <LoadError title="We could not check that you are signed in" error={session.error} retry={session.retry} />
        )}

        {session.state === 'signed-in' && <SignedIn user={session.user} />}

        {session.state === 'signed-out' && (
          <>
            {returnTo && <p className="mb-4 text-muted">Sign in or create an account to continue.</p>}
            <SignInOrUp />
          </>
        )}
      </div>
    </div>
  )
}

/** What went wrong with a request, in words fit to show. */
function messageFor(error: unknown): string {
  // An answer about the request itself (wrong password, too many attempts)
  // carries the server's own explanation.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message

  return describeFailure(error)
}

function SignedIn({ user }: { user: User }) {
  const logout = useLogout()

  return (
    <section aria-label="Your account" className={`p-6 ${surface}`}>
      <p className="text-xl font-bold">{user.name}</p>
      <p className="mt-1 text-muted">
        Signed in as <strong className="text-white">{user.email}</strong>
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/orders" className={primaryButton}>
          Your orders and keys
        </Link>
        <button type="button" className={secondaryButton} disabled={logout.isPending} onClick={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {logout.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          You are still signed in. {messageFor(logout.error)}
        </p>
      )}
    </section>
  )
}

function SignInOrUp() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const login = useLogin()
  const register = useRegister()
  const action = mode === 'login' ? login : register
  const errors = action.error instanceof ApiError ? action.error.fieldErrors : {}

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))

    if (mode === 'login') login.mutate({ email, password })
    else register.mutate({ name: String(form.get('name')), email, password })
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-4 p-6 ${surface}`}>
      {mode === 'register' && <Field label="Name" name="name" type="text" autoComplete="name" errors={errors.name} />}
      <Field label="Email" name="email" type="email" autoComplete="email" errors={errors.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        errors={errors.password}
      />

      {action.isError && Object.keys(errors).length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {messageFor(action.error)}
        </p>
      )}

      <button type="submit" className={primaryButton} disabled={action.isPending}>
        {action.isPending && <Spinner />}
        {mode === 'login' ? (action.isPending ? 'Signing in…' : 'Sign in') : action.isPending ? 'Creating your account…' : 'Create account'}
      </button>

      <button
        type="button"
        className="text-left text-sm underline hover:text-accent"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </form>
  )
}

function Field(props: { label: string; name: string; type: string; autoComplete: string; errors?: string[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-extrabold">{props.label}</span>
      <input
        name={props.name}
        type={props.type}
        required
        autoComplete={props.autoComplete}
        className="h-11 border border-line bg-panel px-3 text-white"
      />
      {props.errors?.map((message) => (
        <span key={message} role="alert" className="text-sm text-danger">
          {message}
        </span>
      ))}
    </label>
  )
}
