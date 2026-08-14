// REPL driver for mde. Launches the real Electron app and exposes commands on
// stdin so an agent can poke the UI without relaunching between interactions.
//
//   node .claude/skills/run-mde/driver.mjs
//
// Wrap in tmux for interactive use; see SKILL.md.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '../../..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'mde-shots')
// Never point the driver at the real profile: it would clobber the user's projects.
const USER_DATA = process.env.MDE_USER_DATA || path.join(os.tmpdir(), 'mde-driver-profile')

fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

let app = null
let page = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const need = () => {
  if (!page) throw new Error('launch first')
}

/** Sidebar rows, with the status-dot colour so PTY state is visible. */
const readRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('aside [role="button"]')].map((el) => ({
      name: el.querySelector('.min-w-0 > div')?.textContent ?? '',
      subtitle: el.querySelector('.min-w-0 > div:nth-child(2)')?.textContent ?? '',
      dot: getComputedStyle(el.querySelector('span')).backgroundColor,
      selected: el.className.includes('bg-active')
    }))
  )

const COMMANDS = {
  async launch(arg) {
    if (app) return console.log('already launched')
    if (arg === 'fresh') fs.rmSync(USER_DATA, { recursive: true, force: true })
    app = await electron.launch({
      executablePath: electronBin,
      args: ['.', `--user-data-dir=${USER_DATA}`],
      cwd: APP_DIR,
      timeout: 60_000
    })
    page = await app.firstWindow()
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}]`, m.text())
    })
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e)))
    await page.waitForSelector('aside', { timeout: 30_000 })
    await sleep(1200)
    console.log(`launched — profile ${USER_DATA}`)
  },

  async ss(name) {
    need()
    const file = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`)
    await page.screenshot({ path: file })
    console.log('screenshot:', file)
  },

  /** new-project <absolute-path> [name] */
  async 'new-project'(args) {
    need()
    const [dir, ...rest] = args.split(/\s+/)
    if (!dir) return console.log('usage: new-project <absolute-path> [name]')
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('New project'))
        ?.click()
    )
    await page.waitForSelector('#project-path', { timeout: 10_000 })
    await page.fill('#project-path', dir)
    await page.keyboard.press('Tab')
    try {
      // The existence check is debounced; Create stays disabled until it lands.
      await page.waitForFunction(
        () =>
          !![...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Create' && !b.disabled
          ),
        { timeout: 15_000 }
      )
    } catch {
      const msg = await page.evaluate(() => document.body.innerText)
      return console.log('Create never enabled — validation said:', msg.slice(0, 400))
    }
    if (rest.length) await page.fill('#project-name', rest.join(' '))
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create')?.click()
    )
    await sleep(1800)
    console.log('rows:', JSON.stringify(await readRows()))
  },

  async select(name) {
    need()
    const hit = await page.evaluate((wanted) => {
      const row = [...document.querySelectorAll('aside [role="button"]')].find((el) =>
        el.textContent?.includes(wanted)
      )
      row?.click()
      return !!row
    }, name)
    await sleep(1200)
    console.log(hit ? `selected ${name}` : `no project matching ${name}`)
  },

  /** term <command> — types into the focused terminal and presses Enter. */
  async term(command) {
    need()
    await page.keyboard.type(command)
    await page.keyboard.press('Enter')
    await sleep(800)
    console.log('sent:', command)
  },

  /** keys <Key> — e.g. ArrowDown, Escape, Control+c */
  async keys(key) {
    need()
    await page.keyboard.press(key)
    await sleep(300)
    console.log('pressed:', key)
  },

  async type(text) {
    need()
    await page.keyboard.type(text)
    console.log('typed:', text)
  },

  /** resize <width> <height> — drives the debounced fit + PTY resize path. */
  async resize(args) {
    if (!app) throw new Error('launch first')
    const [w, h] = args.split(/\s+/).map(Number)
    if (!w || !h) return console.log('usage: resize <width> <height>')
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size.w, size.h)
    }, { w, h })
    await sleep(1500)
    console.log(`resized to ${w}x${h}`)
  },

  async rows() {
    need()
    console.log(JSON.stringify(await readRows(), null, 2))
  },

  /** Which xterm renderer actually activated — WebGL silently falls back. */
  async renderer() {
    need()
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          webglCanvases: document.querySelectorAll('.xterm-screen canvas').length,
          domRows: document.querySelectorAll('.xterm-rows > div').length
        }))
      )
    )
  },

  async text(sel) {
    need()
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null
      )
    )
  },

  async eval(expr) {
    need()
    console.log(JSON.stringify(await page.evaluate(expr)))
  },

  async 'click-text'(text) {
    need()
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, [role="menuitem"], [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, text)
    await sleep(600)
    console.log('click-text', JSON.stringify(text), '->', r)
  },

  /** Opens a sidebar row's context menu (Rename / Reveal / Remove). */
  async menu(name) {
    need()
    await page.evaluate((wanted) => {
      const row = [...document.querySelectorAll('aside [role="button"]')].find((el) =>
        el.textContent?.includes(wanted)
      )
      row?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 })
      )
    }, name)
    await sleep(600)
    console.log('menu open for', name)
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

// Electron steals the normal stdin stream; read the fd directly.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

// readline does not await the handler, so a piped script would fire every line
// at once while launch is still starting. Serialise them.
let queue = Promise.resolve()
let closed = false
const prompt = () => {
  if (!closed) rl.prompt()
}

rl.on('line', (line) => {
  queue = queue.then(async () => {
    const trimmed = line.trim()
    if (!trimmed) return prompt()
    const [cmd, ...rest] = trimmed.split(/\s+/)
    const fn = COMMANDS[cmd]
    if (!fn) {
      console.log('unknown:', cmd, '— try: help')
      return prompt()
    }
    try {
      await fn(rest.join(' '))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
    if (cmd === 'quit') process.exit(0)
    prompt()
  })
})
// Piped stdin closes as soon as the last line is read; drain the queue first.
rl.on('close', () => {
  closed = true
  queue = queue.then(async () => {
    await COMMANDS.quit()
    process.exit(0)
  })
})

console.log('mde driver — "help" for commands, "launch" to start ("launch fresh" wipes the profile)')
prompt()
