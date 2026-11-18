#!/usr/bin/env node
// Tries the showroom ending in a real browser (the installed Chrome,
// headless, over its debugging protocol) and records it for review.
//
//   node cinematic/showroom_preview.mjs <site address> <output folder>
//
// On desktop windows it:
//   - reads what the page reports as the camera arrives: that the last
//     frame stays, when the panels can be pressed
//   - points at each panel and checks its details come up, stay inside
//     the window and show what the API sent
//   - reaches a panel with the keyboard, pins one open by pressing it and
//     closes it with Escape
//   - adds one product to the cart and buys another, through the buttons
//   - checks the same scroll position gives the same picture both ways,
//     and times display frames while scrolling
//   - saves stills and recordings: the whole section, backwards, very
//     slowly into the showroom, and the pointer passing over the panels
// then checks that a phone, and reduced motion, get the ordinary block.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DESKTOPS = [
  { name: 'desktop-1440', width: 1440, height: 900, scale: 1, mobile: false },
  { name: 'desktop-1920', width: 1920, height: 1080, scale: 1, mobile: false },
  { name: 'desktop-1024', width: 1024, height: 768, scale: 1, mobile: false },
]
const PHONE = { name: 'phone-375', width: 375, height: 812, scale: 2, mobile: true }

// ------------------------------------------------------------------ Chrome

const profile = mkdtempSync(join(tmpdir(), 'showroom-'))
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


const mouse = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(450) }
const click = async (x, y) => {
  await mouse(x, y)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(500)
}
const save = async (file) => writeFileSync(join(outDir, file), await capture('png'))

/** Each panel as the page has it: where it is, whether its details show and fit the window, and what they say. */
const panels = () => evaluate(`[...document.querySelectorAll('[data-panel]')].map((item) => {
  const box = item.getBoundingClientRect(); const details = item.lastElementChild; const at = details.getBoundingClientRect(); const style = getComputedStyle(details)
  const within = (rect) => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
  const buttons = [...details.querySelectorAll('button')].map((button) => { const r = button.getBoundingClientRect(); return { label: button.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  return { name: item.querySelector('button').getAttribute('aria-label'), centre: [box.left + box.width / 2, box.top + box.height / 2], onScreen: Math.round(100 * Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0)) / box.width),
    expanded: item.querySelector('button').getAttribute('aria-expanded'), detailsShown: style.visibility === 'visible' && Number(style.opacity) > 0.99, detailsInWindow: within(at), text: details.innerText.replace(/\s+/g, ' '), buttons }
})`)
const reading = () => evaluate(`(() => { const d = window.__cinematic ?? {}; const box = document.querySelector('[data-panel]')?.closest('section')?.parentElement
  return { progress: d.progress == null ? null : Math.round(d.progress * 1000) / 1000, frame: d.frame, handoff: d.handoff, showroomOpacity: box ? Math.round(Number(getComputedStyle(box).opacity) * 1000) / 1000 : null,
    pressable: box ? getComputedStyle(box).getPropertyValue('--panel-pointer').trim() : null, blockHidden: getComputedStyle(document.querySelector('main canvas').nextElementSibling).visibility === 'hidden' } })()`)

async function timeScroll(size, from, distance, speed) {
  await scrollTo(from, 600)
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  await send('Input.synthesizeScrollGesture', { x: Math.round(size.width / 2), y: Math.round(size.height / 2), yDistance: -distance, speed, gestureSourceType: 'mouse' })
  await sleep(300)
  const gaps = await evaluate(`(() => { cancelAnimationFrame(window.__timing); const t = window.__times; return t.slice(1).map((value, index) => value - t[index]) })()`)
  return { frames: gaps.length, averageMs: Math.round((gaps.reduce((total, gap) => total + gap, 0) / gaps.length) * 10) / 10, worstMs: Math.round(Math.max(...gaps) * 10) / 10, over33Ms: gaps.filter((gap) => gap > 33.4).length }
}

