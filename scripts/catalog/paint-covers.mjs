#!/usr/bin/env node
// Builds the painted covers listed in painted-covers.json: one 600x800 JPEG
// per game, written to web/public/covers/art/<game>.jpg, which the frontend
// shows in place of the drawn cover (web/src/lib/coverArt.ts).
//
//   node scripts/catalog/paint-covers.mjs            build every listed cover, and docs/COVER_CREDITS.md
//   node scripts/catalog/paint-covers.mjs hades      build only the named games
//   node scripts/catalog/paint-covers.mjs --check    fail if a game in the catalog has no painted cover
//
// Two kinds of cover are built here:
//
// - "picture": a picture that is in the public domain or under CC0, taken
//   from Wikimedia Commons, cropped to the card's shape, shaded at the top
//   and the foot, with the game's title set in type. It is not the game's
//   artwork and is not derived from it. Publishers own their cover art and
//   this project has no licence for it.
// - "card": a gift card or subscription, drawn entirely here with CSS. No
//   logo is used; only the platform's name, in type.
//
// The other covers in the same folder were made and supplied by the author
// as finished pictures, and are not built here. Running this script never
// touches them.
//
// How: each cover is a small HTML page that Chrome renders without a window
// and saves as a picture; ffmpeg turns that into a JPEG. Both must be
// installed. The titles use fonts that ship with macOS; only the rendered
// picture is published, not the fonts.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(root, 'web', 'public', 'covers', 'art')
// Downloaded pictures are kept here between runs. Not committed (.gitignore).
const cache = join(here, '.cover-sources')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Wikimedia asks every client to name itself.
const headers = { 'User-Agent': 'keymarket-cover-builder/1.0' }

const covers = JSON.parse(readFileSync(join(here, 'painted-covers.json'), 'utf8'))
const games = JSON.parse(readFileSync(join(root, 'api', 'database', 'data', 'games.json'), 'utf8'))

if (process.argv.includes('--check')) {
  const missing = games.filter((game) => !existsSync(join(outDir, `${game.slug}.jpg`))).map((game) => game.slug)
  if (missing.length > 0) {
    console.error(`No painted cover in web/public/covers/art for: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`${games.length} painted covers are present, one per game.`)
  process.exit(0)
}

const FONTS = {
  serif: `font-family: Didot, 'Bodoni 72', Baskerville, serif; letter-spacing: .08em; font-weight: 700`,
  bold: `font-family: 'DIN Condensed', Impact, sans-serif; letter-spacing: .02em; font-weight: 700`,
  'bold italic': `font-family: 'DIN Condensed', Impact, sans-serif; letter-spacing: .02em; font-weight: 700; transform: skewX(-8deg)`,
  slab: `font-family: Rockwell, 'American Typewriter', serif; letter-spacing: .04em; font-weight: 700`,
  warm: `font-family: 'American Typewriter', Rockwell, serif; letter-spacing: .05em; font-weight: 700`,
}
const GOLD = 'background: linear-gradient(#fff3c4, #e2b24c 55%, #a8731f); -webkit-background-clip: text; color: transparent'

/** The picture a cover is built from, downloaded from Wikimedia Commons the first time it is needed. */
async function source(cover) {
  const file = join(cache, `${cover.game}.jpg`)
  if (existsSync(file)) return file

  const question = new URLSearchParams({ action: 'query', format: 'json', titles: cover.picture.file, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '1500' })
  const answer = await (await fetch(`https://commons.wikimedia.org/w/api.php?${question}`, { headers })).json()
  const { thumburl } = Object.values(answer.query.pages)[0].imageinfo[0]
  mkdirSync(cache, { recursive: true })
  writeFileSync(file, Buffer.from(await (await fetch(thumburl, { headers })).arrayBuffer()))

  return file
}

/** What is behind the title: the cropped picture, or the drawn card. */
async function backdrop(cover) {
  if (cover.picture) {
    // "at" is which part of the picture stays in view once it is cropped; "tint" darkens a pale one.
    const tint = cover.tint ? `<div style="position:absolute; inset:0; background:${cover.tint}; mix-blend-mode:multiply"></div>` : ''

    return `<div style="position:absolute; inset:0; background:url('file://${await source(cover)}') ${cover.at} / ${cover.size ?? 'cover'} no-repeat #000"></div>${tint}`
  }

  const { label, value, light, dark, ink } = cover.card
  const shape = 'position:absolute; left:90px; top:310px; width:420px; height:264px; border-radius:26px'

  return `
    <div style="position:absolute; inset:0; background:radial-gradient(120% 90% at 30% 15%, ${light}, ${dark} 60%, #07030f)"></div>
    <div style="${shape}; transform:rotate(9deg) translate(26px, -18px); background:linear-gradient(135deg, ${dark}, #0b0616); box-shadow:0 20px 40px rgba(0,0,0,.4)"></div>
    <div style="${shape}; transform:rotate(-8deg); overflow:hidden; background:linear-gradient(135deg, ${light}, ${dark}); border:1px solid rgba(255,255,255,.35); box-shadow:0 30px 60px rgba(0,0,0,.55)">
      <div style="position:absolute; inset:0; background:linear-gradient(115deg, rgba(255,255,255,.26) 0 28%, transparent 28.5%)"></div>
      <div style="position:absolute; left:28px; top:24px; font:700 20px 'Avenir Next', sans-serif; letter-spacing:.18em; color:${ink}">${label}</div>
      <div style="position:absolute; right:28px; bottom:14px; font:700 84px 'DIN Condensed', Impact, sans-serif; color:${ink}">${value}</div>
    </div>`
}

/** The whole cover as an HTML page, 600 by 800. */
async function page(cover) {
  const title = cover.lines
    .map(([text, size, colour]) => `<div style="font-size:${size}px; line-height:1.02; ${colour === 'gold' ? GOLD : `color:${colour}`}">${text}</div>`)
    .join('')

  return `<!doctype html><meta charset="utf-8">
    <body style="margin:0; width:600px; height:800px; overflow:hidden; background:#000">
    ${await backdrop(cover)}
    <div style="position:absolute; inset:0; background:
      linear-gradient(to bottom, rgba(8,4,18,.82) 0, rgba(8,4,18,0) 42%),
      linear-gradient(to top, rgba(8,4,18,.92) 0, rgba(8,4,18,0) 20%)"></div>
    <div style="position:absolute; left:0; right:0; top:${cover.top ?? 44}px; text-align:center; ${FONTS[cover.style]};
      filter:drop-shadow(0 3px 6px rgba(0,0,0,.75)) drop-shadow(0 0 22px rgba(0,0,0,.5))">${title}</div>`
}

const only = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const work = mkdtempSync(join(tmpdir(), 'covers-'))
mkdirSync(outDir, { recursive: true })

for (const cover of covers) {
  if (only.length > 0 && !only.includes(cover.game)) continue

  const html = join(work, `${cover.game}.html`)
  const png = join(work, `${cover.game}.png`)
  writeFileSync(html, await page(cover))
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=600,800', `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-q:v', '5', join(outDir, `${cover.game}.jpg`)])
  console.log(`wrote ${cover.game}.jpg`)
}

