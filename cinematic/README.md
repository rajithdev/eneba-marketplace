# The game vault: scroll-controlled section above "Top deals"

A prototype, on its own branch. Nothing here is part of the deployed site.

The visitor scrolls through a rendered corridor of game cases; the last
frame's row of cases becomes the deals block's real product cards. The
picture is decoration. Names, prices, discounts and links are always the
ordinary React block, backed by the API.

## What is where

| | |
|---|---|
| `scene.py` | The Blender scene, built entirely by script. The whole scene is a function of scroll progress (0 to 1), so every frame is repeatable and the last frame can be described exactly. |
| `build.mjs` | Prepares cover textures, asks the API which products the deals block holds, runs Blender, writes the manifest and publishes frames to `web/public/cinematic/<version>/`. |
| `measure.mjs` | Opens the site in Chrome at several window sizes and measures loading, memory, alignment and scroll smoothness, and records the scroll. |
| `compare.py` | Measures a clip from a video model against the Blender motion reference it was made from. |
| `build/` | Working files (not committed): rendered frames, `.blend` files, reference material. |
| `web/src/cinematic/` | The page side: `layouts.ts` (which windows get the section, and its memory budgets), `fit.ts` (arithmetic), `sequence.ts` (frame loading and release), `stage.ts` (drawing), `CinematicDeals.tsx` (the block with its fallback). |
| `web/public/cinematic/v1-blockout/` | The published frames of the current version and their manifest: the blockout at final frame size. |

## Commands

Needs Blender, Google Chrome and ffmpeg installed, and the API running (`make dev`).

```bash
node cinematic/build.mjs              # the blockout at final frame size, both layouts
node cinematic/build.mjs --reference  # motion reference videos and stills for look development
node cinematic/build.mjs --samples    # a few frames at final size in several encodings, to measure file sizes
node cinematic/measure.mjs http://localhost:4173 design-review/cinematic/harness
```

## How the last frame meets the page

The row of cases ends flat and square to the camera, so each case's front
is an exact rectangle with the shape of a card's cover (3:4). `scene.py`
writes those rectangles into the manifest together with the product each
case was rendered for. The page measures where the real covers are, places
the frame so the row's ends meet, and checks how far each case is from its
cover.

- Same products in the same order, and every case within a pixel: the
  cards fade in over the cases.
- Anything else: the cases fade out, then the cards fade in.

## Space first, pictures second

Whether the section gets its pinned stage and scrolling room is decided
when the block first appears, from the window and the device alone. The
frames are fetched afterwards; when they arrive nothing on the page moves.
`measure.mjs` checks this by slowing the frames down and comparing the
page before and after.

Decoded pictures are held to a budget per layout (48 MB on a desktop,
24 MB on a phone): the picture furthest from the one on screen is released
to make room for the next, and all are released when the section leaves
the screen.

## When there is no animation

No space is reserved and the block renders as it always has when motion is
reduced, data saving is on, the connection is slow, the device reports
little memory, the window is tablet-sized (640 to 1023 px) or the browser
lacks what is needed. If the frames cannot be fetched, the block is simply
shown; the pinned stretch is dropped if that can be done out of sight.

## Looks: blockout and vault

The scene script draws the same move in one of two looks. The camera
route, the six hero cases and the last frame are the same code for both;
only the surroundings differ.

| | Blockout | Vault (`"look": "vault"`) |
|---|---|---|
| Renderer | EEVEE, about a second a frame | Cycles on the graphics processor |
| Surfaces | flat colours | veined stone, brushed metal, glass panes, polished floor tiles |
| Architecture | walls, pillars, glowing shelves | niches cut into the stone, metal shelves, framed cases on feet, a second shelf of small cases, a ledge under the ceiling, a bronze doorway, a chamber with side walls |
| Stock | none | every niche stocked like a shop: rows of small cases below, beside and above the display case, a pile of them on the shelf, a lit picture panel over the niche, spotlights on ceiling tracks. The large cases and the stock show the shop's own illustrations (below), and everything stands no nearer the middle than the shelves' front edge |
| Light | glowing bars | neon tubes drawn at a brightness a picture can show, each with a hidden lamp beside it that gives the light the tube would |

