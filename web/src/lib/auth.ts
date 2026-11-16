import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

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
    retry: false,
  })
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
    onSuccess: (result) => queryClient.setQueryData(currentUserKey, result?.data ?? null),
    // 401 here means the session had already ended (expired, or signed out in
    // another tab): the user is a visitor now. Other errors stay errors.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(currentUserKey, null)
    },
  })
}

export const useRegister = () =>
  useAuthAction<{ name: string; email: string; password: string }>('/auth/register')

export const useLogin = () => useAuthAction<{ email: string; password: string }>('/auth/login')

export const useLogout = () => useAuthAction<void>('/auth/logout')
