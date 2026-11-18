import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { Spinner } from '../components/States'
import { ApiError, describeFailure } from '../lib/api'
import { useLogin, useRegister } from '../lib/auth'

export type AuthMode = 'login' | 'register'

/**
 * Sign in and create an account: the form beside a piece of artwork (above
 * it on a phone). Only what the backend offers is offered: email and
 * password, no social sign-in, no password reset.
 *
 * `next` is where to go once signed in; the switch between the two forms
 * carries it along. `title` replaces the form's heading, e.g. "Sign in to
 * see your orders"; `notice` is a message above the form.
 */
export function AuthScreen({ mode, next, title, notice }: { mode: AuthMode; next: string | null; title?: string; notice?: ReactNode }) {
  const query = next ? `?next=${encodeURIComponent(next)}` : ''

  return (
    <div className="pt-6 lg:pt-10">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-card border border-edge/20 bg-card-foot shadow-card lg:grid-cols-[1.05fr_1fr]">
        <Artwork mode={mode} />

        <div className="px-5 py-8 sm:px-10 sm:py-10">
          <nav aria-label="Sign in or create an account" className="grid grid-cols-2 rounded-control border border-edge/20 bg-black/20 p-1 text-sm font-extrabold">
            <SwitchLink to={`/account${query}`} current={mode === 'login'}>
              Sign in
            </SwitchLink>
            <SwitchLink to={`/account/register${query}`} current={mode === 'register'}>
              Create account
            </SwitchLink>
          </nav>

          <h1 className="mt-8 text-2xl font-bold leading-tight sm:text-3xl">{title ?? (mode === 'login' ? 'Welcome back' : 'Create your account')}</h1>
          <p className="mt-2 text-muted">
            {mode === 'login' ? 'Sign in to see your orders and game keys.' : 'It takes a minute. Your keys will be waiting here after every purchase.'}
          </p>

          {notice && <div className="mt-5">{notice}</div>}

          {/* A new form for each mode, so nothing typed or reported in one is left in the other. */}
          <AuthForm key={mode} mode={mode} />

          <p className="mt-6 text-center text-sm text-muted">
            {mode === 'login' ? 'New to keymarket? ' : 'Already have an account? '}
            <Link to={mode === 'login' ? `/account/register${query}` : `/account${query}`} className="font-extrabold text-accent underline-offset-4 hover:underline">
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function SwitchLink({ to, current, children }: { to: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      replace
      aria-current={current ? 'page' : undefined}
      className={`rounded-[0.45rem] px-3 py-2 text-center ${current ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}
    >
      {children}
    </Link>
  )
}

/** What the site does, in three true sentences, over the artwork. */
const promises: { icon: IconName; text: string }[] = [
  { icon: 'bolt', text: 'Keys are delivered the moment a payment is confirmed.' },
  { icon: 'shield', text: 'Your keys are shown to your account only, and stay hidden until you reveal them.' },
  { icon: 'lock', text: 'Checkout uses test cards: no card details are asked for and no money is taken.' },
]

function Artwork({ mode }: { mode: AuthMode }) {
  return (
    <div className="relative isolate flex min-h-44 flex-col justify-end overflow-hidden p-6 sm:min-h-56 sm:p-8 lg:min-h-[560px] lg:p-10">
      <img
        src="/covers/art/hero/elden-ring-shadow-of-the-erdtree.jpg"
        alt=""
        width={1600}
        height={900}
        className="absolute inset-0 -z-20 size-full object-cover object-[70%_30%]"
      />
      {/* Darkened toward the text, and tinted with the site's violet. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-card-foot via-card-foot/45 to-[#2a0f6b]/10 lg:bg-linear-to-tr lg:via-card-foot/75 lg:to-[#2a0f6b]/30" />

      <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-accent">keymarket account</p>
      <p className="mt-2 max-w-sm text-2xl font-bold leading-tight sm:text-3xl">{mode === 'login' ? 'Your library, one sign-in away.' : 'Start your collection.'}</p>

      <ul className="mt-6 hidden space-y-3 text-sm text-white/90 lg:block">
        {promises.map((promise) => (
          <li key={promise.icon} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/30 text-accent">
              <Icon name={promise.icon} className="size-4" />
            </span>
            <span className="pt-1.5">{promise.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Values = { name: string; email: string; password: string }
type Errors = Partial<Record<keyof Values, string>>

/**
 * The same rules the server applies (RegisterRequest, LoginRequest), checked
 * first in the browser so a mistake is explained without a round trip. The
 * server still checks everything; its answer is shown when it disagrees.
 */
function validate(mode: AuthMode, values: Values): Errors {
  const errors: Errors = {}

  if (mode === 'register') {
    if (!values.name.trim()) errors.name = 'Enter your name.'
    else if (values.name.length > 100) errors.name = 'Use at most 100 characters.'
  }

  if (!values.email.trim()) errors.email = 'Enter your email address.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = 'Enter an email address like name@example.com.'

  if (!values.password) errors.password = mode === 'login' ? 'Enter your password.' : 'Choose a password.'
  else if (mode === 'register' && values.password.length < 8) errors.password = 'Use at least 8 characters.'
  else if (values.password.length > 255) errors.password = 'Use at most 255 characters.'

  return errors
}

/** What went wrong with a request, in words fit to show. */
function messageFor(error: unknown): string {
  // An answer about the request itself (wrong password, too many attempts)
  // carries the server's own explanation.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message

  return describeFailure(error)
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const login = useLogin()
  const register = useRegister()
  const action = mode === 'login' ? login : register
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '' })
  // Mistakes are pointed out once the visitor has tried to send the form,
  // and from then on as they are corrected.
  const [tried, setTried] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const ownErrors = tried ? validate(mode, values) : {}
  const serverErrors = action.error instanceof ApiError ? action.error.fieldErrors : {}
  // A failed sign-in is about the email and password together ("these
  // credentials do not match"), so it is said above the form, not under one field.
  const formMessage =
    action.isError && (mode === 'login' || Object.keys(serverErrors).length === 0)
      ? mode === 'login' && serverErrors.email?.[0]
        ? serverErrors.email[0]
        : messageFor(action.error)
      : null
  const errorFor = (field: keyof Values) => ownErrors[field] ?? (mode === 'register' ? serverErrors[field]?.[0] : undefined)

  function change(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    // What the server said was about what was sent; it no longer applies.
    if (action.isError) action.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTried(true)
    const errors = validate(mode, values)
    const firstWrong = (['name', 'email', 'password'] as const).find((field) => errors[field])

    if (firstWrong) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${firstWrong}"]`)?.focus()
      return
    }

    const email = values.email.trim()
    if (mode === 'login') login.mutate({ email, password: values.password })
    else register.mutate({ name: values.name.trim(), email: email.toLowerCase(), password: values.password })
  }

  return (
    <form noValidate onSubmit={submit} aria-busy={action.isPending} className="mt-6 flex flex-col gap-5">
      {formMessage && (
        <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {formMessage}
        </p>
      )}

      {mode === 'register' && (
        <Field label="Name" name="name" autoComplete="name" value={values.name} onChange={change} error={errorFor('name')} disabled={action.isPending} />
      )}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={values.email}
        onChange={change}
        error={errorFor('email')}
        disabled={action.isPending}
      />
      <Field
        label="Password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={values.password}
        onChange={change}
        error={errorFor('password')}
        hint={mode === 'register' ? 'At least 8 characters.' : undefined}
        disabled={action.isPending}
        trailing={
          <button
            type="button"
            aria-label="Show password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((shown) => !shown)}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-control text-muted hover:text-white"
          >
            <Icon name={showPassword ? 'eye-off' : 'eye'} />
          </button>
        }
      />

      <button
        type="submit"
        disabled={action.isPending}
        className="mt-1 inline-flex h-12 items-center justify-center rounded-control bg-accent px-5 text-base font-extrabold text-black hover:bg-accent-strong active:translate-y-px disabled:opacity-70"
      >
        {action.isPending && <Spinner />}
        {mode === 'login' ? (action.isPending ? 'Signing in…' : 'Sign in') : action.isPending ? 'Creating your account…' : 'Create account'}
      </button>
    </form>
  )
}

function Field(props: {
  label: string
  name: keyof Values
  type?: string
  autoComplete: string
  inputMode?: 'email'
  value: string
  onChange: (field: keyof Values, value: string) => void
  error?: string
  hint?: string
  disabled: boolean
  trailing?: ReactNode
}) {
  const id = useId()
  const described = [props.error && `${id}-error`, props.hint && !props.error && `${id}-hint`].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-extrabold">
        {props.label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={props.name}
          type={props.type ?? 'text'}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          value={props.value}
          onChange={(event) => props.onChange(props.name, event.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={described}
          // Locked while the request is on its way, so what is on screen is what was sent.
          readOnly={props.disabled}
          className={`h-12 w-full rounded-control border bg-black/25 px-4 text-white outline-none placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/30 ${
            props.trailing ? 'pr-12' : ''
          } ${props.error ? 'border-danger/70' : 'border-edge/30'}`}
        />
        {props.trailing}
      </div>
      {props.hint && !props.error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {props.error}
        </p>
      )}
    </div>
  )
}
