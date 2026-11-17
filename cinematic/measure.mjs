#!/usr/bin/env node
// Measures the scroll-controlled section in a real browser (the installed
// Chrome, driven over its debugging protocol) and records it.
//
//   node cinematic/measure.mjs <site address> <output folder>
//
// For each window size it reports:
//   - layout: whether anything on the page moves when the frames arrive
//     (they are slowed down on purpose, so they arrive after the page is
//     drawn): page length and the next block's position before and after,
//     and the layout shifts the browser itself recorded
//   - loading: what the effect downloads before it switches on, and in all
//   - memory: what Chrome's processes really occupy (from the operating
//     system), with and without the effect, at rest and while scrubbing
//   - alignment: how far each case in the last frame is from its card's
//     cover, as the page computes it and as measured from drawn pixels
//   - responsiveness: time between display frames while scrolling through
//     the section at reading speed and in a fast flick, down and back up
// then checks every case in which the ordinary block must be shown
// instead, and saves screenshots and a recording for two sizes.
//
// Chrome runs headless here, so frame timings show whether the page keeps
// up, not what a particular phone will do.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir, ...flags] = process.argv.slice(2)
const only = flags.find((flag) => flag.startsWith('--only='))?.slice(7).split(',')
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

const profile = mkdtempSync(join(tmpdir(), 'measure-'))
const port = 9300 + Math.floor(Math.random() * 400)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' })
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
// Every page keeps the browser's own record of layout shifts from its first moment.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__shifts = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__shifts.push({ value: entry.value, time: entry.startTime }) }).observe({ type: 'layout-shift', buffered: true })` })

/**
 * What Chrome really occupies, in megabytes, as the operating system
 * counts it (resident memory of this browser's processes). Decoded
 * pictures and the canvas live in the page's process and the graphics
 * process, which the page's own script memory does not include.
 */
function processMemory() {
  const rows = execFileSync('ps', ['-axo', 'rss=,command=']).toString().split('\n').filter((row) => row.includes(profile))
  const megabytes = (filter) => Math.round(rows.filter(filter).reduce((total, row) => total + Number(row.trim().split(/\s+/)[0]), 0) / 102.4) / 10
  return { page: megabytes((row) => row.includes('--type=renderer')), graphics: megabytes((row) => row.includes('--type=gpu-process')) }
}
const settledMemory = async () => {
  await send('HeapProfiler.collectGarbage')
  await sleep(900)
  return processMemory()
}
const bytesOf = (filter) => downloads.filter((download) => filter(download.url)).reduce((total, download) => total + download.bytes, 0)
const isFrame = (url) => url.includes('/cinematic/') && url.endsWith('.webp')
const isEffect = (url) => isFrame(url) || /\/assets\/(stage|sequence|fit)[^/]*\.js$/.test(url) || url.endsWith('manifest.json')
const kb = (bytes) => Math.round(bytes / 102.4) / 10
const shot = async (file) => writeFileSync(join(outDir, file), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })).data, 'base64'))

const SLOW = { offline: false, latency: 350, downloadThroughput: 190000, uploadThroughput: 90000 } // about 1.5 megabits a second
const FULL_SPEED = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }

/** Opens the homepage and waits until its blocks are drawn. `tamper` is script run before the page's own, to pretend something about the device. */
async function open(size, { calm = false, slow = false, tamper = '', block = [] } = {}) {
  downloads = []
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: calm ? 'reduce' : 'no-preference' }] })
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Network.setBlockedURLs', { urls: block })
  await send('Network.emulateNetworkConditions', slow ? SLOW : FULL_SPEED)
  const added = tamper ? await send('Page.addScriptToEvaluateOnNewDocument', { source: tamper }) : null
  await send('Page.navigate', { url: `${base}/?cinematic-debug` })
  for (let i = 0; i < 300; i++) {
    await sleep(50)
    if (await evaluate(`document.querySelectorAll('main section').length >= 3`).catch(() => false)) break
  }
  if (added) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier })
}

