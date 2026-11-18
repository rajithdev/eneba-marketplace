#!/usr/bin/env node
// Checks the homepage's whole scroll journey in a real browser (the installed
// Chrome, headless, driven over its debugging protocol): the featured banner,
// the best sellers row, the way into the game store and the store itself.
//
//   node cinematic/journey.mjs <site address> <output folder> [--only=1440,phone-375] [--timing-only] [--no-video]
//
// For each window size it reports:
//   - layout: sideways overflow, and the layout shifts the browser itself
//     recorded, while loading and during all the scrolling that follows
//   - both ways: screenshots taken at the same places on the way down and
//     on the way back up, compared pixel by pixel
//   - at rest: that every effect leaves its element untouched where it has
//     nothing to do (the top of the page; a card in the middle of the window)
//   - cards: that each best sellers card is what a click at its middle
//     lands on, while arriving, in place and receding, and that a click
//     opens the product
//   - timing: time between display frames while scrolling the whole journey
//     down and up, slowly through the transitions, in fast flicks and with
//     changes of direction; again with the processor slowed four times
//   - reduced motion: that nothing is moved, dimmed or pinned
// and, for one desktop and one phone size, records each of those scrolls as
// a video of what the browser really drew, in real time.
//
// --timing-only measures the timing alone; it also works on a build from
// before the effects existed, for comparing the two.
//
// Chrome runs headless here, so timings show whether the page keeps up on
// this machine, not what a particular phone will do.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [base, outDir, ...flags] = process.argv.slice(2)
const only = flags.find((flag) => flag.startsWith('--only='))?.slice(7).split(',')
const timingOnly = flags.includes('--timing-only')
const noVideo = flags.includes('--no-video') || timingOnly
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SIZES = [
  { name: '1024', width: 1024, height: 768, scale: 1, mobile: false },
  { name: '1280', width: 1280, height: 800, scale: 1, mobile: false },
  { name: '1440', width: 1440, height: 900, scale: 1, mobile: false, record: true },
  { name: 'phone-375', width: 375, height: 812, scale: 2, mobile: true, record: true },
  { name: 'phone-390', width: 390, height: 844, scale: 2, mobile: true },
].filter((size) => !only || only.includes(size.name))

// ------------------------------------------------------------------ Chrome

const profile = mkdtempSync(join(tmpdir(), 'journey-'))
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
let onScreencast = null
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message.result ?? { failed: message.error })
    waiting.delete(message.id)
  }
  if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
  if (message.method === 'Page.screencastFrame') onScreencast?.(message.params)
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
// The browser's own record of anything that moved without being asked to.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__shifts = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__shifts.push({ value: entry.value, at: entry.startTime }) }).observe({ type: 'layout-shift', buffered: true })`,
})

const png = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
const scrollTo = async (y, settle = 700) => {
  await evaluate(`window.scrollTo({ top: ${Math.round(y)}, behavior: 'instant' })`)
  await sleep(settle)
}
/** Scrolls as a visitor does: a mouse wheel on a desktop, a finger on a phone. `distance` is how far down the page (negative: up), `speed` in pixels a second. */
const gesture = async (size, distance, speed) => {
  const done = send('Input.synthesizeScrollGesture', { x: Math.round(size.width / 2), y: Math.round(size.height / 2), yDistance: -Math.round(distance), speed, gestureSourceType: size.mobile ? 'touch' : 'mouse' })
  // Chrome occasionally never answers a synthesized gesture; the run then says so instead of waiting for ever.
  const late = sleep((Math.abs(distance) / speed) * 1000 + 20000).then(() => 'late')
  if ((await Promise.race([done, late])) === 'late') throw new Error(`a scroll gesture of ${Math.round(distance)}px was never completed by the browser`)
}

const open = async (size, calm = false) => {
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: calm ? 'reduce' : 'no-preference' }] })
  await send('Page.navigate', { url: `${base}/?cinematic-debug` })
  await until(`document.querySelectorAll('main section').length >= 3 && !!document.querySelector('main canvas')`, 1500)
  // A desktop gets the store's stage; wait for it to switch on, and for every frame to have arrived.
  const staged = !size.mobile && !calm && (await until(`document.querySelector('main canvas').dataset.armed === 'true'`, 400))
  await sleep(500)
  return staged
}

/** The layout shifts recorded since this was last asked, added up. */
const shifted = async () => {
  const shifts = await evaluate('window.__shifts.splice(0)')
  return { total: Math.round(shifts.reduce((total, shift) => total + shift.value, 0) * 10000) / 10000, entries: shifts.length }
}

