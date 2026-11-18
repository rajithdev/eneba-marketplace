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
  // The Game Archive's own: its mark, its two views, and what is said about a game under the shelf.
  gamepad: (
    <>
      <path d="M7.2 7.5h9.6a4.4 4.4 0 0 1 4.3 3.5l1 4.8a2.3 2.3 0 0 1-4 1.9l-1.6-1.9a2 2 0 0 0-1.5-.7H9a2 2 0 0 0-1.5.7l-1.6 1.9a2.3 2.3 0 0 1-4-1.9l1-4.8a4.4 4.4 0 0 1 4.3-3.5Z" />
      <path d="M8.2 10.4v3M6.7 11.9h3" />
      <path d="M15.4 10.9h.01M17.6 12.9h.01" strokeWidth="2.4" />
    </>
  ),
  shelf: (
    <>
      <path d="M3.5 5.5h17v4h-17zM5 9.5v9h14v-9" />
      <path d="M10 13h4" />
    </>
  ),
  grid: (
    <path
      d="M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01"
      strokeWidth="2.8"
    />
  ),
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  sort: <path d="M4 7h16M7 12h10M10 17h4" />,
  platform: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.300 6.100-3.900 8.500c-2.600-2.400-3.900-5.200-3.900-8.500s1.300-6.100 3.900-8.500Z" />
    </>
  ),
  sellers: (
    <>
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M2.8 19.5a6.2 6.2 0 0 1 12.400 0M15.800 5.600a3.300 3.300 0 0 1 0 5.800M17.700 14.300a6.200 6.200 0 0 1 3.500 5.200" />
    </>
  ),
}

export type IconName = 'search' | 'cart' | 'user' | 'orders' | 'arrow' | 'star' | 'gamepad' | 'shelf' | 'grid' | 'chevron' | 'sort' | 'platform' | 'globe' | 'sellers'

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
