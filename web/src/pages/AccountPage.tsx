import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../lib/api'
import { useCurrentUser, useLogin, useLogout, useRegister } from '../lib/auth'

/**
 * Sign up, sign in and sign out. Functional and unstyled for now: it exists
 * to prove authentication end to end on the deployed site. The Eneba look
 * comes with the styling increment.
 */
export function AccountPage() {
  const currentUser = useCurrentUser()
  const logout = useLogout()

  return (
    <main className="mx-auto max-w-md p-8">
      <Link to="/" className="text-sm underline">
        Home
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Account</h1>

      {currentUser.isPending && <p className="mt-4">Checking your session…</p>}
      {currentUser.isError && <p className="mt-4">The API is not reachable.</p>}

      {currentUser.data && (
        <section className="mt-4">
          <p>
            Signed in as <strong>{currentUser.data.email}</strong>
          </p>
          <button
            type="button"
            className="mt-4 rounded border px-4 py-2"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </button>
        </section>
      )}

      {currentUser.data === null && <SignInOrUp />}
    </main>
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
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      {mode === 'register' && <Field label="Name" name="name" type="text" errors={errors.name} />}
      <Field label="Email" name="email" type="email" errors={errors.email} />
      <Field label="Password" name="password" type="password" errors={errors.password} />

      {action.isError && Object.keys(errors).length === 0 && (
        <p role="alert" className="text-sm text-red-700">
          {action.error.message}
        </p>
      )}

      <button type="submit" className="rounded border px-4 py-2" disabled={action.isPending}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      <button
        type="button"
        className="text-left text-sm underline"
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
      <span className="text-sm">{props.label}</span>
      <input
        name={props.name}
        type={props.type}
        required
        autoComplete={props.type === 'password' ? 'current-password' : props.name}
        className="rounded border px-3 py-2"
      />
      {props.errors?.map((message) => (
        <span key={message} role="alert" className="text-sm text-red-700">
          {message}
        </span>
      ))}
    </label>
  )
}
