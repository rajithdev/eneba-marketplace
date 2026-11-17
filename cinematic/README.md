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
| `build/` | Working files (not committed): rendered frames, `.blend` files, reference material. |
| `web/src/cinematic/` | The page side: `fit.ts` (arithmetic), `sequence.ts` (frame loading), `stage.ts` (drawing), `CinematicDeals.tsx` (the block with its fallback). |
| `web/public/cinematic/v0-blockout/` | The published frames of the current version and their manifest. |

## Commands

Needs Blender, Google Chrome and ffmpeg installed, and the API running (`make dev`).

```bash
node cinematic/build.mjs              # the low-resolution blockout, both layouts
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

## When there is no animation

The block renders as it always has when motion is reduced, data saving is
on, the connection is slow, the window is tablet-sized (640 to 1023 px),
the browser lacks what is needed, the frames fail to load, or the block
was already on screen when the frames arrived.
