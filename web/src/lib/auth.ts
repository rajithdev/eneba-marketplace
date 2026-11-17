import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { checkoutAttempt } from './cart'

export interface User {
  id: number
  name: string
  email: string
}

const currentUserKey = ['current-user']

/**
 * The signed-in user, or null for a visitor.
 *
 * The server answers 200 with {"data": null} for a visitor, so "nobody is
 * signed in" is not an error. Anything that IS an error (server down, bad
 * response) is thrown and shown as such; it is never mistaken for "signed out".
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: async (): Promise<User | null> => (await apiFetch<{ data: User | null }>('/auth/me')).data,
  })
}

/**
 * What a page may assume about who is looking at it.
 *
 *   checking    the first answer has not arrived yet
 *   unknown     the last check failed, so nothing can be assumed: not even
 *               that the person who was signed in a moment ago still is
 *   signed-out  the server says nobody is signed in
 *   signed-in   the server says who is
 *
 * Pages that show a buyer's own data (orders, keys) show it only in the
 * last state.
 */
export type Session =
  | { state: 'checking' }
  | { state: 'unknown'; error: unknown; retry: () => void }
  | { state: 'signed-out' }
  | { state: 'signed-in'; user: User }

export function useSession(): Session {
  const currentUser = useCurrentUser()

  if (currentUser.isError) return { state: 'unknown', error: currentUser.error, retry: () => void currentUser.refetch() }
  if (currentUser.isPending) return { state: 'checking' }

  return currentUser.data ? { state: 'signed-in', user: currentUser.data } : { state: 'signed-out' }
}

/**
 * Everything this browser remembers that belongs to one buyer: their
 * orders, with the keys in them, and the checkout they had in progress.
 * Dropped whenever the person at the keyboard may have changed, so that
 * nothing of the previous buyer's can be shown to the next one. (The cart
 * is not personal: it is kept, so a visitor can fill it before signing in.)
 */
function forgetBuyer(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ['orders'] })
  queryClient.removeQueries({ queryKey: ['order'] })
  checkoutAttempt.forget()
}

/**
 * The server answered "you are not signed in" (401) to something: the
 * session ended, here or in another tab. The app is a visitor's from now on.
 */
export function endSession(queryClient: QueryClient) {
  queryClient.setQueryData(currentUserKey, null)
  forgetBuyer(queryClient)
}

function useAuthAction<Input>(path: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Input) =>
      apiFetch<{ data: User } | undefined>(path, {
        method: 'POST',
        body: input === undefined ? undefined : JSON.stringify(input),
      }),
    // Whatever happened, what the server says about "who am I" is the truth.
    // Signing in, signing up and signing out all change who that is.
    onSuccess: (result) => {
      queryClient.setQueryData(currentUserKey, result?.data ?? null)
      forgetBuyer(queryClient)
    },
    // A 401 (the session had already ended) is handled for every request
    // in one place: see createQueryClient. Other errors stay errors.
  })
}

export const useRegister = () =>
  useAuthAction<{ name: string; email: string; password: string }>('/auth/register')

export const useLogin = () => useAuthAction<{ email: string; password: string }>('/auth/login')

export const useLogout = () => useAuthAction<void>('/auth/logout')