const open = async (size, calm = false) => {
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: calm ? 'reduce' : 'no-preference' }] })
  await send('Page.navigate', { url: `${base}/?cinematic-debug` })
  await until(`document.querySelectorAll('main section').length >= 3 && !!document.querySelector('main canvas')`, 1500)
}

const report = {}
try {
  for (const size of DESKTOPS) {
    await open(size)
    const armed = await until(`document.querySelector('main canvas')?.dataset.armed === 'true'`)
    const place = await evaluate(`(() => { const runway = document.querySelector('main canvas').parentElement.parentElement; return { top: runway.getBoundingClientRect().top + scrollY, pin: runway.lastElementChild.getBoundingClientRect().height } })()`)
    const at = (progress) => place.top + place.pin * progress
    await scrollTo(at(0.5), 600)
    await until(`(window.scrollBy(0, window.__nudge = -(window.__nudge ?? 1)), window.__cinematic && window.__cinematic.framesLoaded === window.__cinematic.frames)`, 600)
    const entry = (report[size.name] = { window: `${size.width}x${size.height}`, armed })

    entry.arriving = []
    for (const progress of [0.8, 0.86, 0.9, 0.93, 1]) {
      await scrollTo(at(progress), 700)
      entry.arriving.push(await reading())
    }

    // Pointing at each panel in turn.
    await scrollTo(at(1), 900)
    await evaluate(`localStorage.removeItem('keymarket.cart.v1')`)
    await save(`${size.name}-showroom.png`)
    entry.hover = []
    for (const [index, panel] of (await panels()).entries()) {
      await mouse(...panel.centre)
      const now = (await panels())[index]
      entry.hover.push({ name: now.name, panelOnScreenPercent: now.onScreen, detailsShown: now.detailsShown, detailsInWindow: now.detailsInWindow, text: now.text, othersShown: (await panels()).filter((other, i) => i !== index && other.detailsShown).length })
      await save(`${size.name}-hover-${index + 1}.png`)
    }
    await mouse(size.width / 2, 40)
    entry.nothingShownAway = (await panels()).every((panel) => !panel.detailsShown)
    if (size.name !== 'desktop-1440') continue

    // The keyboard: reaching a panel shows its details; pressing pins them; Escape lets go.
    await evaluate(`document.querySelectorAll('[data-panel] > button')[2].focus()`)
    await sleep(450)
    const focused = (await panels())[2]
    await save(`${size.name}-keyboard-focus.png`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(300)
    const pinned = (await panels())[2].expanded
    await evaluate(`document.activeElement.blur()`)
    await sleep(400)
    const stays = (await panels())[2].detailsShown
    await evaluate(`document.querySelectorAll('[data-panel] > button')[2].focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await evaluate(`document.activeElement.blur()`)
    await sleep(400)
    entry.keyboard = { focusShowsDetails: focused.detailsShown, enterPins: pinned === 'true', staysOpenAfterFocusLeaves: stays, escapeCloses: !(await panels())[2].detailsShown }

    // Add to cart on the second panel, then Buy Now on the fifth.
    let list = await panels()
    await mouse(...list[1].centre)
    list = await panels()
    await click(list[1].buttons[0].x, list[1].buttons[0].y)
    await sleep(1500)
    const afterAdd = { button: (await panels())[1].buttons[0].label, cart: await evaluate(`JSON.parse(localStorage.getItem('keymarket.cart.v1') || '[]').map((item) => [item.productName, item.sellerName, item.unitPriceCents, item.quantity])`), stillOn: await evaluate('location.pathname') }
    await save(`${size.name}-added-to-cart.png`)
    await mouse(...list[4].centre)
    list = await panels()
    await click(list[4].buttons[1].x, list[4].buttons[1].y)
    await until(`location.pathname === '/cart'`, 100)
    await sleep(800)
    entry.buying = { addToCart: afterAdd, buyNow: { landedOn: await evaluate('location.pathname'), cart: await evaluate(`JSON.parse(localStorage.getItem('keymarket.cart.v1') || '[]').map((item) => [item.productName, item.sellerName, item.unitPriceCents, item.quantity])`) } }
    await save(`${size.name}-buy-now-cart.png`)
    await evaluate(`localStorage.removeItem('keymarket.cart.v1')`)

    // Back on the homepage: the same place from above and from below, timings, recordings.
    await open(size)
    await until(`document.querySelector('main canvas')?.dataset.armed === 'true'`)
    await scrollTo(at(0.5), 600)
    await until(`(window.scrollBy(0, window.__nudge = -(window.__nudge ?? 1)), window.__cinematic && window.__cinematic.framesLoaded === window.__cinematic.frames)`, 600)
    entry.samePictureBothWays = []
    for (const progress of [0.6, 0.88, 0.95]) {
      await scrollTo(at(0.4), 500); await scrollTo(at(progress), 900)
      const down = await capture('png')
      await scrollTo(at(1), 500); await scrollTo(at(progress), 900)
      entry.samePictureBothWays.push({ progress, identical: down.equals(await capture('png')) })
    }
    entry.scrolling = {
      forward: await timeScroll(size, at(0.1), place.pin * 0.9, 900),
      reverse: await timeScroll(size, at(1.02), -place.pin * 0.9, 900),
      verySlow: await timeScroll(size, at(0.82), place.pin * 0.16, 60),
      fastFlick: await timeScroll(size, at(0.2), place.pin * 0.8, 6000),
    }

    const record = async (name, stops, act) => {
      const frames = join(outDir, `frames-${name}`)
      rmSync(frames, { recursive: true, force: true }); mkdirSync(frames)
      for (const [index, stop] of stops.entries()) {
        await act(stop)
        writeFileSync(join(frames, `${String(index).padStart(4, '0')}.jpg`), await capture())
      }
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', join(frames, '%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(outDir, `${size.name}-${name}.mp4`)])
      rmSync(frames, { recursive: true, force: true })
    }
    const span = (from, to, step) => { const count = Math.round(Math.abs(to - from) / step); return [...Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count), ...Array(20).fill(to)] }
    await scrollTo(at(-0.06), 700)
    await record('whole', span(-0.06, 1.03, 0.005), (progress) => scrollTo(at(progress), 170))
    await record('reverse', span(1.03, 0.4, 0.004), (progress) => scrollTo(at(progress), 170))
    await scrollTo(at(0.8), 700)
    await record('very-slow-arrival', span(0.8, 1.0, 0.0006), (progress) => scrollTo(at(progress), 170))
    // The pointer passing over the row of panels, left to right and back.
    await scrollTo(at(1), 900)
    const row = await panels()
    const y = row[2].centre[1]
    const sweep = Array.from({ length: 90 }, (_, i) => 30 + ((size.width - 60) * i) / 89)
    await record('pointer-across', [...sweep, ...sweep.toReversed()], (x) => mouse(x, y))
  }

  // A phone, and reduced motion on a desktop: the ordinary block, nothing reserved.
  for (const [name, size, calm] of [['phone', PHONE, false], ['reducedMotion', DESKTOPS[0], true]]) {
    await open(size, calm)
    await sleep(1500)
    const row = await evaluate(`(() => { const canvas = document.querySelector('main canvas'); const holder = canvas.nextElementSibling; const at = holder.getBoundingClientRect()
      return { stageReserved: !canvas.hidden, panels: document.querySelectorAll('[data-panel]').length, cards: holder.querySelectorAll('li').length, blockOpacity: getComputedStyle(holder).opacity, overflowPx: document.documentElement.scrollWidth - innerWidth, box: [at.top + scrollY, at.height] } })()`)
    report[name] = { stageReserved: row.stageReserved, panels: row.panels, cards: row.cards, blockOpacity: row.blockOpacity, overflowPx: row.overflowPx }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, row.box[0] - 24), width: size.width, height: row.box[1] + 48, scale: 1 } })
    writeFileSync(join(outDir, `${name === 'phone' ? 'phone-375' : 'desktop-1440-reduced-motion'}-ordinary-block.png`), Buffer.from(shot.data, 'base64'))
  }
  report.pageErrors = problems
} finally {
  writeFileSync(join(outDir, 'showroom-report.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
}
console.log(JSON.stringify(report, null, 2))