// The credits are written from the same list, so they cannot fall out of step with the covers.
const title = (slug) => games.find((game) => game.slug === slug)?.title ?? slug
const rows = covers
  .filter((cover) => cover.picture)
  .map(({ game, picture }) => `| ${title(game)} | ${picture.title} | ${picture.by} | ${picture.year} | ${picture.licence} | [Commons](${picture.page}) |`)
const drawn = covers.filter((cover) => cover.card).map((cover) => title(cover.game))

writeFileSync(
  join(root, 'docs', 'COVER_CREDITS.md'),
  `# Cover picture credits

Written by \`scripts/catalog/paint-covers.mjs\` from \`scripts/catalog/painted-covers.json\`. Do not edit by hand.

Every game has a painted cover in \`web/public/covers/art/\`. None is a
publisher's official artwork.

## Built from public-domain pictures

${rows.length} covers are built from pictures that are in the public domain or released
under CC0, found on Wikimedia Commons. Each was cropped to the card's shape
(600 x 800), shaded at the top and the foot, and given the game's title in
type. They are not derived from the games' artwork.

The licence in each row is the one Wikimedia Commons states on the file's
page, read on 18 November 2026. This is a cautious reading, not legal advice.

| Game | Picture | By | Year | Licence | Source |
|---|---|---|---|---|---|
${rows.join('\n')}

## Drawn by the script

${drawn.length} covers are gift cards and subscriptions drawn entirely by the script, with
no logo: ${drawn.join(', ')}.

## Supplied by the author

The remaining ${games.length - covers.length} covers were made and supplied by the author as finished
pictures, and scaled to 600 x 800: ${games.filter((game) => !covers.some((cover) => cover.game === game.slug)).map((game) => game.title).join(', ')}.

## Fonts

The titles are set in fonts that ship with macOS (Didot, DIN Condensed,
Rockwell, American Typewriter, Avenir Next). Only the rendered picture is
published, not the fonts.
`,
)
console.log(`wrote docs/COVER_CREDITS.md (${rows.length} pictures, ${drawn.length} drawn)`)
