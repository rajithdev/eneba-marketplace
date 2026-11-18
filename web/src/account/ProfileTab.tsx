import { Icon } from '../components/Icon'
import { pageTitle, Spinner } from '../components/States'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useAccount } from './context'
import { panel, PanelHeader } from './parts'

/**
 * /account/profile: the account's details as the server holds them. The API
 * has no way to change them yet (no update endpoint, no password reset), so
 * nothing here pretends to; it says so instead.
 */
export function ProfileTab() {
  const { user, signOut } = useAccount()
  useDocumentTitle('Your profile')

  return (
    <div className="space-y-5">
      <header>
        <h1 className={pageTitle}>Profile</h1>
        <p className="mt-1 text-muted">The details this account was created with.</p>
      </header>

      <section aria-labelledby="details-heading" className={panel}>
        <PanelHeader title="Account details" id="details-heading" />
        <dl className="divide-y divide-edge/10">
          <Detail term="Name" value={user.name} />
          <Detail term="Email" value={user.email} />
        </dl>
        <p className="flex items-start gap-2 border-t border-edge/15 px-5 py-4 text-sm text-muted">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
          Changing your name, email address or password is not available yet.
        </p>
      </section>

      <section aria-labelledby="session-heading" className={panel}>
        <PanelHeader title="Session" id="session-heading" />
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-sm text-muted">
            You are signed in on this browser. Signing out ends the session on the server as well, and removes your orders and keys from this tab.
          </p>
          <button
            type="button"
            onClick={signOut.run}
            disabled={signOut.isPending}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-control border border-white/70 px-5 text-[15px] font-extrabold hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {signOut.isPending ? <Spinner /> : <Icon name="logout" className="size-5" />}
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    </div>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="break-words font-bold">{value}</dd>
    </div>
  )
}
