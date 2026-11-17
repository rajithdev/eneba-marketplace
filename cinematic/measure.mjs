#!/usr/bin/env node
// Measures the scroll-controlled section in a real browser (the installed
// Chrome, driven over its debugging protocol) and records it.
//
//   node cinematic/measure.mjs <site address> <output folder>
//
// For each window size it reports:
//   - loading: what the effect downloads before it switches on, and in all
//   - memory: the page's script memory with and without the effect, and the
//     size of the decoded pictures it holds
//   - alignment: how far each case in the last frame is from its card's
//     cover, both as the page computes it and as measured from the pixels
//     actually drawn
//   - responsiveness: time between display frames while scrolling through
//     the section at reading speed, down and back up
// and saves screenshots along the scroll, and a recording for two sizes.
//
// Chrome runs headless here, so frame timings show whether the page keeps
// up, not what a particular phone will do.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SIZES = [
  { name: '1024', width: 1024, height: 768, scale: 1, mobile: false },
  { name: '1280', width: 1280, height: 800, scale: 1, mobile: false },
  { name: '1440', width: 1440, height: 900, scale: 1, mobile: false, record: true },
  { name: 'phone-375', width: 375, height: 812, scale: 2, mobile: true, record: true },
  { name: 'tablet-768', width: 768, height: 1024, scale: 1, mobile: false, expectFallback: true },
]

// ------------------------------------------------------------------ Chrome

const port = 9300 + Math.floor(Math.random() * 400)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'measure-'))}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => entry.type === 'page')
  } catch {}
}
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve))
let nextId = 0
const waiting = new Map()
const requests = new Map() // request id -> address
let downloads = [] // { url, bytes }
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject } = waiting.get(message.id)
    waiting.delete(message.id)
    message.error ? reject(new Error(message.error.message)) : resolve(message.result)
  }
  if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url)
  if (message.method === 'Network.loadingFinished') downloads.push({ url: requests.get(message.params.requestId) ?? '', bytes: message.params.encodedDataLength })
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  waiting.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Performance.enable')

const heapMB = async () => {
  await send('HeapProfiler.collectGarbage')
  const { metrics } = await send('Performance.getMetrics')
  return Math.round((metrics.find((metric) => metric.name === 'JSHeapUsedSize').value / 1048576) * 10) / 10
}
const bytesOf = (filter) => downloads.filter((download) => filter(download.url)).reduce((total, download) => total + download.bytes, 0)
const isFrame = (url) => url.includes('/cinematic/') && url.endsWith('.webp')
const isEffectCode = (url) => /\/assets\/(stage|sequence|fit)[^/]*\.js$/.test(url) || url.endsWith('manifest.json')
const kb = (bytes) => Math.round(bytes / 102.4) / 10
const shot = async (file) => writeFileSync(join(outDir, file), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })).data, 'base64'))

async function open(size, { calm = false } = {}) {
  downloads = []
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: calm ? 'reduce' : 'no-preference' }] })
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Page.navigate', { url: `${base}/?cinematic-debug` })
  for (let i = 0; i < 100; i++) {
    await sleep(100)
    if (await evaluate(`document.querySelectorAll('main section').length >= 3 && [...document.images].every((image) => image.complete)`).catch(() => false)) break
  }
}

/** Where the section starts on the page and how long its pinned stretch is. */
const section = () => evaluate(`(() => { const canvas = document.querySelector('main canvas'); const runway = canvas.parentElement.parentElement; return { top: runway.getBoundingClientRect().top + scrollY, pin: runway.lastElementChild.getBoundingClientRect().height * (canvas.hidden ? 0 : 1), armed: !canvas.hidden } })()`)
const scrollTo = async (y, settle = 450) => {
  await evaluate(`window.scrollTo(0, ${Math.round(y)})`)
  await sleep(settle)
}

/**
 * The edges of each case as actually drawn, found by walking the canvas's
 * pixels outwards from the middle of each cover until the page's band
 * colour is reached, compared with the cover's own edges.
 */
const drawnEdges = `(() => {
  const canvas = document.querySelector('main canvas'); const box = canvas.getBoundingClientRect(); const density = canvas.width / box.width
  const context = canvas.getContext('2d'); const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const band = [0x34, 0x12, 0x81]
  const isBand = (x, y) => { const i = (Math.round(y) * canvas.width + Math.round(x)) * 4; return Math.abs(pixels.data[i] - band[0]) + Math.abs(pixels.data[i + 1] - band[1]) + Math.abs(pixels.data[i + 2] - band[2]) < 36 }
  const covers = [...canvas.parentElement.querySelectorAll('li img')].slice(0, window.__cinematic.offByPx.length)
  return covers.map((image) => {
    const at = image.getBoundingClientRect(); const cx = (at.left - box.left + at.width / 2) * density; const cy = (at.top - box.top + at.height / 2) * density
    const walk = (dx, dy) => { let x = cx, y = cy; while (x > 0 && y > 0 && x < canvas.width && y < canvas.height && !isBand(x, y)) { x += dx; y += dy } return dx ? x / density : y / density }
    const edges = { left: walk(-1, 0) + 1 / density, right: walk(1, 0), top: walk(0, -1) + 1 / density, bottom: walk(0, 1) }
    const real = { left: at.left - box.left, right: at.right - box.left, top: at.top - box.top, bottom: at.bottom - box.top }
    return Math.max(...Object.keys(edges).map((edge) => Math.abs(edges[edge] - real[edge])))
  }).map((value) => Math.round(value * 10) / 10)
})()`

