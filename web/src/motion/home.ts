/*
 * The homepage's scroll effects: the featured banner's depth as it leaves,
 * and the best sellers row arriving and receding. Each takes the element it
 * works on, starts, and returns the function that stops it and puts the
 * element back as it was. What is drawn at each position is decided in
 * poses.ts.
 *
 * Only transforms and opacity are set, on things that already have their
 * place in the page, so nothing around them ever moves. With reduced motion
 * none of this runs.
 */
import { AT_REST, follow, paint, whileMotionAllowed } from './follow'
import { cardPose, HERO_FOCUS, heroPose } from './poses'

/**
 * The featured banner. Its artwork (marked data-hero="art") slides and grows
 * a little inside the banner as the page scrolls, so it travels more slowly
 * than the text (data-hero="copy"), which rises and fades.
 */
export function heroMotion(banner: HTMLElement | null): () => void {
  if (!banner) return () => {}
  const art = banner.querySelector<HTMLElement>('[data-hero="art"]')
  const copy = banner.querySelector<HTMLElement>('[data-hero="copy"]')

  return whileMotionAllowed(() => {
    const stop = follow(() => {
      const box = banner.getBoundingClientRect()
      // The text's place in the banner (offsetTop), not the text as drawn: it is about to be moved.
      const copyTop = box.top + (copy?.offsetTop ?? 0)
      const pose = heroPose(window.scrollY, box.bottom + window.scrollY, copyTop, copyTop + (copy?.offsetHeight ?? 0))
      // A link in the text that has the keyboard's focus is never faded out from under it.
      const focused = copy?.contains(document.activeElement) ?? false

      return () => {
        if (pose.progress === 0) {
          paint(art, AT_REST)
          paint(copy, AT_REST)
          return
        }
        paint(art, {
          transform: `translateY(${pose.drift.toFixed(3)}%) scale(${pose.zoom.toFixed(4)})`,
          'transform-origin': `${HERO_FOCUS.x * 100}% ${HERO_FOCUS.y * 100}%`,
          opacity: '',
        })
        paint(copy, { transform: `translateY(${pose.lift.toFixed(1)}px)`, 'transform-origin': '', opacity: focused ? '' : pose.copyAlpha.toFixed(3) })
      }
    })

    return () => {
      stop()
      paint(art, AT_REST)
      paint(copy, AT_REST)
    }
  })
}

/**
 * A row (or, on a phone, a grid) of cards: each list item's first child is
 * the card, and the part of it marked data-reveal="info" is its text. The
 * items are measured and the cards inside them moved, so what is measured is
 * never what is moved.
 */
export function shelfMotion(list: HTMLElement | null): () => void {
  if (!list) return () => {}
  const cardIn = (item: Element) => item.firstElementChild as HTMLElement | null

  return whileMotionAllowed(() => {
    const stop = follow(() => {
      const windowHeight = window.innerHeight
      let rowTop = Number.NaN
      let column = 0
      const cards = [...list.children].map((item) => {
        const place = item.getBoundingClientRect()
        // Cards whose places start at the same height are in one row.
        column = Math.abs(place.top - rowTop) < 1 ? column + 1 : 0
        rowTop = place.top

        return { card: cardIn(item), pose: cardPose(place.top, place.bottom, windowHeight, column) }
      })

      return () => {
        for (const { card, pose } of cards) {
          const info = card?.querySelector<HTMLElement>('[data-reveal="info"]') ?? null
          if (pose.resting) {
            paint(card, AT_REST)
            paint(info, AT_REST)
            continue
          }
          paint(card, {
            transform: `perspective(900px) translateY(${pose.drop.toFixed(1)}px) rotateX(${pose.tilt.toFixed(2)}deg) scale(${pose.scale.toFixed(4)})`,
            'transform-origin': '50% 100%',
            opacity: pose.alpha.toFixed(3),
          })
          paint(info, { transform: '', 'transform-origin': '', opacity: pose.info === 1 ? '' : pose.info.toFixed(3) })
        }
      }
    })

    return () => {
      stop()
      for (const item of list.children) {
        paint(cardIn(item), AT_REST)
        paint(cardIn(item)?.querySelector<HTMLElement>('[data-reveal="info"]') ?? null, AT_REST)
      }
    }
  })
}
