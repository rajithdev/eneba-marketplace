import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mockApi, renderAt } from '../test/render'

it('leads to the store, inside the shared header and navigation', () => {
  mockApi(() => undefined)
  renderAt('/')

  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')

  const nav = screen.getByRole('navigation', { name: 'Main' })
  expect(nav).toHaveTextContent('Store')
  expect(nav).toHaveTextContent('Account')
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
})

it('shows a not-found page for an address that does not exist', () => {
  mockApi(() => undefined)
  renderAt('/no-such-page')

  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
})
