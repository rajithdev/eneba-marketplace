#!/usr/bin/env node
// Draws one original cover image per game, from the curated catalog data.
//
//   node scripts/catalog/generate-covers.mjs          write web/public/covers/<game>.svg
//   node scripts/catalog/generate-covers.mjs --check  fail if any file is missing or out of date
//
// Why generated: publishers own their cover art, and this project has no
// licence to republish it. These covers are abstract compositions (a colour
// gradient, a few shapes, the title set in type) made entirely by this script,
// so they are ours to use. Nothing is traced or derived from real artwork.
//
// One cover per GAME, not per sellable variant: Elden Ring on Steam GLOBAL and
// on Xbox EUROPE show the same image, as the API's cover_image_url says.
//
// Nothing is random. Colours and shapes are computed from a hash of the
// game's slug, so the same data always produces the same files.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const games = JSON.parse(readFileSync(join(root, 'api', 'database', 'data', 'games.json'), 'utf8'))
const outDir = join(root, 'web', 'public', 'covers')
const checkOnly = process.argv.includes('--check')

const WIDTH = 600
const HEIGHT = 800
const TYPE_LABELS = { dlc: 'DLC', gift_card: 'GIFT CARD', subscription: 'SUBSCRIPTION' }

/** A whole number from $min to $max that depends only on the key. */
function number(key, min, max) {
  const value = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16)
  return min + (value % (max - min + 1))
}

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;')

/** Break a title into lines of at most ~12 characters, keeping words whole. */
function wrap(title) {
  const lines = []
  for (const word of title.toUpperCase().split(/\s+/)) {
    const last = lines[lines.length - 1]
    if (last && `${last} ${word}`.length <= 12) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

function cover(game) {
  const { slug } = game
  const hue = number(`hue|${slug}`, 0, 359)
  const second = (hue + number(`shift|${slug}`, 30, 90)) % 360
  const accent = (hue + 180) % 360

  // Three soft discs and a diagonal band, placed by hash.
  const discs = [1, 2, 3]
    .map((i) => {
      const cx = number(`cx${i}|${slug}`, 0, WIDTH)
      const cy = number(`cy${i}|${slug}`, 0, 520)
      const r = number(`r${i}|${slug}`, 90, 260)
      const fill = i === 2 ? `hsl(${accent} 85% 60%)` : `hsl(${(hue + i * 25) % 360} 80% 65%)`
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="0.${number(`o${i}|${slug}`, 18, 38)}"/>`
    })
    .join('\n  ')
  const band = number(`band|${slug}`, -200, 300)

  const lines = wrap(game.title)
  const longest = Math.max(...lines.map((line) => line.length))
  // Fit the longest line into the width. 0.82 is a generous estimate of a
  // heavy capital's width relative to the font size, so the text stays inside
  // the margin even where the browser substitutes a wider font.
  const fontSize = Math.min(84, Math.floor((WIDTH - 80) / (longest * 0.82)), Math.floor(360 / lines.length))
  const lineHeight = Math.round(fontSize * 1.08)
  const firstBaseline = HEIGHT - 70 - (lines.length - 1) * lineHeight
  const text = lines
    .map((line, i) => `<text x="40" y="${firstBaseline + i * lineHeight}">${escapeXml(line)}</text>`)
    .join('\n    ')

  const label = TYPE_LABELS[game.type]
    ? `<g font-size="22" font-weight="700" letter-spacing="3">
    <rect x="40" y="44" width="${TYPE_LABELS[game.type].length * 17 + 30}" height="40" rx="20" fill="hsl(${accent} 90% 62%)"/>
    <text x="55" y="72" fill="#12081f">${TYPE_LABELS[game.type]}</text>
  </g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${escapeXml(game.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 32%)"/>
      <stop offset="1" stop-color="hsl(${second} 75% 14%)"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.35" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  ${discs}
  <rect x="${band}" y="-100" width="120" height="1100" fill="#fff" opacity="0.07" transform="rotate(24 300 400)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
  ${label}
  <g fill="#fff" font-family="'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${fontSize}">
    ${text}
  </g>
</svg>
`
}

mkdirSync(outDir, { recursive: true })

let outOfDate = 0
for (const game of games) {
  const file = join(outDir, `${game.slug}.svg`)
  const svg = cover(game)

  if (checkOnly) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== svg) {
      outOfDate += 1
      console.log(`out of date: web/public/covers/${game.slug}.svg`)
    }
  } else {
    writeFileSync(file, svg)
  }
}

// A drawn cover with no game behind it is a leftover. Only the drawn covers
// are looked at: the folder also holds art/, the pictures the frontend
// chooses for some games (web/src/lib/coverArt.ts), which are not made here.
const expected = new Set(games.map((game) => `${game.slug}.svg`))
const strays = readdirSync(outDir).filter((name) => name.endsWith('.svg') && !expected.has(name))
for (const name of strays) console.log(`not in the catalog: web/public/covers/${name}`)

if (checkOnly) {
  if (outOfDate || strays.length) {
    console.log('Run: node scripts/catalog/generate-covers.mjs')
    process.exit(1)
  }
  console.log(`${games.length} covers are up to date, one per game.`)
} else {
  console.log(`Wrote ${games.length} covers to web/public/covers.`)
}