/** Scrolls through the section at a steady speed, as a wheel or a finger would, and times the display frames. */
async function timeScroll(size, from, distance) {
  await scrollTo(from, 600)
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  await send('Input.synthesizeScrollGesture', { x: Math.round(size.width / 2), y: Math.round(size.height / 2), yDistance: -distance, speed: 900, gestureSourceType: size.mobile ? 'touch' : 'mouse' })
  await sleep(300)
  const gaps = await evaluate(`(() => { cancelAnimationFrame(window.__timing); const t = window.__times; return t.slice(1).map((value, index) => value - t[index]) })()`)
  const sorted = [...gaps].sort((a, b) => a - b)
  return {
    frames: gaps.length,
    averageMs: Math.round((gaps.reduce((total, gap) => total + gap, 0) / gaps.length) * 10) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
    worstMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
    over33Ms: gaps.filter((gap) => gap > 33.4).length,
  }
}

// ------------------------------------------------------------------ the run

const report = {}
try {
  for (const size of SIZES) {
    const entry = (report[size.name] = { window: `${size.width}x${size.height}` })

    // Without the effect (reduced motion): the page as it has always been.
    await open(size, { calm: true })
    await sleep(1500)
    entry.withoutEffect = { armed: (await section()).armed, effectBytes: bytesOf((url) => isFrame(url) || isEffectCode(url)), scriptMemoryMB: await heapMB(), pageHeight: await evaluate('document.documentElement.scrollHeight') }

    // With it.
    await open(size)
    const started = Date.now()
    let state = await section()
    for (let i = 0; i < 80 && !state.armed; i++) {
      await sleep(100)
      state = await section()
    }
    entry.armed = state.armed
    if (!state.armed) {
      entry.note = size.expectFallback ? 'ordinary block, as intended at this width' : 'DID NOT ARM'
      await shot(`${size.name}-fallback.jpg`)
      continue
    }
    entry.loading = { armedAfterMs: Date.now() - started, codeAndManifestKB: kb(bytesOf(isEffectCode)) }
    await scrollTo(state.top, 300) // the page publishes its counts once the section is on screen
    for (let i = 0; i < 100; i++) {
      await sleep(100)
      const counts = await evaluate('window.__cinematic')
      if (counts && counts.framesLoaded === counts.frames) break
    }
    entry.loading.allFramesKB = kb(bytesOf(isFrame))
    entry.loading.requests = downloads.filter((download) => isFrame(download.url)).length

    // Scrub the whole range once so the picture cache is as full as it gets, then look at memory.
    for (let step = 0; step <= 40; step++) await scrollTo(state.top + (state.pin * step) / 40, 40)
    await sleep(400)
    const debug = await evaluate('window.__cinematic')
    // What had to arrive before the effect could switch on: every eighth frame and the last.
    entry.loading.coarsePassKB = kb(debug.coarseBytes)
    entry.memory = {
      scriptMemoryMB: await heapMB(),
      decodedPictures: debug.decoded,
      decodedPicturesMB: Math.round(((debug.decoded * debug.decodedBytesEach) / 1048576) * 10) / 10,
      canvasMB: Math.round(((debug.canvasPixels * 4) / 1048576) * 10) / 10,
      frameFilesHeldMB: Math.round((debug.bytesLoaded / 1048576) * 100) / 100,
    }

    // Alignment: first the cases alone (held last frame, cards not yet in), then the finished handoff.
    await scrollTo(state.top + state.pin * 0.885, 900)
    entry.alignment = { handoff: debug.handoff, sameProducts: debug.sameProducts, computedOffByPx: debug.offByPx, drawnOffByPx: await evaluate(drawnEdges) }
    await shot(`${size.name}-3-cases-in-formation.jpg`)
    await scrollTo(state.top + state.pin * 0.94, 900)
    await shot(`${size.name}-4-crossfade.jpg`)
    await scrollTo(state.top + state.pin, 900)
    await shot(`${size.name}-5-real-cards.jpg`)
    await scrollTo(state.top + state.pin * 0.1, 900)
    await shot(`${size.name}-1-corridor.jpg`)
    await scrollTo(state.top + state.pin * 0.62, 900)
    await shot(`${size.name}-2-chamber.jpg`)

    // Responsiveness, down through the section and back up.
    entry.scrolling = {
      down: await timeScroll(size, state.top - 200, state.pin + 400),
      up: await timeScroll(size, state.top + state.pin + 200, -(state.pin + 400)),
    }

    // A recording: the page photographed every few pixels of scroll, down then up, played back at 30 a second.
    if (size.record) {
      const frames = join(outDir, `frames-${size.name}`)
      rmSync(frames, { recursive: true, force: true })
      mkdirSync(frames)
      const step = size.mobile ? 22 : 28
      const from = state.top - size.height * 0.6
      const to = state.top + state.pin + size.height * 0.5
      const stops = []
      for (let y = from; y <= to; y += step) stops.push(y)
      const path = [...stops, ...Array(12).fill(to), ...stops.toReversed()]
      await scrollTo(from, 600)
      for (const [index, y] of path.entries()) {
        await scrollTo(y, 70)
        writeFileSync(join(frames, `${String(index).padStart(4, '0')}.jpg`), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })).data, 'base64'))
      }
      const even = (value) => Math.round(value / 2) * 2
      const width = size.mobile ? even(size.width) : 960
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', join(frames, '%04d.jpg'), '-vf', `scale=${width}:-2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', join(outDir, `scroll-${size.name}.mp4`)])
      rmSync(frames, { recursive: true, force: true })
      entry.recording = `scroll-${size.name}.mp4 (${path.length} pictures, scrolled down then back up)`
    }
  }
} finally {
  writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
}
console.log(JSON.stringify(report, null, 2))