/** The section as the page has it: where it starts, how long it pins, whether space is reserved and whether frames are drawing. */
const section = () => evaluate(`(() => {
  const canvas = document.querySelector('main canvas'); const stage = canvas.parentElement; const runway = stage.parentElement
  const spacer = runway.lastElementChild === stage ? null : runway.lastElementChild
  const next = runway.nextElementSibling
  return { top: runway.getBoundingClientRect().top + scrollY, pin: spacer ? spacer.getBoundingClientRect().height : 0, reserved: !canvas.hidden, armed: canvas.dataset.armed === 'true',
    pageHeight: document.documentElement.scrollHeight, blockTop: Math.round(canvas.nextElementSibling.getBoundingClientRect().top + scrollY), nextBlockTop: next ? Math.round(next.getBoundingClientRect().top + scrollY) : null,
    now: performance.now(), blockShown: getComputedStyle(canvas.nextElementSibling).opacity }
})()`)
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
    const at = image.getBoundingClientRect(); const cx = (at.left - box.left + at.width / 2) * density
    const cy = (at.top - box.top + at.height * 0.25) * density // a quarter of the way down: covers are dark at the foot, like the band
    const walk = (dx, dy) => { let x = cx, y = cy; while (x > 0 && y > 0 && x < canvas.width && y < canvas.height && !isBand(x, y)) { x += dx; y += dy } return dx ? x / density : y / density }
    const edges = { left: walk(-1, 0) + 1 / density, right: walk(1, 0), top: walk(0, -1) + 1 / density }
    const real = { left: at.left - box.left, right: at.right - box.left, top: at.top - box.top }
    return Math.max(...Object.keys(edges).map((edge) => Math.abs(edges[edge] - real[edge])))
  }).map((value) => Math.round(value * 10) / 10)
})()`

/** Scrolls through the section at a steady speed, as a wheel or a finger would, and times the display frames. */
async function timeScroll(size, from, distance, speed) {
  await scrollTo(from, 600)
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  await send('Input.synthesizeScrollGesture', { x: Math.round(size.width / 2), y: Math.round(size.height / 2), yDistance: -distance, speed, gestureSourceType: size.mobile ? 'touch' : 'mouse' })
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
  for (const size of SIZES.filter((candidate) => !only || only.includes(candidate.name))) {
    const entry = (report[size.name] = { window: `${size.width}x${size.height}` })

    // Without the effect (reduced motion): the page as it has always been.
    await open(size, { calm: true })
    await sleep(1200)
    const plain = await section()
    entry.withoutEffect = { reserved: plain.reserved, effectBytes: bytesOf(isEffect), pageHeight: plain.pageHeight, memoryMB: await settledMemory() }

    // With it, on a slowed connection so that the frames arrive after the page is drawn.
    await open(size, { slow: true })
    const drawnAt = await section()
    if (!drawnAt.reserved) {
      entry.note = size.expectFallback ? 'ordinary block, as intended at this width' : 'NO SPACE RESERVED'
      entry.sameAsWithoutEffect = drawnAt.pageHeight === plain.pageHeight
      await shot(`${size.name}-fallback.jpg`)
      continue
    }
    let state = drawnAt
    for (let i = 0; i < 300 && !state.armed; i++) {
      await sleep(100)
      state = await section()
    }
    await sleep(600)
    const after = await section()
    const shifts = await evaluate(`window.__shifts.filter((shift) => shift.time > ${drawnAt.now}).reduce((total, shift) => total + shift.value, 0)`)
    entry.layout = {
      framesArrivedAfterPageWasDrawn: !drawnAt.armed && after.armed,
      secondsBetween: Math.round((after.now - drawnAt.now) / 100) / 10,
      pageHeight: [drawnAt.pageHeight, after.pageHeight],
      blockTop: [drawnAt.blockTop, after.blockTop],
      nextBlockTop: [drawnAt.nextBlockTop, after.nextBlockTop],
      layoutShiftSinceDrawn: Math.round(shifts * 10000) / 10000,
      moved: drawnAt.pageHeight !== after.pageHeight || drawnAt.blockTop !== after.blockTop || drawnAt.nextBlockTop !== after.nextBlockTop,
    }
    if (!after.armed) {
      entry.note = 'FRAMES DID NOT ARRIVE'
      continue
    }
    await send('Network.emulateNetworkConditions', FULL_SPEED)

    await scrollTo(state.top, 300) // the page publishes its counts once the section is on screen
    for (let i = 0; i < 200; i++) {
      await sleep(100)
      const counts = await evaluate('window.__cinematic')
      if (counts && counts.framesLoaded === counts.frames) break
    }
    entry.loading = { codeAndManifestKB: kb(bytesOf((url) => isEffect(url) && !isFrame(url))), allFramesKB: kb(bytesOf(isFrame)), requests: downloads.filter((download) => isFrame(download.url)).length }
    await scrollTo(0, 300)
    const atRest = await settledMemory()

    // Scrub the whole range, down and up, watching memory as it goes.
    let peak = { page: 0, graphics: 0 }
    let mostPictures = 0
    for (const step of [...Array(61).keys(), ...Array(61).keys().map((index) => 60 - index)]) {
      await scrollTo(state.top + (state.pin * step) / 60, 45)
      const now = processMemory()
      peak = { page: Math.max(peak.page, now.page), graphics: Math.max(peak.graphics, now.graphics) }
      mostPictures = Math.max(mostPictures, (await evaluate('window.__cinematic')).decoded)
    }
    await scrollTo(state.top + state.pin * 0.5, 600)
    const debug = await evaluate('window.__cinematic')
    entry.loading.coarsePassKB = kb(debug.coarseBytes)
    const inside = await settledMemory()
    await scrollTo(0, 600)
    entry.memory = {
      budgetPictures: debug.keep,
      mostPicturesHeld: mostPictures,
      picturesHeldAfterLeaving: await evaluate('window.__cinematicPictures()'),
      eachPictureMB: Math.round((debug.decodedBytesEach / 1048576) * 100) / 100,
      canvasMB: Math.round(((debug.canvasPixels * 4) / 1048576) * 10) / 10,
      frameFilesHeldMB: Math.round((debug.bytesLoaded / 1048576) * 100) / 100,
      measuredMB: { withoutEffect: entry.withoutEffect.memoryMB, loadedAtRest: atRest, peakWhileScrubbing: peak, restingInsideSection: inside, afterLeaving: await settledMemory() },
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

    // Responsiveness: at reading speed, then a fast flick, each down and back up.
    entry.scrolling = {
      down: await timeScroll(size, state.top - 200, state.pin + 400, 900),
      up: await timeScroll(size, state.top + state.pin + 200, -(state.pin + 400), 900),
      fastDown: await timeScroll(size, state.top - 200, state.pin + 400, 6000),
      fastUp: await timeScroll(size, state.top + state.pin + 200, -(state.pin + 400), 6000),
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
      entry.recording = `scroll-${size.name}.mp4`
    }
  }

  // Every case in which the ordinary block must be shown instead, on a desktop and on a phone.
  const pretend = (property, value) => `Object.defineProperty(Navigator.prototype, '${property}', { get: () => (${value}), configurable: true })`
  const cases = [
    { name: 'reduced motion', options: { calm: true } },
    { name: 'data saving switched on', options: { tamper: pretend('connection', `{ saveData: true, effectiveType: '4g' }`) } },
    { name: 'slow (2g) connection', options: { tamper: pretend('connection', `{ saveData: false, effectiveType: '2g' }`) } },
    { name: 'device with 2 GB of memory', options: { tamper: pretend('deviceMemory', '2') } },
    { name: 'browser without picture decoding', options: { tamper: 'window.createImageBitmap = undefined' } },
    { name: 'frames cannot be fetched', options: { block: ['*/cinematic/*'] }, framesMissing: true },
  ]
  report.fallbacks = {}
  for (const size of SIZES.filter((candidate) => ['1440', 'phone-375'].includes(candidate.name) && report[candidate.name])) {
    const expected = report[size.name].withoutEffect.pageHeight
    for (const { name, options, framesMissing } of cases) {
      await open(size, options)
      await sleep(1500)
      const now = await section()
      report.fallbacks[`${name} @ ${size.name}`] = {
        spaceReserved: now.reserved, drawing: now.armed, blockShown: now.blockShown === '1', frameBytes: bytesOf(isFrame),
        pageAsWithoutEffect: now.pageHeight === expected,
        ...(framesMissing ? { pinnedStretchPx: now.pin } : {}),
      }
    }
  }
} finally {
  writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
}
console.log(JSON.stringify(report, null, 2))
