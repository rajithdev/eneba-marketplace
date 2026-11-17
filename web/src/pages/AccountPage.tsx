import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { primaryButton, secondaryButton } from '../components/States'
import { ApiError } from '../lib/api'
import { useCurrentUser, useLogin, useLogout, useRegister } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** Sign up, sign in and sign out. */
export function AccountPage() {
  const currentUser = useCurrentUser()
  const logout = useLogout()
  useDocumentTitle('Account')
  // Where the visitor was heading when they were asked to sign in, e.g.
  // "/cart". Only a path inside this site is accepted, never a full address.
  const next = useSearchParams()[0].get('next')
  const returnTo = next && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : null

  if (currentUser.data && returnTo) return <Navigate to={returnTo} replace />

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-3xl font-bold">Account</h1>

      {currentUser.isPending && <p className="mt-4">Checking your session…</p>}
      {currentUser.isError && <p className="mt-4">The API is not reachable.</p>}

      {returnTo && currentUser.data === null && <p className="mt-4 text-muted">Sign in or create an account to continue.</p>}

      {currentUser.data && (
        <section className="mt-4">
          <p>
            Signed in as <strong>{currentUser.data.email}</strong>
          </p>
          <p className="mt-4">
            <Link to="/orders" className="font-extrabold underline hover:text-accent">
              Your orders and keys
            </Link>
          </p>
          <button
            type="button"
            className={`${secondaryButton} mt-4`}
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </button>
        </section>
      )}

      {currentUser.data === null && <SignInOrUp />}
    </div>
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
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4 bg-card p-6">
      {mode === 'register' && <Field label="Name" name="name" type="text" errors={errors.name} />}
      <Field label="Email" name="email" type="email" errors={errors.email} />
      <Field label="Password" name="password" type="password" errors={errors.password} />

      {action.isError && Object.keys(errors).length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {action.error.message}
        </p>
      )}

      <button type="submit" className={primaryButton} disabled={action.isPending}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
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

function Field(props: { label: string; name: string; type: string; errors?: string[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-extrabold">{props.label}</span>
      <input
        name={props.name}
        type={props.type}
        required
        autoComplete={props.type === 'password' ? 'current-password' : props.name}
        className="h-11 border border-line bg-page px-3 text-white"
      />
      {props.errors?.map((message) => (
        <span key={message} role="alert" className="text-sm text-danger">
          {message}
        </span>
      ))}
    </label>
  )
}
