import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { cart } from '../lib/cart'

afterEach(() => {
  cleanup()
  // Each test starts with an empty cart and no checkout in progress.
  localStorage.clear()
  cart.reload()
})

// jsdom has no scrolling; the router restores scroll position on navigation.
window.scrollTo = () => {}
