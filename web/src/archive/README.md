# Game Archive

The store's catalog as a shelf of boxed games to walk along, instead of a grid
to scan. It lives at its own addresses beside the store page, which is
unchanged:

| Address | What it is | What opens it |
|---|---|---|
| `/archive` | The shelf | "Store" and the category links in the header and footer |
| `/archive/all` | "Browse all": the store page itself (filters, sorting, pages) under the same two-way switch | The switch on the shelf |
| `/store` | The store page, untouched | A search, the "Browse the store" buttons, and the homepage's own links |

Its code is fetched only when one of the first two is opened (a lazy route),
so no other page pays for it. Nothing in `cinematic/` or `motion/` (the
homepage's deals showroom and scroll effects) is imported or changed.

## It is the same catalog

- The address holds the store's own parameters (`type`, `platform`, `region`,
  `min_price`, `max_price`, `sort`, `q`) and they are sent to the same
  endpoint, `GET /api/products`. The switch between the shelf and the list
  carries them across, both ways.
- The shelves to choose from are the product types `GET /api/filters`
  reports, and the orders are the sort orders it offers, with its labels.
- A case shows the product's cover, the platform it is redeemed on and its
  game's title. Under the shelf: the product's name, platform, region, number
  of sellers, lowest price (the store's own `<PriceTag>`, so discounts and
  "Sold out" read the same) and a link to its offers. Nothing is invented
  here and no price is stored here.
- The API serves the catalog a page at a time. The shelf starts with the
  first page and asks for the next when the chosen case is within ten of the
  end of what it has.

## How it is drawn

No canvas, no 3D library and no picture of a stage: each case is a box made
of elements placed with CSS 3D transforms (`archive.css`): the cover under a
glossy sleeve, a printed spine on the left, the opening edge on the right, a
shadow, and a reflection in the floor. The cases stand in an arc that opens
toward the visitor, in one perspective, so the browser itself makes far
cases smaller and sorts what is in front of what.

Around them is a room, also plain CSS: a dark violet ground, the rim of a
great circle behind the row, a round floor under it, and a lamp over the
chosen case. The chosen case has a lit rim, and the lamp takes a little of
the colour of its cover (the cover's average colour, read once when a case
has been chosen; half of it is always the archive's own violet).

The archive has its own violet for what is pressed (the chosen shelf, "View
offers"), named once at the top of `archive.css`; the rest of the site keeps
its yellow.

| File | What it holds |
|---|---|
| `shelf.ts` | The arithmetic, free of the browser and unit-tested: where a case stands for its distance from the middle, which case a scroll position means, which cases are worth drawing, the keyboard |
| `GameCase.tsx` | One case |
| `ArchiveStage.tsx` | The shelf on a wide window |
| `ArchiveRail.tsx` | The shelf on a phone or small window, and wherever reduced motion is asked for |
| `CaseDetails.tsx` | What is written under the shelf |
| `ArchivePage.tsx` | The page: fetching, the header, which of the two shelves is used |

**The stage (a window at least 1024 by 680, motion allowed).** The page's own
scrolling moves the shelf. The stage is held in place while an empty stretch
scrolls past, 96px per case, so scrolling back runs the shelf back, the
scrollbar shows how far along the collection is, and scrolling is never taken
from the browser. A click on a case, the arrow keys, Home, End, Page Up and
Down, and the two arrow buttons scroll the page to that case; a sideways
swipe on a trackpad or a drag does too. A click on the chosen case, or Enter,
opens its offers.

While the shelf moves, each drawn case is given a transform, a brightness
and the strength of its rim, and nothing else, once per display frame. Only
the cases within seven of the middle are in the page. Once the shelf has
come to rest no code runs at all.

**The rail (everything else).** The same cases in a row that is scrolled
sideways with a finger and comes to rest on a case: the browser's own
scrolling and scroll snapping. On a phone the header is two rows (the title
with the order and the two views as picture buttons, then the shelves as a
row that scrolls sideways), and the price with "View offers" is a bar that
stays at the foot of the screen while the page is scrolled over it. Where the browser can tie an animation to a
scroll position by itself (`animation-timeline: view()`), the cases turn to
face the middle as they pass, with no script running; elsewhere, and with
reduced motion, they simply stand in a row.

**For the keyboard and screen readers** the shelf is a list box: one stop in
the tab order, the arrow keys move along it, each case is announced with its
name and price and its place ("7 of 71"), and the cases themselves are
decoration hidden from screen readers.

## Known limits

- Reloading the page starts again at the first case. (Coming back from a
  product page returns to the case that was left.)
- With reduced motion a wide window gets the flat rail, not a still version
  of the stage.
- The label on a case names its platform in words beside a plain mark. No
  platform's logo is used anywhere on the site.
- In a window less than 820px tall a long name under the shelf is cut to one
  line (the whole name is its tooltip, and the region is said beside it).
- A shelf is walked from its first case: there is no jumping to the middle of
  a long one except by scrolling or the End key. "Browse all" is the way to
  scan a long list.

## Checking it

`npm test` runs `shelf.test.ts` and `ArchivePage.test.tsx` (the page on both
the stage and the rail, against the recorded API examples).

`scripts/archive/preview.mjs` drives the installed Chrome against a running
site, checks the behaviour above against what the API answers, measures what
the page downloads and holds and the time between display frames while the
shelf is scrolled, and saves screenshots:

```
cd web && npm run build && npx vite preview --port 4173
node scripts/archive/preview.mjs http://localhost:4173 <output folder>
```