Three things keep the handoff to the page untouched in the vault look:

- The chamber ends in the page's band colour, and its floor and walls stop
  short of what the camera sees from its last position, so the last frame
  is still the six cases on that colour and nothing else.
- The hero cases are not dressed: no frame, glass or foot is added to them.
- Colours are still written as given ("Standard"), with no film-like tone
  curve, so the band colour in the picture equals the page's.

```
node cinematic/build.mjs --lookdev                          five stills, vault beside blockout, and the last-frame check
node cinematic/build.mjs --lookdev --scale=0.5 --samples=64 a quick rough pass while adjusting
node cinematic/build.mjs --lookdev --layout=narrow          the same for the phone's picture
node cinematic/build.mjs --lookdev --reference              stills and the whole move for a video model, covers without lettering
```

The check printed at the end compares the case positions and the last
frame with the blockout's. Stills go to `design-review/cinematic/lookdev/`
and working files to `build/v2-lookdev/`; nothing is published to the site.
The vault look is look development: the frames on the site are still the
blockout's.

## Photographic stills

`"photo": true` draws the vault as a camera would record it. It is for
reference stills only, never for the frames on the page: it changes how
colours are written, so the last frame's background would no longer equal
the page's.

- Covers are glossy prints lit by the shop's lamps (white strip lights
  under each shelf), not glowing pictures; the boxes on the shelves have a
  coloured strip across the top and plastic of their own.
- The stock stands a little off true, each case differently.
- Glass carries smudges; neon tubes are as bright as tubes are.
- Bright things roll off to white as on film, and one distance is in focus.
- Afterwards the picture gets what a lens and film add: a glow around
  bright things, darker corners, a hair of colour fringing, grain.

```
node cinematic/build.mjs --lookdev --reference --stills-only --photo    three stills and their distance maps
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -I \
    cinematic/check_stills.py <Blender frames> <candidates>              are repainted stills still this store, from this camera?
```

The distance maps (white near, dark far) are a structure guide for anyone
repainting the frames in an outside image tool; `check_stills.py` then
measures whether the results kept the layout, left the aisle empty and
share one palette.

## Colour grade

`grade.py` gives the rendered frames a darker, less purple, more filmic
look after rendering, so trying a look costs seconds and not a re-render.
It is one fixed rule from colour to colour, fitted to a reference picture
(a photographic repaint of frame 0) and stored as a standard colour table:

- tones are matched to the reference's spread of light and dark (deeper
  blacks, fuller highlights);
- surfaces bathed in violet light are taken down and toward neutral, while
  the neon itself is left bright;
- colour is reduced by hue and brightness as the reference has it, most of
  all in the shadows; the warm accents keep theirs.

Because the rule never looks at the frame it is applied to, it cannot make
one frame differ from the next. The grade is full for the first 78% of the
move and eases to nothing by 98%: the last frame has to be exactly the
render, since its background is the page's colour and its six cases are
the real covers.

`vault-grade.json` is the proposed rule; the colour table is made from it.

```
PY=/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13
$PY -I cinematic/grade.py bake  cinematic/vault-grade.json <grade.cube>
$PY -I cinematic/grade.py apply <grade.cube> <folder of PNG frames> <out folder>
```

## The shop's cover illustrations

`artwork.mjs` draws the shop's game covers (3:4, the shape of a product
card's cover) in code: science fiction, fantasy, racing, action, horror,
adventure and cyberpunk. They carry no lettering and no logos, and nothing
is taken from an existing game. There are two sets:

- **Eight painted covers** for the large display cases, which the camera
  passes close to. They are built up like a painting: distance in layers
  with mist between them, clouds and smoke from soft noise, figures lit
  from behind with a bright edge, shafts of light, rain or sparks, and a
  brush-and-canvas texture over the whole picture. Neighbouring bays and
  the two sides of the aisle never show the same one.
