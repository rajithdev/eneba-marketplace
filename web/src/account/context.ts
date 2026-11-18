import { useOutletContext } from 'react-router'
import type { User } from '../lib/auth'

/** What every account page is given by AccountLayout: who is signed in, and the way to sign out. */
export interface AccountContext {
  user: User
  signOut: { run: () => void; isPending: boolean; error: unknown }
}

export const useAccount = () => useOutletContext<AccountContext>()
