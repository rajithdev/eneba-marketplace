#!/usr/bin/env node
// Tries the handoff from the rendered cases to the real cards in a real
// browser (the installed Chrome, headless, over its debugging protocol)
// and records it for review.
//
//   node cinematic/handoff_preview.mjs <site address> <output folder> [whole]
//
// On a desktop window and a phone it:
//   - reads what the page reports at points through the handoff: which
//     kind it is, how far each case is from its card's cover, whether the
//     block shows and can be clicked
//   - measures how much each cover's picture changes between the cases
//     alone and the finished cards (0 would be no change at all)
//   - checks that the same scroll position gives the same picture whether
//     it was reached scrolling down or up
//   - times display frames while a wheel or finger scrolls through the
//     handoff forwards, backwards, very slowly and in a fast flick
//   - saves stills, and four recordings: forwards, very slowly through the
//     handoff, backwards, and the handoff on its own (the page
//     photographed at each small step of scroll)

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SIZES = [
  { name: 'desktop-1440', width: 1440, height: 900, scale: 1, mobile: false },
  { name: 'phone-375', width: 375, height: 812, scale: 2, mobile: true },
]

// ------------------------------------------------------------------ Chrome

const profile = mkdtempSync(join(tmpdir(), 'handoff-'))
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
const problems = [] // errors the page logged
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject } = waiting.get(message.id)
    waiting.delete(message.id)
    message.error ? reject(new Error(message.error.message)) : resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
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

const capture = async (format = 'jpeg') => Buffer.from((await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 88 })).data, 'base64')
const scrollTo = async (y, settle = 450) => {
  await evaluate(`window.scrollTo(0, ${Math.round(y)})`)
  await sleep(settle)
}
const until = async (expression, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression).catch(() => false)) return true
    await sleep(50)
  }
  return false
}

/** What the page shows of the handoff right now. */
const reading = () => evaluate(`(() => {
  const canvas = document.querySelector('main canvas'); const holder = canvas.nextElementSibling
  const debug = window.__cinematic ?? {}
  return { progress: debug.progress == null ? null : Math.round(debug.progress * 1000) / 1000, frame: debug.frame, handoff: debug.handoff,
    blockOpacity: Math.round(Number(getComputedStyle(holder).opacity) * 1000) / 1000, blockClickable: getComputedStyle(holder).pointerEvents !== 'none' }
})()`)

/** Where the first covers of the block are in a screenshot, in its pixels. */
const coverBoxes = (count, scale) => evaluate(`[...document.querySelector('main canvas').nextElementSibling.querySelectorAll('li img')].slice(0, ${count}).map((image) => { const at = image.getBoundingClientRect(); return [at.left, at.top, at.width, at.height].map((value) => Math.round(value * ${scale})) })`)

