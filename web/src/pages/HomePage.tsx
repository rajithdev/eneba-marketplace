import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

/**
 * Placeholder for the real homepage (built from backend-defined blocks in a
 * later increment). For now it proves the browser can reach the API.
 */
export function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<{ status: string }>('/health'),
  })

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Eneba Marketplace</h1>
      <p className="mt-2" role="status">
        {health.isPending && 'Connecting to the API…'}
        {health.isError && 'The API is not reachable.'}
        {health.isSuccess && `API status: ${health.data.status}`}
      </p>
    </main>
  )
}
