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

## The shop's cover illustrations

`artwork.mjs` draws twenty original game covers (600 by 800, the shape of a
product card's cover) from shapes and gradients: science fiction, fantasy,
racing, action, horror, adventure and cyberpunk. They carry no lettering
and no logos, and nothing is taken from an existing game.

They are in ranking order. The first eight go on the large display cases,
chosen so that neighbouring bays and the two sides of the aisle differ;
all twenty stock the shelves, three drawings apart from one case to the
next so that neighbours never match. The six cases the animation ends on
are not part of this: they keep the real products' covers.

```
node cinematic/build.mjs --artwork                      the pictures and a contact sheet
node cinematic/build.mjs --lookdev --art-folder=<dir>   use the pictures in a folder instead (3:4, best first by name)
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