/** The pixels of one box of a PNG, as red, green, blue bytes. */
const boxPixels = (png, [x, y, w, h]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'png_pipe', '-i', '-', '-vf', `crop=${w - 4}:${h - 4}:${x + 2}:${y + 2}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 1 << 28 })

/** Times display frames while a wheel or a finger scrolls `distance` pixels from `from` at `speed` pixels a second. */
async function timeScroll(size, from, distance, speed) {
  await scrollTo(from, 600)
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  await send('Input.synthesizeScrollGesture', { x: Math.round(size.width / 2), y: Math.round(size.height / 2), yDistance: -distance, speed, gestureSourceType: size.mobile ? 'touch' : 'mouse' })
  await sleep(300)
  const gaps = await evaluate(`(() => { cancelAnimationFrame(window.__timing); const t = window.__times; return t.slice(1).map((value, index) => value - t[index]) })()`)
  const sorted = [...gaps].sort((a, b) => a - b)
  return { frames: gaps.length, averageMs: Math.round((gaps.reduce((total, gap) => total + gap, 0) / gaps.length) * 10) / 10, worstMs: Math.round(sorted[sorted.length - 1] * 10) / 10, over33Ms: gaps.filter((gap) => gap > 33.4).length }
}

// ------------------------------------------------------------------ the run

const report = {}
try {
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
    await send('Page.navigate', { url: `${base}/?cinematic-debug` })
    await until(`document.querySelectorAll('main section').length >= 3`)
    const armed = await until(`document.querySelector('main canvas')?.dataset.armed === 'true'`)
    const place = await evaluate(`(() => { const runway = document.querySelector('main canvas').parentElement.parentElement; return { top: runway.getBoundingClientRect().top + scrollY, pin: runway.lastElementChild.getBoundingClientRect().height } })()`)
    const at = (progress) => place.top + place.pin * progress
    await scrollTo(at(0.5), 600)
    // Recordings: the page photographed at each small step of scroll, played back at 30 a second.
    const record = async (name, from, to, step) => {
      const frames = join(outDir, `frames-${size.name}-${name}`)
      rmSync(frames, { recursive: true, force: true })
      mkdirSync(frames)
      const count = Math.round(Math.abs(to - from) / step)
      const stops = Array.from({ length: count + 1 }, (_, index) => from + ((to - from) * index) / count)
      await scrollTo(at(stops[0]), 700)
      for (const [index, progress] of [...stops, ...Array(20).fill(to)].entries()) {
        await scrollTo(at(progress), 170)
        writeFileSync(join(frames, `${String(index).padStart(4, '0')}.jpg`), await capture())
      }
      const width = size.mobile ? size.width * 2 : size.width
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', join(frames, '%04d.jpg'), '-vf', `scale=${width}:-2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(outDir, `${size.name}-${name}.mp4`)])
      rmSync(frames, { recursive: true, force: true })
    }
    // With "whole" as a third argument: only one recording, of the whole section from before it starts.
    if (process.argv[4] === 'whole') {
      await until(`(window.scrollBy(0, window.__nudge = -(window.__nudge ?? 1)), window.__cinematic && window.__cinematic.framesLoaded === window.__cinematic.frames)`, 600)
      await record('whole', -0.06, 1.03, 0.005)
      continue
    }
    // Every frame in before anything is judged or recorded.
    // (The page only publishes its counts when it draws, so it is nudged by a pixel each time.)
    const loaded = await until(`(window.scrollBy(0, window.__nudge = -(window.__nudge ?? 1)), window.__cinematic && window.__cinematic.framesLoaded === window.__cinematic.frames)`, 1200)
    const debug = await evaluate(`window.__cinematic`)
    const entry = (report[size.name] = { window: `${size.width}x${size.height}`, armed, allFramesLoaded: loaded, version: debug.version, layout: debug.layout, frames: debug.frames, sameProducts: debug.sameProducts, pinPx: Math.round(place.pin) })

    // What the page reports through the handoff, going down.
    entry.offByPx = debug.offByPx
    entry.goingDown = []
    for (const progress of [0.8, 0.86, 0.9, 0.92, 0.94, 0.96, 0.98, 1]) {
      await scrollTo(at(progress), 700)
      entry.goingDown.push(await reading())
    }
    await scrollTo(at(1) + size.height, 700) // past the section: the block as an ordinary part of the page
    entry.afterTheSection = await reading()

    // How much each cover's picture changes from the cases alone to the
    // finished cards: the average difference per colour value, of 255.
    await scrollTo(at(0.885), 900)
    const before = await capture('png')
    const boxes = await coverBoxes(debug.offByPx.length, size.scale)
    await scrollTo(at(1), 900)
    const after = await capture('png')
    entry.coverChange = boxes.map((box) => {
      const [a, b] = [boxPixels(before, box), boxPixels(after, box)]
      let total = 0
      for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
      return Math.round((total / a.length) * 10) / 10
    })

    // The same place reached from above and from below must be the same picture.
    const same = []
    for (const progress of [0.78, 0.92, 0.95]) {
      await scrollTo(at(0.6), 500)
      await scrollTo(at(progress), 900)
      const down = await capture('png')
      await scrollTo(at(1), 500)
      await scrollTo(at(progress), 900)
      const up = await capture('png')
      same.push({ progress, identical: down.equals(up) })
    }
    entry.samePictureBothWays = same

    // Stills.
    for (const [name, progress] of [['1-cases-arriving', 0.8], ['2-cases-settled', 0.87], ['3-details-a-quarter-in', 0.925], ['4-details-half-in', 0.94], ['5-details-three-quarters-in', 0.955], ['6-real-cards', 1]]) {
      await scrollTo(at(progress), 900)
      writeFileSync(join(outDir, `${size.name}-${name}.jpg`), await capture())
    }

    // Display frames while scrolling through the handoff with a wheel or a finger.
    const stretch = place.pin * 0.3
    entry.scrolling = {
      forward: await timeScroll(size, at(0.72), stretch, 900),
      reverse: await timeScroll(size, at(1.02), -stretch, 900),
      verySlow: await timeScroll(size, at(0.85), place.pin * 0.16, 60),
      fastFlick: await timeScroll(size, at(0.6), place.pin * 0.5, 6000),
    }

    // The finished row, and the same with the pointer over the second card.
    await scrollTo(at(1), 900)
    entry.overflowPx = await evaluate(`document.documentElement.scrollWidth - innerWidth`)
    entry.cards = await evaluate(`[...document.querySelector('main canvas').nextElementSibling.querySelectorAll('li')].map((item) => { const at = item.getBoundingClientRect(); const image = item.querySelector('img').getBoundingClientRect(); return { width: Math.round(at.width * 10) / 10, height: Math.round(at.height * 10) / 10, cover: [Math.round(image.width * 100) / 100, Math.round(image.height * 100) / 100], button: item.querySelector('button')?.textContent.trim() } })`)
    writeFileSync(join(outDir, `${size.name}-top-deals.png`), await capture('png'))
    if (!size.mobile) {
      const second = await evaluate(`(() => { const at = document.querySelector('main canvas').nextElementSibling.querySelectorAll('li')[1].getBoundingClientRect(); return [at.left + at.width / 2, at.top + at.height / 2] })()`)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: second[0], y: second[1] })
      await sleep(500)
      writeFileSync(join(outDir, `${size.name}-top-deals-hover.png`), await capture('png'))
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    }

    await record('forward', 0.5, 1.03, 0.0035)
    await record('very-slow', 0.84, 1.0, 0.0005)
    await record('reverse', 1.03, 0.5, 0.0035)
    await record('handoff', 0.68, 1.0, 0.002)
  }
  // With reduced motion: no pinned stage, the row as an ordinary part of the page.
  report.reducedMotion = {}
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
    await send('Page.navigate', { url: `${base}/?cinematic-debug` })
    await until(`document.querySelectorAll('main section').length >= 3`)
    await sleep(1500)
    const row = await evaluate(`(() => { const canvas = document.querySelector('main canvas'); const holder = canvas.nextElementSibling; const at = holder.getBoundingClientRect()
      const lift = (() => { const card = holder.querySelector('article'); return getComputedStyle(card).transitionDuration })()
      return { stageReserved: !canvas.hidden, pinnedStretch: canvas.parentElement.parentElement.children.length > 1, drawing: canvas.dataset.armed === 'true', blockOpacity: getComputedStyle(holder).opacity, overflowPx: document.documentElement.scrollWidth - innerWidth,
        transitions: lift, box: [at.left, at.top + scrollY, at.width, at.height] } })()`)
    report.reducedMotion[size.name] = { stageReserved: row.stageReserved, pinnedStretch: row.pinnedStretch, drawing: row.drawing, blockOpacity: row.blockOpacity, overflowPx: row.overflowPx, cardTransitions: row.transitions }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, row.box[1] - 24), width: size.width, height: row.box[3] + 48, scale: 1 } })
    writeFileSync(join(outDir, `${size.name}-top-deals-reduced-motion.png`), Buffer.from(shot.data, 'base64'))
  }
  await send('Emulation.setEmulatedMedia', { features: [] })
  report.pageErrors = problems
} finally {
  writeFileSync(join(outDir, 'handoff-report.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
}
console.log(JSON.stringify(report, null, 2))