- **Twenty flat posters** that stock the shelves, three drawings apart
  from one case to the next so that neighbours never match.

The six cases the animation ends on are not part of this: they keep the
real products' covers.

```
node cinematic/build.mjs --artwork                      the pictures and two contact sheets
node cinematic/build.mjs --lookdev --art-folder=<dir>   use the pictures in a folder on the large cases instead (3:4, in name order)
```

## Comparing a generated clip with the reference

`compare.py` measures a clip from a video model against the Blender motion
reference it was made from: how far the camera has come (by the size of
the doorway), where the six panels end up against the positions exported
for the cards, and flicker. It also writes strips and a side-by-side video
to look at. It needs only ffmpeg and the numpy inside Blender's Python:

```
/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13 -I \
    cinematic/compare.py <reference.mp4> <generated.mp4> <out dir> \
    web/public/cinematic/v1-blockout/manifest.json
```

The one Seedance 2.5 test (17 November 2026) did not follow the camera
closely enough to use; the frames on the site are Blender's. The report is
kept with the review material, outside Git.

## Trying other covers on the six cases

For previews only. Published frames always show the covers of the products
the backend returns, because the last frame has to become those products'
cards.

- `cinematic/prepare_covers.py <list.json> <out folder>` cuts supplied
  pictures to 3:4 covers (900×1200) without stretching; the list names each
  file and the part of it to keep.
- `node cinematic/build.mjs --lookdev --chamber --hero-covers=<folder>`
  renders three chamber frames at final quality for desktop and phone, with
  the pictures in that folder on the cases, in name order.

## The handoff, and what it needs from the covers

The cases settle onto the cards' cover positions, and the block's real
title, discounts, names and prices fade in around them (`phases` in
`web/src/cinematic/fit.ts`). The covers appear not to change, because the
card's cover is the same picture the case carries. That only holds when
the frames were rendered for the products the block holds, in its order,
with each product's own cover picture: the build takes both from the
backend's answer. When they differ, the page falls back to a dissolve.

What the deals cards and the frames have to agree on:

- **The cover's box.** A cover sits edge to edge inside a one-pixel border,
  three wide to four high, and the row's gaps are a fixed share of its
  width on a desktop (`dealRow` in `web/src/components/HomeBlocks.tsx`).
  Anything else about a card can change without touching the frames.
- **Rounded covers.** The cases are rectangles. Where the cards round the
  top of their covers, the stage reads that rounding from the page and
  rounds the cases' corners to match, a little at a time, once they have
  landed (`rounding` in `phases`).
- **The picture.** A game with a painted cover in
  `web/public/covers/art/` shows it on its deals card
  (`web/src/lib/coverArt.ts`) and carries it on its case (`texture` in
  `build.mjs`); the others use the cover the backend names for both.
- **The colour around the cases.** Graded frames have a darker wall than
  the page until the grade lets go, so a manifest may list each frame's
  wall colour (`backdrops`); the stage fills with it around a frame that
  no longer covers the whole stage.

A light sweep between cases and cards was tried and dropped: it read as
one scene being swapped for another.

Trying a set of frames locally without publishing it:

- `bash cinematic/preview_set.sh preview-covers <covers folder> <slugs>`
  assembles a set from draft renders into
  `web/public/cinematic/preview-covers/` (not committed), with the covers
  beside the frames.
- `VITE_CINEMATIC_VERSION=preview-covers npm run dev` in `web/` uses it.
- `node cinematic/handoff_preview.mjs http://localhost:5173 <folder>` checks
  the handoff in headless Chrome, measures how much each cover changes
  through it, and records it forwards, very slowly and backwards.

## Frames from a finished video

`bash cinematic/video_set.sh <video> <version name>` cuts a set of frames
from a filmed or generated shot instead of rendering them: the whole
picture for a desktop, its middle for a phone, with fewer frames from the
stretch at the end where the camera has all but stopped. Such a shot does
not end on cases placed for the cards, so its manifest lists no slots and
the page dissolves from the last frame into the real block; nothing about
the cards depends on the frames.