/** Where things are in the page, in pixels from its top. */
const places = () => evaluate(`(() => {
  const down = (element) => element.getBoundingClientRect().top + scrollY
  const banner = document.querySelector('.hero-glass')
  const shelf = document.querySelector('main ol')
  const canvas = document.querySelector('main canvas')
  const runway = canvas.parentElement.parentElement
  const staged = canvas.dataset.armed === 'true'
  const block = canvas.nextElementSibling
  return { window: innerHeight, page: document.documentElement.scrollHeight, heroLeaves: down(banner) + banner.offsetHeight, shelfTop: down(shelf), shelfBottom: down(shelf) + shelf.offsetHeight,
    storeTop: down(runway), staged, end: staged ? down(runway) + runway.lastElementChild.offsetHeight : down(block) + block.offsetHeight - innerHeight * 0.6 }
})()`)

/** Lets every frame of the store arrive, so that timings and pictures are of the effect and not of the download. */
async function loadStore(at) {
  await scrollTo(at.storeTop + 600, 600)
  await until(`(window.scrollBy(0, window.__nudge = -(window.__nudge ?? 1)), window.__cinematic && window.__cinematic.framesLoaded === window.__cinematic.frames)`, 600)
  await scrollTo(0, 600)
}

/** Time between display frames during one or more scroll gestures. */
async function timed(size, from, moves) {
  await scrollTo(from, 600)
  await evaluate(`(() => { window.__times = []; const loop = (now) => { window.__times.push(now); window.__timing = requestAnimationFrame(loop) }; window.__timing = requestAnimationFrame(loop) })()`)
  for (const [distance, speed] of moves) await gesture(size, distance, speed)
  await sleep(300)
  const gaps = await evaluate(`(() => { cancelAnimationFrame(window.__timing); const t = window.__times; return t.slice(1).map((value, index) => value - t[index]) })()`)
  const sorted = [...gaps].sort((a, b) => a - b)
  const round = (value) => Math.round(value * 10) / 10
  return { frames: gaps.length, worstAtFrame: gaps.indexOf(Math.max(...gaps)), averageMs: round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length), p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]), worstMs: round(sorted.at(-1)), over33Ms: gaps.filter((gap) => gap > 33.4).length, endedAt: await evaluate('Math.round(scrollY)') }
}

/** The scrolls that are timed and recorded: where each starts and how it moves. */
function scrolls(at) {
  const intoStore = Math.max(0, at.shelfBottom - at.window)
  return {
    'forward': { from: 0, moves: [[at.end, 500]] },
    'reverse': { from: at.end, moves: [[-at.end, 500]] },
    'slow-hero-and-best-sellers': { from: 0, moves: [[Math.max(at.heroLeaves, at.shelfBottom - at.window * 0.55), 100]] },
    [at.staged ? 'slow-into-the-store' : 'slow-into-top-deals']: { from: intoStore, moves: [[at.storeTop + 250 - intoStore, 100]] },
    'slow-back-out': { from: at.storeTop + 250, moves: [[-(at.storeTop + 250 - intoStore), 100]] },
    'fast-with-changes-of-direction': { from: 0, moves: [[900, 4000], [-500, 4000], [1400, 6000], [-700, 5000], [at.end - 1100, 8000], [-at.end, 8000]] },
  }
}

/** How many pixels differ between two screenshots by more than a rounding step. */
function differing(a, b) {
  if (a.equals(b)) return 0
  const raw = (picture) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'png_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: picture, maxBuffer: 1 << 28 })
  const [one, two] = [raw(a), raw(b)]
  let count = 0
  for (let i = 0; i < one.length; i += 3) if (Math.abs(one[i] - two[i]) > 2 || Math.abs(one[i + 1] - two[i + 1]) > 2 || Math.abs(one[i + 2] - two[i + 2]) > 2) count++
  return count
}

/** Records what the browser draws, as it draws it, while `act` runs. */
async function record(file, act) {
  const shots = []
  onScreencast = (frame) => {
    shots.push({ data: frame.data, at: frame.metadata.timestamp })
    void send('Page.screencastFrameAck', { sessionId: frame.sessionId })
  }
  await send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1 })
  await sleep(400)
  await act()
  await sleep(700)
  await send('Page.stopScreencast')
  onScreencast = null
  const folder = mkdtempSync(join(tmpdir(), 'journey-frames-'))
  // Each picture is shown for as long as it was on screen, so the video plays at the speed things happened.
  const list = shots.map((shot, index) => {
    writeFileSync(join(folder, `${index}.jpg`), Buffer.from(shot.data, 'base64'))
    return `file '${join(folder, `${index}.jpg`)}'\nduration ${Math.max(0.001, (shots[index + 1]?.at ?? shot.at + 0.5) - shot.at).toFixed(4)}`
  })
  writeFileSync(join(folder, 'list.txt'), list.join('\n') + `\nfile '${join(folder, `${shots.length - 1}.jpg`)}'\n`)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(folder, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', file])
  rmSync(folder, { recursive: true, force: true })
  return shots.length
}

