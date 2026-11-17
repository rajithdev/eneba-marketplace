#!/usr/bin/env node
// Builds the frames for the scroll-controlled section above "Top deals".
//
//   node cinematic/build.mjs                  the blockout, both layouts
//   node cinematic/build.mjs --samples        a few frames at the final size, in several encodings, to measure real file sizes
//   node cinematic/build.mjs --api=http://localhost:8000
//
// What it does, in order:
//   1. Turns this project's own cover drawings (web/public/covers/*.svg)
//      into PNG textures, with the installed Chrome, so a case in the scene
//      shows exactly what a product card shows.
//   2. Asks the API which products the homepage's deals block holds. The
//      row of cases the animation ends on is made of the first of those,
//      in that order, and the manifest records which.
//   3. Runs Blender (cinematic/scene.py) once per layout.
//   4. Writes the manifest the web page reads, and copies it and the frames
//      to web/public/cinematic/<version>/.
//
// Needs: Blender and Google Chrome installed, and the API running.
// Working files go to cinematic/build/, which is not committed.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const flag = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const VERSION = flag('version', 'v1-blockout')
const API = flag('api', 'http://localhost:8000')
const BLENDER = flag('blender', '/Applications/Blender.app/Contents/MacOS/Blender')
const CHROME = flag('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const samplesOnly = process.argv.includes('--samples')
const referenceOnly = process.argv.includes('--reference')

const build = join(here, 'build')
const textures = join(build, 'textures')
mkdirSync(textures, { recursive: true })

// ---------------------------------------------------------------- 1. textures

const coverDir = join(root, 'web', 'public', 'covers')
for (const file of readdirSync(coverDir).filter((name) => name.endsWith('.svg'))) {
  const png = join(textures, file.replace('.svg', '.png'))
  if (existsSync(png) && statSync(png).mtimeMs > statSync(join(coverDir, file)).mtimeMs) continue
  execFileSync(CHROME, ['--headless=new', '--hide-scrollbars', '--window-size=600,800', '--default-background-color=00000000', `--screenshot=${png}`, `file://${join(coverDir, file)}`], { stdio: 'ignore' })
}
const texture = (coverUrl) => join(textures, coverUrl.split('/').pop().replace('.svg', '.png'))
console.log(`${readdirSync(textures).length} cover textures`)

// ---------------------------------------------------------------- 2. which products

const homepage = await (await fetch(`${API}/api/homepage`, { headers: { Accept: 'application/json' } })).json()
const deals = homepage.data.blocks.find((block) => block.type === 'deals')
if (!deals) throw new Error('The homepage has no deals block to end on.')
const products = deals.data.products.map((product) => ({ slug: product.slug, texture: texture(product.cover_image_url) }))
console.log(`deals block: ${products.map((product) => product.slug).join(', ')}`)

// ---------------------------------------------------------------- 3. layouts

/*
 * The numbers that tie a layout to the page. They come from the page's
 * own CSS: the content is at most 1280px wide with 16px at each side, and
 * a card has a 1px edge around its cover.
 *
 *   wide    six cards across with 16px between them (1024px and up)
 *   narrow  two cards across with 12px between them (under 640px)
 *
 * gapRatio is the space between two neighbouring covers divided by a
 * cover's width; rowShare is how much of the picture's width the row of
 * covers takes at the size the picture was composed for; rowCentre is how
 * far down the picture the covers' middle sits.
 */
const cover = (content, columns, gap) => (content - (columns - 1) * gap) / columns - 2
const wideCover = cover(1248, 6, 16)
const narrowCover = cover(343, 2, 12)
const layouts = {
  // Frame sizes and counts are the final ones, so that loading and memory
  // are measured as they will be: five seconds at 24 frames a second on a
  // desktop, four on a phone.
  wide: { slots: 6, width: 1440, height: 810, frames: 120, gapRatio: 18 / wideCover, rowShare: (6 * wideCover + 5 * 18) / 1440, rowCentre: 0.47 },
  narrow: { slots: 2, width: 720, height: 1280, frames: 96, gapRatio: 14 / narrowCover, rowShare: (2 * narrowCover + 14) / 375, rowCentre: 0.4 },
}
const BACKGROUND = '#341281' // --color-band in web/src/index.css

const gallery = readdirSync(textures).filter((name) => name.endsWith('.png')).sort().map((name) => join(textures, name))

function render(name, layout, extra) {
  const out = join(build, VERSION, extra.folder ?? name)
  rmSync(out, { recursive: true, force: true })
  const options = {
    width: layout.width, height: layout.height, frames: layout.frames, background: BACKGROUND, out, gallery,
    slots: products.slice(0, layout.slots), gap_ratio: layout.gapRatio, row_share: layout.rowShare, row_centre: layout.rowCentre,
    ...extra.options,
  }
  const started = Date.now()
  execFileSync(BLENDER, ['-b', '--factory-startup', '-P', join(here, 'scene.py'), '--', JSON.stringify(options)], { stdio: ['ignore', 'ignore', 'inherit'] })
  console.log(`${name}: rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  return out
}

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const sizes = (dir, ending) => readdirSync(dir).filter((file) => file.endsWith(ending)).map((file) => statSync(join(dir, file)).size)
const sum = (numbers) => numbers.reduce((total, number) => total + number, 0)

if (samplesOnly) {
  // Eight frames spread over the move, at the size the final would be, each saved several ways.
  const variants = [
    { name: 'q60.webp', format: 'WEBP', quality: 60 },
    { name: 'q75.webp', format: 'WEBP', quality: 75 },
    { name: 'q90.webp', format: 'WEBP', quality: 90 },
    { name: 'q60.avif', format: 'AVIF', quality: 60 },
    { name: 'q85.jpg', format: 'JPEG', quality: 85 },
  ]
  for (const [name, layout] of Object.entries(layouts)) {
    const only = Array.from({ length: 8 }, (_, index) => Math.round((index / 7) * (layout.frames - 1)))
    const out = render(name, layout, { folder: `${name}-samples`, options: { only, variants, samples: 32 } })
    console.log(`\n${name} at ${layout.width}x${layout.height}, ${only.length} frames (blockout content: flat shapes, so a lower bound for a detailed final look)`)
    for (const variant of variants) {
      const each = sizes(out, variant.name)
      console.log(`  ${variant.name.padEnd(9)} average ${kilobytes(sum(each) / each.length).padStart(9)}   largest ${kilobytes(Math.max(...each)).padStart(9)}`)
    }
  }
  process.exit(0)
}

if (referenceOnly) {
  // Material for a video model to work from, and for a person to judge the
  // move by: the whole camera move as a 24-frames-a-second video (with the
  // covers, and again with blank glowing panels), its exact first and last
  // pictures, and larger stills at the main beats.
  const reference = join(build, VERSION, 'reference')
  rmSync(reference, { recursive: true, force: true })
  mkdirSync(reference, { recursive: true })
  const clips = [
    { name: 'wide', layout: layouts.wide, width: 1280, height: 720, frames: 120, still: [1920, 1080] },
    { name: 'narrow', layout: layouts.narrow, width: 720, height: 1280, frames: 96, still: [1080, 1920] },
  ]
  for (const clip of clips) {
    const shape = { ...clip.layout, width: clip.width, height: clip.height, frames: clip.frames }
    for (const plain of [false, true]) {
      const label = `${clip.name}${plain ? '-plain' : ''}`
      const out = render(label, shape, { folder: `reference-frames-${label}`, options: { format: 'PNG', samples: 32, plain } })
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '24', '-i', join(out, 'f-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-movflags', '+faststart', join(reference, `motion-${label}.mp4`)])
      cpSync(join(out, 'f-000.png'), join(reference, `first-frame-${label}.png`))
      cpSync(join(out, `f-${String(clip.frames - 1).padStart(3, '0')}.png`), join(reference, `last-frame-${label}.png`))
    }
    // Stills at the beats of the storyboard, as fractions of the move.
    const beats = [0.02, 0.3, 0.56, 0.72, 1]
    const stillFrames = 201
    const out = render(`${clip.name} stills`, { ...clip.layout, width: clip.still[0], height: clip.still[1], frames: stillFrames }, {
      folder: `reference-stills-${clip.name}`,
      options: { format: 'PNG', samples: 64, only: beats.map((beat) => Math.round(beat * (stillFrames - 1))) },
    })
    for (const [index, beat] of beats.entries()) {
      cpSync(join(out, `f-${String(Math.round(beat * (stillFrames - 1))).padStart(3, '0')}.png`), join(reference, `still-${clip.name}-${index + 1}-at-${Math.round(beat * 100)}.png`))
    }
    // The same beats without artwork or lettering and with the polished look: what a video model is shown as "appearance".
    const plain = render(`${clip.name} plain stills`, { ...clip.layout, width: clip.still[0], height: clip.still[1], frames: stillFrames }, {
      folder: `reference-stills-${clip.name}-plain`,
      options: { format: 'PNG', samples: 128, plain: true, look: true, only: beats.map((beat) => Math.round(beat * (stillFrames - 1))) },
    })
    for (const [index, beat] of beats.entries()) {
      cpSync(join(plain, `f-${String(Math.round(beat * (stillFrames - 1))).padStart(3, '0')}.png`), join(reference, `still-${clip.name}-plain-${index + 1}-at-${Math.round(beat * 100)}.png`))
    }
  }
  for (const file of readdirSync(reference).sort()) console.log(`  ${file.padEnd(34)} ${kilobytes(statSync(join(reference, file)).size).padStart(10)}`)
  process.exit(0)
}

// ---------------------------------------------------------------- 4. manifest

const manifest = { version: VERSION, background: BACKGROUND, layouts: {} }
const published = join(root, 'web', 'public', 'cinematic', VERSION)
rmSync(published, { recursive: true, force: true })

for (const [name, layout] of Object.entries(layouts)) {
  const out = render(name, layout, { options: { blend: join(build, VERSION, `${name}.blend`) } })
  const report = JSON.parse(readFileSync(join(out, 'layout.json'), 'utf8'))
  const each = sizes(out, '.webp')
  manifest.layouts[name] = {
    frames: report.frames, width: report.width, height: report.height,
    path: `${name}/f-{frame}.webp`,
    bytes: sum(each),
    // The share of the scroll in which frames advance; the rest is the hold on the last frame.
    travel: 0.86,
    slots: report.slots,
  }
  mkdirSync(join(published, name), { recursive: true })
  for (const file of readdirSync(out).filter((file) => file.endsWith('.webp'))) cpSync(join(out, file), join(published, name, file))
  console.log(`${name}: ${each.length} frames, ${kilobytes(sum(each))} in all, ${kilobytes(sum(each) / each.length)} each, largest ${kilobytes(Math.max(...each))}`)
}
writeFileSync(join(published, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`published to web/public/cinematic/${VERSION}/`)
