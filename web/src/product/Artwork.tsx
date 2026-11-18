import { useState } from 'react'
import { coverArt, heroArt, sceneArt } from '../lib/coverArt'
import { COVER_NAME } from './openProduct'

/*
 * The game's own pictures, as the product page shows them.
 *
 * The catalog has a 600 x 800 painted cover for every game, and for a few a
 * wider scene. None of them is big enough to fill a wide screen sharply, so
 * none is ever shown enlarged as it is: the wide picture behind the title is
 * deliberately thrown out of focus into a wash of the game's colours, and
 * the cover itself is shown sharp, no larger than it was painted (it is
 * 300 pixels wide at most here, which a high-density screen draws from the
 * full 600).
 */

/** The picture to blur behind the title: the widest one the game has. */
const backdropFor = (coverUrl: string | null) => heroArt(coverUrl) ?? sceneArt(coverUrl) ?? coverArt(coverUrl)

/**
 * The atmosphere behind the title. It reaches up behind the header and
 * across the whole width of the window, and fades into the page at its
 * foot. Purely decorative, so hidden from screen readers. Sits beneath
 * everything (negative z-index), never in front of the header's links.
 */
export function Backdrop({ coverUrl, dimmed }: { coverUrl: string | null; dimmed: boolean }) {
  const source = backdropFor(coverUrl)
  const cover = coverArt(coverUrl)
  const [failed, setFailed] = useState(false)

  return (
    <div
      aria-hidden="true"
      className="spot-enter-fade pointer-events-none absolute left-1/2 top-[-11rem] -z-10 h-[40rem] w-screen -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_62%,transparent_100%)] md:h-[46rem] lg:top-[-12rem] lg:h-[54rem]"
    >
      {/* Taller than its frame at the top, so drifting down never uncovers an edge. */}
      <div className="spot-drift absolute inset-x-0 -top-40 bottom-0 will-change-transform">
        {source && !failed && (
          <img
            src={source}
            alt=""
            decoding="async"
            onError={() => setFailed(true)}
            className={`size-full scale-110 object-cover object-[70%_30%] blur-[22px] saturate-[1.3] md:blur-[26px] ${dimmed ? 'brightness-[0.4] grayscale-[0.7]' : 'brightness-[0.85]'}`}
          />
        )}
      </div>
      {/*
        On a wide screen, the cover itself once more, large and softly out of
        focus on the right, behind the buy panel: the shapes of the artwork
        stay recognisable without the picture ever being shown enlarged and
        sharp.
      */}
      {cover && !failed && (
        <div className="spot-drift absolute -top-40 bottom-0 right-[-6%] hidden w-[58%] will-change-transform [mask-image:radial-gradient(75%_70%_at_60%_45%,black_30%,transparent_75%)] lg:block">
          <img
            src={cover}
            alt=""
            decoding="async"
            className={`size-full object-cover object-[50%_35%] blur-[7px] ${dimmed ? 'opacity-25 grayscale' : 'opacity-60'}`}
          />
        </div>
      )}
      {/* Shade: darkest at the top (under the header) and on the left (under the title), a violet tint over all of it. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(10_4_32/0.85)_0%,rgb(10_4_32/0.3)_24%,rgb(10_4_32/0.1)_55%,rgb(22_10_54/0.92)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(10_4_32/0.8)_0%,rgb(10_4_32/0.5)_35%,rgb(10_4_32/0.05)_75%,rgb(10_4_32/0.25)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(60rem_30rem_at_20%_40%,rgb(110_50_220/0.28),transparent_70%)] mix-blend-screen" />
    </div>
  )
}

/**
 * The cover, sharp, with the lit edge every card has. If there is no cover,
 * or it fails to load, a panel with the game's first letter stands in, so
 * there is never a broken picture.
 */
export function Cover({ coverUrl, title, soldOut, className = '' }: { coverUrl: string | null; title: string; soldOut: boolean; className?: string }) {
  const source = coverArt(coverUrl)
  const [failed, setFailed] = useState(false)
  // The landing place of a picture clicked elsewhere (see openProduct.ts).
  const landing = { 'data-cover-target': '', style: { viewTransitionName: COVER_NAME } }
  const frame = `relative aspect-[3/4] overflow-hidden rounded-card border border-edge/50 bg-card shadow-[0_30px_60px_-24px_rgb(4_1_18/0.95),0_0_0_1px_rgb(176_140_255/0.08)] ${className}`

  if (!source || failed) {
    return (
      <div {...landing} className={`${frame} flex items-center justify-center bg-linear-to-b from-panel-top to-card-foot`}>
        <span aria-hidden="true" className="text-6xl font-black text-white/70">
          {title.charAt(0)}
        </span>
      </div>
    )
  }

  return (
    <div {...landing} className={frame}>
      <img
        src={source}
        alt={`Cover of ${title}`}
        width={600}
        height={800}
        // The cover is the largest thing on the first screen: fetched first.
        fetchPriority="high"
        onError={() => setFailed(true)}
        className={`size-full object-cover ${soldOut ? 'opacity-60 grayscale' : ''}`}
      />
      {/* A faint sheen along the top edge, as on a printed box. */}
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(160deg,rgb(255_255_255/0.14)_0%,transparent_28%)]" />
    </div>
  )
}
