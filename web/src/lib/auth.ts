import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export interface User {
  id: number
  name: string
  email: string
}

const currentUserKey = ['current-user']

/** The signed-in user, or null for a visitor. */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await apiFetch<{ data: User }>('/auth/me')).data
      } catch (error) {
        // 401 is the normal answer for a visitor, not a failure.
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
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
  })
}

export const useRegister = () =>
  useAuthAction<{ name: string; email: string; password: string }>('/auth/register')

export const useLogin = () => useAuthAction<{ email: string; password: string }>('/auth/login')

export const useLogout = () => useAuthAction<void>('/auth/logout')
