import { useId, type CSSProperties, type Ref } from 'react'
import { WAVE_PATH } from './wave'

/*
 * The curved edge between the best sellers and the game store below them:
 * a wave across the whole width of the window, highest at both sides and
 * lowest in the middle, with a thin lit line along it (the curve is in
 * wave.ts). Its lines keep their width in pixels however the curve is
 * stretched (vector-effect="non-scaling-stroke"), so it is as fine on a
 * phone as on a wide screen.
 */

/**
 * The lit line along the curve: a fine pale core with a touch of warm gold
 * where the wave turns at either side, over a soft violet glow (the same
 * curve in wider strokes, blurred). Decoration only: hidden from screen
 * readers, and it never takes a click.
 *
 * Its top is the curve's top; give it the curve's depth as its height. The
 * glow spills a little past that box, above and below the line.
 */
export function WaveEdge({ ref, className = '', style }: { ref?: Ref<HTMLDivElement>; className?: string; style?: CSSProperties }) {
  const gold = useId()
  const line = { viewBox: '0 0 1000 100', preserveAspectRatio: 'none', className: 'absolute inset-0 h-full w-full overflow-visible' }

  return (
    <div ref={ref} aria-hidden="true" className={`pointer-events-none mix-blend-screen ${className}`} style={style}>
      <svg {...line} className={`${line.className} blur-[10px]`}>
        <g fill="none">
          <path d={WAVE_PATH} vectorEffect="non-scaling-stroke" stroke="#7c3aed" strokeOpacity="0.55" strokeWidth="30" />
          <path d={WAVE_PATH} vectorEffect="non-scaling-stroke" stroke="#a78bfa" strokeOpacity="0.5" strokeWidth="8" />
        </g>
      </svg>
      <svg {...line}>
        <defs>
          <linearGradient id={gold} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0">
            <stop offset="0.08" stopColor="#ffc46b" stopOpacity="0" />
            <stop offset="0.2" stopColor="#ffc46b" stopOpacity="0.85" />
            <stop offset="0.36" stopColor="#ffc46b" stopOpacity="0" />
            <stop offset="0.64" stopColor="#ffc46b" stopOpacity="0" />
            <stop offset="0.8" stopColor="#ffc46b" stopOpacity="0.85" />
            <stop offset="0.92" stopColor="#ffc46b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none">
          <path d={WAVE_PATH} vectorEffect="non-scaling-stroke" stroke="#a78bfa" strokeOpacity="0.55" strokeWidth="4" />
          <path d={WAVE_PATH} vectorEffect="non-scaling-stroke" stroke={`url(#${gold})`} strokeWidth="2.5" />
          <path d={WAVE_PATH} vectorEffect="non-scaling-stroke" stroke="#f3e9ff" strokeOpacity="0.9" strokeWidth="1.25" />
        </g>
      </svg>
    </div>
  )
}
