#!/usr/bin/env node
// Checks the Game Archive prototype in a real browser (the installed Chrome,
// headless, driven over its debugging protocol) and measures what it costs.
//
//   node scripts/archive/preview.mjs <site address> <output folder> [--shots-only]
//
// It reports, as <output folder>/report.json and in short on the terminal:
//   - works: on a desktop window, that scrolling moves along the shelf and
//     scrolling back returns, that a click on a case, the arrow keys and the
//     arrow buttons choose a case, that what is written under the shelf is
//     what the API answered for that product, and that "View offers" leads
//     to it; on a phone, that a swipe moves along the rail; with reduced
//     motion, that the rail is used and nothing is animated
//   - cost: what opening the page downloads, how many elements and layers it
//     holds, how much script memory it uses, and whether any code runs once
//     the shelf has come to rest
//   - timing: time between display frames while the shelf is scrolled
//     slowly, quickly, back and forth, and while it travels to a clicked
//     case; again with the processor slowed four times
// and saves screenshots of each state it visits.
//
// Chrome runs headless here, so timings show whether the page keeps up on
// this machine, not what a particular phone will do.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir, ...flags] = process.argv.slice(2)
if (!base || !outDir) {
  console.error('usage: node scripts/archive/preview.mjs <site address> <output folder> [--shots-only]')
  process.exit(2)
}
const shotsOnly = flags.includes('--shots-only')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DESKTOP = { name: 'desktop-1440', width: 1440, height: 900, scale: 1, mobile: false }
const LAPTOP = { name: 'laptop-1280', width: 1280, height: 720, scale: 1, mobile: false }
const PHONE = { name: 'phone-390', width: 390, height: 844, scale: 2, mobile: true }

// ------------------------------------------------------------------ Chrome