// ------------------------------------------------------------------ the checks

const report = {}
try {
  for (const size of SIZES) {
    const entry = (report[size.name] = { window: `${size.width}x${size.height}` })
    const stage = (name) => console.error(`${size.name}: ${name}`)
    const staged = await open(size)
    const at = await places()
    entry.store = staged ? 'scroll-controlled stage' : 'ordinary block'
    entry.places = Object.fromEntries(Object.entries(at).map(([name, value]) => [name, typeof value === 'number' ? Math.round(value) : value]))
    if (staged) await loadStore(at)
    // Kept apart: what moved while the page was loading (its placeholder giving way to the page),
    // what moved during all the scrolling, and what moved on opening a product and coming back.
    entry.layoutShift = { whileLoading: await shifted() }

    if (!timingOnly) {
      stage('down and back up')
      entry.overflowPx = await evaluate('document.documentElement.scrollWidth - innerWidth')

      // The same places on the way down and on the way back up.
      const stops = {
        '1-at-the-top': 0,
        '2-hero-leaving': at.heroLeaves * 0.55,
        '3-best-sellers-arriving': Math.max(0, at.shelfTop - at.window * 0.8),
        '4-best-sellers-in-place': at.shelfTop - at.window * 0.3,
        '5-entering-a-third': at.storeTop - at.window * 0.67,
        '6-entering-two-thirds': at.storeTop - at.window * 0.33,
        '7-entered': at.storeTop,
        ...(staged ? { '8-walking-through': at.storeTop + (at.end - at.storeTop) * 0.45, '9-showroom': at.end } : { '8-top-deals': at.end }),
      }
      // Once through first, so every picture on the page has been decoded and drawn at full quality
      // before anything is compared (a picture's first drawing can differ from its later ones by a few pixels).
      for (const y of Object.values(stops)) await scrollTo(y, 350)
      await scrollTo(0, 500)
      // What every effect has set at this moment: the styles on everything they move, and the store's frame while the store can be seen.
      const state = () => evaluate(`[...document.querySelectorAll('[data-hero], main ol > li > a, [data-reveal], main .bg-dusk')].map((element) => element.getAttribute('style') ?? '').join('|') + '|frame ' + (document.querySelector('main canvas').getBoundingClientRect().top < innerHeight ? (window.__cinematic?.frame ?? '') : 'out of sight')`)
      const goingDown = {}
      const stateDown = {}
      for (const [name, y] of Object.entries(stops)) {
        await scrollTo(y)
        goingDown[name] = await png()
        stateDown[name] = await state()
        writeFileSync(join(outDir, `${size.name}-${name}.png`), goingDown[name])
      }
      await scrollTo(at.page, 500)
      entry.bothWays = {}
      for (const [name, y] of Object.entries(stops).reverse()) {
        await scrollTo(y)
        let pixels = differing(goingDown[name], await png())
        // Looked at again a moment later before it counts: a picture may still have been settling after the jump.
        if (pixels > 0) pixels = (await sleep(600), differing(goingDown[name], await png()))
        // Compared twice over: what the effects set (which must be the same), and what the browser then drew.
        const sameState = (await state()) === stateDown[name]
        const share = ((100 * pixels) / (size.width * size.height * size.scale ** 2)).toFixed(3)
        entry.bothWays[name] = !sameState ? 'DIFFERENT STATE' : pixels === 0 ? 'identical' : `same state; ${pixels} pixels (${share}%) drawn differently`
      }

      // At rest, an effect has left nothing on its element.
      // (A card is in place from when it has finished arriving until it nears the top of the window; on a phone the rows below are still arriving.)
      const inPlace = `[...document.querySelectorAll('main ol > li')].filter((item) => { const top = item.getBoundingClientRect().top; return top > innerHeight * 0.12 && top < innerHeight * 0.5 })
        .filter((item) => item.querySelector('a').getAttribute('style') || item.querySelector('[data-reveal]').getAttribute('style')).length`
      await scrollTo(0)
      entry.atRest = { stylesLeftAtTheTop: await evaluate(`[...document.querySelectorAll('[data-hero]')].filter((element) => element.getAttribute('style')).length`) }
      await scrollTo(stops['4-best-sellers-in-place'])
      entry.atRest.stylesLeftOnCardsInPlace = await evaluate(inPlace)

      stage('cards')
      // Every card is what a click at its middle lands on (of those whose middle is in the window).
      const reachable = `(() => { const cards = [...document.querySelectorAll('main ol > li')].map((item) => { const box = item.getBoundingClientRect(); const x = box.left + box.width / 2, y = box.top + box.height / 2
        return y < 4 || y > innerHeight - 4 ? null : document.elementFromPoint(x, y)?.closest('a') === item.querySelector('a') }).filter((hit) => hit !== null); return cards.filter(Boolean).length + ' of ' + cards.length })()`
      entry.cards = {}
      for (const [name, y] of [['arriving', stops['3-best-sellers-arriving'] + at.window * 0.12], ['inPlace', stops['4-best-sellers-in-place']], ['receding', at.shelfBottom - at.window * 0.3]]) {
        await scrollTo(y)
        entry.cards[name] = await evaluate(reachable)
      }
      await scrollTo(stops['4-best-sellers-in-place'])
      entry.layoutShift.whileScrolling = await shifted()
      const first = await evaluate(`(() => { const link = document.querySelector('main ol > li > a'); const box = link.getBoundingClientRect(); return { href: link.getAttribute('href'), x: box.left + box.width / 2, y: box.top + box.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: first.x, y: first.y, button: 'left', clickCount: 1 })
      entry.cards.clickOpens = (await until(`location.pathname === ${JSON.stringify(first.href)}`, 60)) ? first.href : 'did not open'
      await evaluate('history.back()')
      await until(`location.pathname === '/' && document.querySelectorAll('main ol > li').length > 0`)
      await sleep(600)
      entry.afterComingBack = { stylesLeftOnCardsInPlace: await evaluate(inPlace) }
      entry.layoutShift.openingAProductAndComingBack = await shifted()
    }

    // Timing, at this machine's speed and with the processor slowed four times.
    const runs = scrolls(at)
    entry.timing = {}
    for (const [name, run] of Object.entries(runs)) {
      stage(`timing ${name}`)
      entry.timing[name] = await timed(size, run.from, run.moves)
    }
    stage('timing, slowed')
    await send('Emulation.setCPUThrottlingRate', { rate: 4 })
    entry.timingSlowedFourTimes = {}
    for (const name of ['forward', 'reverse', 'fast-with-changes-of-direction']) entry.timingSlowedFourTimes[name] = await timed(size, runs[name].from, runs[name].moves)
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })

    entry.layoutShift.whileScrollingTimed = await shifted()

    if (size.record && !noVideo) {
      entry.videos = {}
      for (const [name, run] of Object.entries(runs)) {
        stage(`recording ${name}`)
        await scrollTo(run.from, 600)
        entry.videos[`${size.name}-${name}.mp4`] = await record(join(outDir, `${size.name}-${name}.mp4`), async () => {
          for (const [distance, speed] of run.moves) await gesture(size, distance, speed)
        })
      }
    }

    if (!timingOnly) {
      stage('reduced motion')
      // Reduced motion: nothing moved, dimmed or pinned, anywhere down the page.
      await open(size, true)
      const calm = await places()
      const moved = []
      for (const y of [0, calm.heroLeaves * 0.6, calm.shelfTop - calm.window * 0.8, calm.shelfBottom - calm.window * 0.3, calm.storeTop - calm.window * 0.3]) {
        await scrollTo(Math.max(0, y), 400)
        moved.push(await evaluate(`[...document.querySelectorAll('[data-hero], main ol > li > a, [data-reveal]')].filter((element) => element.getAttribute('style')).length`))
      }
      entry.reducedMotion = {
        elementsMoved: Math.max(...moved),
        stage: await evaluate(`document.querySelector('main canvas').hidden ? 'not shown' : 'shown'`),
        pageDimmed: await evaluate(`[...document.querySelectorAll('main .bg-dusk')].some((sheet) => Number(getComputedStyle(sheet).opacity) > 0)`),
        samePageLength: calm.page,
      }
      await scrollTo(calm.shelfTop - calm.window * 0.8, 400)
      writeFileSync(join(outDir, `${size.name}-reduced-motion-best-sellers.png`), await png())
      if (size.record && !noVideo) {
        await scrollTo(0, 600)
        entry.videos[`${size.name}-reduced-motion-forward.mp4`] = await record(join(outDir, `${size.name}-reduced-motion-forward.mp4`), () => gesture(size, calm.end, 500))
      }
    }
    console.log(size.name, 'done')
  }
} finally {
  report.problems = [...new Set(problems)]
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  socket.close()
  chrome.kill()
  // Chrome may still be writing to its profile as it closes; the folder is a temporary one either way.
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}
console.log(JSON.stringify(report, null, 2))
