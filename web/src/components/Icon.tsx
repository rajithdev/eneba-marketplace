import type { ReactNode } from 'react'

/*
 * The few icons the site uses, drawn here as plain line shapes (no icon
 * library, nothing copied from eneba.com). An icon is always decoration:
 * the link or button it sits in carries the name, in text or aria-label.
 */
const shapes: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  cart: (
    <>
      <path d="M2.5 4h2.4l2.3 11.1a1 1 0 0 0 1 .8h9.1a1 1 0 0 0 1-.8L20 7.5H5.7" />
      <circle cx="9.5" cy="19.6" r="1.2" />
      <circle cx="17" cy="19.6" r="1.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5a8 8 0 0 1 16 0" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  arrow: <path d="M4.5 12h15m-6-6 6 6-6 6" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.9-5.2 2.9 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />,
}

export type IconName = 'search' | 'cart' | 'user' | 'orders' | 'arrow' | 'star'

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {shapes[name]}
    </svg>
  )
}