const profile = mkdtempSync(join(tmpdir(), 'archive-'))
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
const problems = []
const listeners = new Set()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message.result ?? { failed: message.error })
    waiting.delete(message.id)
  }
  if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
  for (const listener of listeners) listener(message)
})
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  waiting.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const until = async (expression, tries = 300) => {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression).catch(() => false)) return true
    await sleep(50)
  }
  return false
}
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
// Key presses go to the page as they would with its window in front.
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
// Counts every display frame the page asks for, so that "no code runs at rest" can be checked rather than claimed,
// and keeps the browser's own record of long tasks and of anything that moved without being asked to.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__frames = 0; { const ask = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (run) => { window.__frames++; return ask(run) } }
    window.__long = []; try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration)) }).observe({ type: 'longtask', buffered: true }) } catch {}
    window.__shifts = 0; window.__shifted = []; try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) { window.__shifts += entry.value; window.__shifted.push(Math.round(entry.value * 10000) / 10000 + ' ' + (entry.sources ?? []).map((source) => (source.node?.nodeName ?? '?') + '.' + String(source.node?.className ?? '').slice(0, 40)).join(' | ')) } }).observe({ type: 'layout-shift', buffered: true }) } catch {}`,
})

const shot = async (name) => writeFileSync(join(outDir, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))

/** Scrolls as a visitor does: a mouse wheel on a desktop, a finger on a phone. Positive distances go down the page (or along the rail). `speed` is in pixels a second. */
const gesture = async (size, distance, speed, { sideways = false, at } = {}) => {
  const params = { x: at?.x ?? Math.round(size.width / 2), y: at?.y ?? Math.round(size.height / 2), speed, gestureSourceType: size.mobile ? 'touch' : 'mouse' }
  params[sideways ? 'xDistance' : 'yDistance'] = -Math.round(distance)
  const done = send('Input.synthesizeScrollGesture', params)
  const late = sleep((Math.abs(distance) / speed) * 1000 + 20000).then(() => 'late')
  if ((await Promise.race([done, late])) === 'late') throw new Error(`a scroll gesture of ${Math.round(distance)}px was never completed by the browser`)
}
const click = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}
const key = async (name) => {
  const codes = { ArrowLeft: 37, ArrowRight: 39, End: 35, Home: 36, Enter: 13 }
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: codes[name] })
}

/** What is downloaded while `act` runs: how many requests and how many bytes came over the wire, by kind. */
async function downloads(act) {
  const kinds = {}
  const types = new Map()
  const listener = (message) => {
    if (message.method === 'Network.responseReceived') types.set(message.params.requestId, { kind: message.params.type, url: message.params.response.url })
    if (message.method === 'Network.loadingFinished') {
      const entry = types.get(message.params.requestId)
      if (!entry || entry.url.startsWith('data:')) return
      const kind = entry.url.includes('/api/') ? 'api' : entry.kind.toLowerCase()
      kinds[kind] ??= { requests: 0, bytes: 0 }
      kinds[kind].requests++
      kinds[kind].bytes += message.params.encodedDataLength
    }
  }
  // As a first visit: nothing kept from an earlier one.
  await send('Network.clearBrowserCache')
  listeners.add(listener)
  await act()
  listeners.delete(listener)
  for (const kind of Object.values(kinds)) kind.kB = Math.round(kind.bytes / 102.4) / 10
  return kinds
}

const open = async (size, path = '/archive', calm = false) => {
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: calm ? 'reduce' : 'no-preference' }] })
  // From a blank page, so the browser does not put this one back where the last was scrolled to.
  await send('Page.navigate', { url: 'about:blank' })
  await send('Page.navigate', { url: `${base}${path}` })
  await until(`!!document.querySelector('[role=listbox] [role=option]') || !!document.querySelector('main ul li a[href^="/product/"]')`, 400)
  // Every cover in view has arrived, and the shelf has come to rest.
  await until(`[...document.images].every((image) => image.complete)`, 200)
  await sleep(500)
}

/** What the page says is chosen: the option marked selected, and what is written under the shelf. */
const chosen = () => evaluate(`(() => {
  const option = document.querySelector('[role=option][aria-selected=true]')
  const details = document.querySelector('section[aria-label="Chosen game"]')
  return {
    option: option?.getAttribute('aria-label') ?? null,
    position: Number(option?.getAttribute('aria-posinset') ?? ([...document.querySelectorAll('[role=option]')].indexOf(option) + 1)),
    name: details?.querySelector('h2')?.textContent ?? null,
    details: details?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    link: details?.querySelector('a')?.getAttribute('href') ?? null,
    staged: !!document.querySelector('.ga-stage'),
  }
})()`)

/** Waits until the shelf has stopped moving: no display frame has been asked for in a while. */
const rest = async () => {
  for (let i = 0, last = -1, still = 0; i < 80 && still < 4; i++) {
    const frames = await evaluate('window.__frames')
    still = frames === last ? still + 1 : 0
    last = frames
    await sleep(60)
  }
}

/** Time between display frames while `act` runs. */
async function timed(act) {
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  await act()
  await sleep(700)
  const gaps = await evaluate(`(() => { cancelAnimationFrame(window.__timing); const t = window.__times; return t.slice(1).map((value, index) => value - t[index]) })()`)
  const sorted = [...gaps].sort((a, b) => a - b)
  const round = (value) => Math.round(value * 10) / 10
  return { frames: gaps.length, averageMs: round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length), p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]), worstMs: round(sorted.at(-1)), over20Ms: gaps.filter((gap) => gap > 20).length, over33Ms: gaps.filter((gap) => gap > 33.4).length }
}

/** A point on the screen where a drawn case can be seen and pressed (a nearer case may cover part of it), by its place on the shelf (1 is the first). */
const caseAt = (position) => evaluate(`(() => {
  const option = document.querySelector('[role=option][aria-posinset="${position}"]')
  const box = option?.querySelector('.ga-front').getBoundingClientRect()
  if (!box) return null
  const y = Math.round(box.top + box.height / 2)
  const seen = []
  for (let x = Math.ceil(box.left); x < box.right; x += 2) if (document.elementFromPoint(x, y)?.closest('[role=option]') === option) seen.push(x)
  return seen.length ? { x: seen[Math.floor(seen.length / 2)], y, middle: Math.round(box.left + box.width / 2) } : null
})()`)
const clickCase = async (position) => {
  const at = await caseAt(position)
  await click(at.x, at.y)
}

const report = { site: base, at: new Date().toISOString(), chrome: (await send('Browser.getVersion')).product }
const expect = (checks, name, ok, detail) => {
  checks[name] = ok ? 'ok' : `FAILED${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`
}

try {
  // -------------------------------------------------------------- pictures
  await open(DESKTOP)
  await shot('desktop-1440-start')
  await evaluate(`window.scrollTo({ top: document.querySelector('.ga-stage').parentElement.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.querySelector('.ga-stage')).top) + 96 * 11, behavior: 'instant' })`)
  await rest()
  await until(`[...document.images].every((image) => image.complete)`, 100)
  await shot('desktop-1440-along')
  await open(LAPTOP)
  await gesture(LAPTOP, 96 * 7 + 200, 1200)
  await rest()
  await shot('laptop-1280-along')
  await open(PHONE)
  await shot('phone-390-start')
  await gesture(PHONE, 232 * 4, 1400, { sideways: true, at: { x: 195, y: 420 } })
  await sleep(900)
  await until(`[...document.images].every((image) => image.complete)`, 100)
  await shot('phone-390-along')
  await open(DESKTOP, '/archive', true)
  await shot('desktop-1440-reduced-motion')
  await open(DESKTOP, '/archive/all')
  await shot('desktop-1440-browse-all')
  await open(PHONE, '/archive/all')
  await shot('phone-390-browse-all')

  if (!shotsOnly) {
    // What the API answers for the shelf the page opens with, to hold the page against.
    const listed = async (page) => (await (await fetch(`${base}/api/products?page=${page}`, { headers: { Accept: 'application/json' } })).json())
    const firstPage = await listed(1)
    const catalog = [...firstPage.data]
    for (let page = 2; page <= firstPage.meta.last_page; page++) catalog.push(...(await listed(page)).data)
    const money = (price) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: price.currency }).format(price.amount_cents / 100)
    /** Whether what is written under the shelf is this product as the API describes it. */
    const says = (shown, product) =>
      shown.name === product.name &&
      shown.link === `/product/${product.slug}` &&
      shown.details.toLowerCase().includes(product.platform.name.toLowerCase()) &&
      shown.details.toLowerCase().includes(product.region.name.toLowerCase()) &&
      shown.details.includes(product.price ? money(product.price) : 'Sold out')
    /** Where the page has to be scrolled to for the stage to be held in place with the first case chosen. */
    const pinStart = () => evaluate(`(() => { const stage = document.querySelector('.ga-stage'); return Math.round(stage.parentElement.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(stage).top)) })()`)
    const STEP = 96

    // ------------------------------------------------------------ desktop
    const desktop = { works: {} }
    report.desktop = desktop
    desktop.opening = await downloads(() => open(DESKTOP))
    desktop.layoutShiftWhileOpening = { total: Math.round((await evaluate('window.__shifts')) * 10000) / 10000, moved: await evaluate('window.__shifted') }
    const start = await pinStart()
    let now = await chosen()
    expect(desktop.works, 'the stage is used', now.staged)
    expect(desktop.works, 'the first product of the API is chosen, with its name, platform, region, lowest price and link', now.position === 1 && says(now, catalog[0]), now)
    expect(desktop.works, 'all of the stage is in view before any scrolling', await evaluate(`document.querySelector('.ga-stage').getBoundingClientRect().bottom <= innerHeight + 1`))
    expect(desktop.works, 'nothing is wider than the window', await evaluate('document.documentElement.scrollWidth <= innerWidth'))

    await gesture(DESKTOP, start + STEP * 6, 900)
    await rest()
    now = await chosen()
    expect(desktop.works, 'scrolling down moves along the shelf, one case per 96px', now.position === 7 && says(now, catalog[6]), now)
    // Walking the shelf is scrolling the page: the site's own header must not be scrolled away by it.
    const above = await evaluate(`(() => { const search = document.querySelector('header input').getBoundingClientRect(); const header = document.querySelector('header').getBoundingClientRect(); const stage = document.querySelector('.ga-stage').getBoundingClientRect(); return { searchTop: Math.round(search.top), searchBottom: Math.round(search.bottom), headerBottom: Math.round(header.bottom), stageTop: Math.round(stage.top), stageBottom: Math.round(stage.bottom), window: innerHeight } })()`)
    expect(desktop.works, 'the search stays in view along the shelf, with the stage right under the header and all in view', above.searchTop >= 0 && above.searchBottom <= above.headerBottom && Math.abs(above.stageTop - above.headerBottom) <= 1 && above.stageBottom <= above.window + 1, above)
    await shot('desktop-1440-seventh')
    await gesture(DESKTOP, -STEP * 4, 900)
    await rest()
    now = await chosen()
    expect(desktop.works, 'scrolling back up moves back along it', now.position === 3 && says(now, catalog[2]), now)

    await clickCase(6)
    await rest()
    now = await chosen()
    expect(desktop.works, 'a click on a case further along chooses it and brings it to the middle', now.position === 6 && says(now, catalog[5]) && (await evaluate('Math.round(scrollY)')) === start + STEP * 5, { ...now, scrolled: await evaluate('Math.round(scrollY)'), wanted: start + STEP * 5 })
    const middle = await caseAt(6)
    expect(desktop.works, 'the chosen case stands in the middle of the window', Math.abs(middle.middle - DESKTOP.width / 2) < DESKTOP.width * 0.03, middle)

    await evaluate(`document.querySelector('[aria-label="Games in the archive"]').focus()`)
    await key('ArrowRight')
    await key('ArrowRight')
    await rest()
    now = await chosen()
    expect(desktop.works, 'the right arrow key moves on a case at a time', now.position === 8 && says(now, catalog[7]), now)
    await key('ArrowLeft')
    await rest()
    now = await chosen()
    expect(desktop.works, 'the left arrow key moves back', now.position === 7 && says(now, catalog[6]), now)
    await evaluate(`document.querySelector('button[aria-label="Next game"]').click()`)
    await rest()
    now = await chosen()
    expect(desktop.works, 'the Next button moves on', now.position === 8, now)

    // To the far end: the rest of the catalog is fetched on the way, a page at a time.
    for (let i = 0; i < 12 && (await chosen()).position < catalog.length; i++) {
      await key('End')
      await rest()
      await sleep(400)
    }
    now = await chosen()
    expect(desktop.works, 'the End key reaches the last product of the catalog, fetched page by page', now.position === catalog.length && says(now, catalog.at(-1)), now)
    await until(`[...document.images].every((image) => image.complete)`, 100)
    await shot('desktop-1440-end')
    expect(desktop.works, 'a sold-out product says so', catalog.some((product) => !product.in_stock) ? true : 'none in the catalog')

    await key('Home')
    await rest()
    await gesture(DESKTOP, STEP * 20 - ((await evaluate('Math.round(scrollY)')) - start), 2500)
    await rest()
    const before = await chosen()
    await key('Enter')
    await until(`location.pathname.startsWith('/product/')`, 100)
    expect(desktop.works, 'Enter opens the chosen product', (await evaluate('location.pathname')) === before.link, { at: await evaluate('location.pathname'), wanted: before.link })
    await evaluate('history.back()')
    await until(`!!document.querySelector('.ga-stage')`, 100)
    await rest()
    await sleep(300)
    now = await chosen()
    expect(desktop.works, 'going back returns to the same case', now.position === before.position && now.name === before.name, { now: now.position, before: before.position })
    // Walking the shelf changes what is written under it; nothing else may move because of that.
    await evaluate('window.__shifts = 0; window.__shifted = []')
    for (let i = 0; i < 14; i++) {
      await evaluate(`document.querySelector('button[aria-label="Next game"]').click()`)
      await sleep(120)
    }
    await rest()
    desktop.layoutShiftWhileWalking = { total: Math.round((await evaluate('window.__shifts')) * 10000) / 10000, moved: await evaluate('window.__shifted') }

    // What it holds, and whether anything runs at rest.
    await rest()
    await send('LayerTree.enable')
    const layers = await new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== 'LayerTree.layerTreeDidChange' || !message.params.layers) return
        listeners.delete(listener)
        resolve(message.params.layers)
      }
      listeners.add(listener)
      void evaluate('window.scrollBy(0, 1)')
      setTimeout(() => resolve([]), 4000)
    })
    await send('LayerTree.disable')
    await rest()
    const framesBefore = await evaluate('window.__frames')
    await sleep(2000)
    desktop.holds = {
      elementsInThePage: await evaluate(`document.querySelectorAll('*').length`),
      elementsInTheStage: await evaluate(`document.querySelectorAll('.ga-stage *').length`),
      casesDrawn: await evaluate(`document.querySelectorAll('.ga-slot[role=option]').length`),
      compositorLayers: layers.filter((layer) => layer.drawsContent).length,
      // The pictures the browser keeps of the cases' sides, at one device pixel per pixel. (The page itself is one more, far larger and kept in tiles.)
      caseLayersMB: Math.round((layers.filter((layer) => layer.drawsContent && layer.width <= 900 && layer.height <= 900).reduce((total, layer) => total + layer.width * layer.height * 4, 0) / 1048576) * 10) / 10,
      scriptHeapMB: Math.round(((await send('Runtime.getHeapUsage')).usedSize / 1048576) * 10) / 10,
      framesAskedForInTwoSecondsAtRest: (await evaluate('window.__frames')) - framesBefore,
      longTasksMs: await evaluate('window.__long'),
    }

    // Timing. Each run starts with the stage held in place, a few cases in.
    const runs = {
      'slow, 150px a second': [[STEP * 10, 150]],
      'steady, 800px a second': [[STEP * 30, 800]],
      'fast flick and back': [[STEP * 45, 6000], [-STEP * 45, 6000]],
      'changes of direction': [[1500, 4000], [-900, 4000], [2400, 6000], [-1800, 5000], [700, 3000]],
    }
    const scrolls = async (moves) => {
      await evaluate(`window.scrollTo({ top: ${start + STEP * 3}, behavior: 'instant' })`)
      await rest()
      return timed(async () => {
        for (const [distance, speed] of moves) await gesture(DESKTOP, distance, speed)
      })
    }
    desktop.timing = {}
    for (const [name, moves] of Object.entries(runs)) desktop.timing[name] = await scrolls(moves)
    await evaluate(`window.scrollTo({ top: ${start + STEP * 3}, behavior: 'instant' })`)
    await rest()
    desktop.timing['travelling to a clicked case, four along'] = await timed(async () => {
      await clickCase(8)
      await rest()
    })
    await evaluate(`document.querySelector('[aria-label="Games in the archive"]').focus()`)
    desktop.timing['twelve presses of the right arrow key'] = await timed(async () => {
      for (let i = 0; i < 12; i++) {
        await key('ArrowRight')
        await sleep(70)
      }
      await rest()
    })
    await send('Emulation.setCPUThrottlingRate', { rate: 4 })
    desktop.timingSlowedFourTimes = {}
    for (const name of ['steady, 800px a second', 'fast flick and back', 'changes of direction']) desktop.timingSlowedFourTimes[name] = await scrolls(runs[name])
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })

    // For comparison: what the store page as it is today downloads when it is opened.
    report.storePageForComparison = { opening: await downloads(() => open(DESKTOP, '/store')), elementsInThePage: await evaluate(`document.querySelectorAll('*').length`) }

    // ------------------------------------------------------- browse all
    await open(DESKTOP, '/archive/all?type=dlc&sort=price_asc')
    report.browseAll = {}
    expect(report.browseAll, 'the ordinary list, with its filters and sort menu', await evaluate(`!!document.querySelector('aside[aria-label=Filters] input[type=checkbox]') && document.querySelector('main select')?.value === 'price_asc' && document.querySelectorAll('main ul li a[href^="/product/"]').length > 0`))
    expect(report.browseAll, 'the switch back to the shelf keeps the filters and order', (await evaluate(`document.querySelector('nav[aria-label="Catalog view"] a:not([aria-current])').getAttribute('href')`)) === '/archive?type=dlc&sort=price_asc')
    await open(DESKTOP, '/archive?type=dlc&sort=price_asc')
    const dlc = await (await fetch(`${base}/api/products?type=dlc&sort=price_asc`, { headers: { Accept: 'application/json' } })).json()
    now = await chosen()
    expect(report.browseAll, 'the shelf shows the same filtered, sorted products', says(now, dlc.data[0]) && (await evaluate(`Number(document.querySelector('[role=option]').getAttribute('aria-setsize'))`)) === dlc.meta.total, now)
    await shot('desktop-1440-dlc-shelf')

    // -------------------------------------------------------------- phone
    const phone = { works: {} }
    report.phone = phone
    phone.opening = await downloads(() => open(PHONE))
    now = await chosen()
    expect(phone.works, 'the rail is used, not the stage', !now.staged && (await evaluate(`!!document.querySelector('.ga-rail')`)))
    expect(phone.works, 'the first product of the API is chosen', now.position === 1 && says(now, catalog[0]), now)
    expect(phone.works, 'nothing is wider than the window', await evaluate('document.documentElement.scrollWidth <= innerWidth'))
    const railAt = await evaluate(`(() => { const box = document.querySelector('.ga-rail').getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } })()`)
    const pitch = await evaluate(`(() => { const items = document.querySelector('.ga-rail').children; return items[1].offsetLeft - items[0].offsetLeft })()`)
    await gesture(PHONE, pitch * 3, 900, { sideways: true, at: railAt })
    await sleep(900)
    now = await chosen()
    expect(phone.works, 'a swipe moves along the rail, and it comes to rest on a case', now.position === 4 && says(now, catalog[3]) && (await evaluate(`Math.abs(document.querySelector('.ga-rail').scrollLeft - ${pitch * 3}) < 2`)), now)
    await gesture(PHONE, -pitch * 2, 900, { sideways: true, at: railAt })
    await sleep(900)
    now = await chosen()
    expect(phone.works, 'a swipe the other way moves back', now.position === 2 && says(now, catalog[1]), now)
    await evaluate(`document.querySelector('button[aria-label="Next game"]').click()`)
    await sleep(900)
    now = await chosen()
    expect(phone.works, 'the Next button moves on', now.position === 3 && says(now, catalog[2]), now)
    expect(phone.works, 'the page was not scrolled by any of it', (await evaluate('Math.round(scrollY)')) === 0, await evaluate('Math.round(scrollY)'))
    phone.layoutShift = { total: Math.round((await evaluate('window.__shifts')) * 10000) / 10000, moved: await evaluate('window.__shifted') }
    phone.holds = {
      elementsInThePage: await evaluate(`document.querySelectorAll('*').length`),
      casesDrawn: await evaluate(`document.querySelectorAll('.ga-rail .ga-case').length`),
      scriptHeapMB: Math.round(((await send('Runtime.getHeapUsage')).usedSize / 1048576) * 10) / 10,
    }
    const swipes = () => timed(async () => {
      await gesture(PHONE, pitch * 12, 1500, { sideways: true, at: railAt })
      await gesture(PHONE, -pitch * 8, 2500, { sideways: true, at: railAt })
    })
    phone.timing = { 'swiping along the rail and back': await swipes() }
    await send('Emulation.setCPUThrottlingRate', { rate: 4 })
    phone.timingSlowedFourTimes = { 'swiping along the rail and back': await swipes() }
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })

    // ----------------------------------------------------- reduced motion
    await open(DESKTOP, '/archive', true)
    report.reducedMotion = {}
    now = await chosen()
    expect(report.reducedMotion, 'a wide window gets the rail, not the stage', !now.staged && (await evaluate(`!!document.querySelector('.ga-rail')`)))
    expect(report.reducedMotion, 'no animation is running', (await evaluate('document.getAnimations().length')) === 0, await evaluate('document.getAnimations().length'))
    await evaluate(`document.querySelector('button[aria-label="Next game"]').click()`)
    await sleep(300)
    now = await chosen()
    expect(report.reducedMotion, 'the Next button moves on, in one step', now.position === 2 && says(now, catalog[1]), now)
    await evaluate(`document.querySelector('[aria-label="Games in the archive"]').focus()`)
    await key('ArrowRight')
    await sleep(300)
    now = await chosen()
    expect(report.reducedMotion, 'so does the right arrow key', now.position === 3, now)
  }
} finally {
  report.problems = problems
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
