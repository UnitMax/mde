// End-to-end check of the terminal behaviours that only a running window can
// prove. Exits non-zero on any failure.
//
//   node .claude/skills/run-mde/verify.mjs            (dev tree, out/)
//   node .claude/skills/run-mde/verify.mjs --packaged (dist/linux-unpacked)
//
// Requires `npx electron-vite build` (or `npm run build` for --packaged) first.
//
// LINUX ONLY. The orphan check shells out to ps via bash, and the shell it
// drives is the POSIX branch of buildLaunchSpec. It therefore does NOT cover
// the WSL paths, which are the ones most worth covering — those need a Windows
// host and a suite that speaks PowerShell and tasklist. Do not read a green run
// here as evidence about Windows.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

if (process.platform !== 'linux') {
  console.error(`verify.mjs is Linux-only; this is ${process.platform}. See the header comment.`)
  process.exit(2)
}

const APP_DIR = path.resolve(import.meta.dirname, '../../..')
const PACKAGED = process.argv.includes('--packaged')
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-verify-'))
const SHOTS = path.join(ROOT, 'shots')
const USER_DATA = path.join(ROOT, 'profile')
const WORK = path.join(ROOT, 'work')

fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(path.join(WORK, 'alpha'), { recursive: true })
fs.mkdirSync(path.join(WORK, 'beta'), { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function record(id, ok, detail) {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`)
}

/** Live PTY shells, so orphans are countable. */
function shellPids() {
  try {
    return execFileSync('bash', [
      '-lc',
      `ps -eo pid,args | grep -E "bash -l$|bash -l " | grep -v grep | awk '{print $1}'`
    ])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

function launchOptions() {
  if (PACKAGED) {
    return {
      executablePath: path.join(APP_DIR, 'dist/linux-unpacked/mde'),
      args: [`--user-data-dir=${USER_DATA}`]
    }
  }
  return {
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
    args: ['.', `--user-data-dir=${USER_DATA}`],
    cwd: APP_DIR
  }
}

async function launch() {
  const app = await electron.launch({ ...launchOptions(), timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('aside', { timeout: 30_000 })
  await sleep(1200)
  return { app, page }
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

async function term(page, text, settle = 700) {
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await sleep(settle)
}

const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="project-row"]')].map(
      (el) => el.querySelector('[data-testid="project-name"]')?.textContent ?? ''
    )
  )

async function createProject(page, dir, name) {
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New project'))?.click()
  )
  await page.waitForSelector('#project-path', { timeout: 10_000 })
  await page.fill('#project-path', dir)
  await page.keyboard.press('Tab')
  await page.waitForFunction(
    () =>
      !![...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Create' && !b.disabled
      ),
    { timeout: 15_000 }
  )
  if (name) await page.fill('#project-name', name)
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create')?.click()
  )
  await sleep(1500)
}

async function select(page, name) {
  await page.evaluate((wanted) => {
    ;[...document.querySelectorAll('[data-testid="project-row"]')]
      .find((el) => el.textContent?.includes(wanted))
      ?.click()
  }, name)
  await sleep(1200)
}

let { app, page } = await launch()
const rendererErrors = []
page.on('pageerror', (e) => rendererErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && rendererErrors.push(m.text()))

await shot(page, '01-empty-state')

await createProject(page, path.join(WORK, 'alpha'), 'alpha')
await createProject(page, path.join(WORK, 'beta'), 'beta')
record('projects created, name auto-filled from folder', (await rows(page)).join(',') === 'alpha,beta')

// A PTY must outlive a project switch, process and scrollback intact.
await select(page, 'alpha')
const marker = path.join(WORK, 'sleep-done')
await term(page, 'echo MDE_MARKER_ALPHA')
await term(page, `(sleep 12 && echo done > ${marker}) & echo started-bg`, 500)
await select(page, 'beta')
await term(page, 'echo MDE_MARKER_BETA')
await select(page, 'alpha')
await shot(page, '02-alpha-scrollback-intact')
const pidsBaseline = shellPids()
await sleep(14_000)
record('background command survives switching projects', fs.existsSync(marker))

// A full-screen TUI must render and receive arrow keys.
// -i NONE + "+1": vim otherwise restores the cursor line from viminfo.
await select(page, 'beta')
await term(page, 'seq 1 10 > tui.txt; rm -f cursor.txt', 500)
await term(page, 'vim -i NONE +1 tui.txt', 2500)
await shot(page, '03-vim')
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowDown')
  await sleep(350)
}
await page.keyboard.type(':.w! cursor.txt')
await page.keyboard.press('Enter')
await sleep(900)
await page.keyboard.type(':q!')
await page.keyboard.press('Enter')
await sleep(1200)
const cursorFile = path.join(WORK, 'beta', 'cursor.txt')
const cursorLine = fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, 'utf8') : ''
record(
  'arrow keys reach the TUI',
  cursorLine === '4\n',
  `3 x ArrowDown from line 1 -> vim reported ${JSON.stringify(cursorLine)}`
)

await term(page, 'sleep 120', 900)
await page.keyboard.press('Control+c')
await sleep(800)
await term(page, 'echo ok > ctrlc.txt', 900)
record('Ctrl-C interrupts the foreground process', fs.existsSync(path.join(WORK, 'beta', 'ctrlc.txt')))

// Resizing must reflow a live TUI without corruption.
await term(page, 'clear; seq 1 400 > big.txt', 500)
await term(page, 'vim -i NONE +1 big.txt', 1800)
await shot(page, '04-vim-before-resize')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 560))
await sleep(1800)
await shot(page, '05-vim-shrunk')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
await sleep(1800)
await shot(page, '06-vim-grown')
await page.keyboard.press('Escape')
await page.keyboard.type(':q!')
await page.keyboard.press('Enter')
await sleep(1000)
await term(page, 'clear; echo "COLS=$(tput cols) ROWS=$(tput lines)"', 900)
await shot(page, '07-geometry-after-resize')

// Exiting shows a banner, and switching away must not silently respawn.
await term(page, 'exit 3', 1200)
await shot(page, '08-exit-banner')
const banner = await page.evaluate(() => document.body.innerText)
record(
  'exit banner reports the code and offers Restart',
  banner.includes('Process exited (code 3)') && banner.includes('Restart')
)
await select(page, 'alpha')
await select(page, 'beta')
record(
  'an exited shell is not auto-restarted on project switch',
  await page.evaluate(() => document.body.innerText.includes('Process exited'))
)
await page.evaluate(() =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Restart').pop()?.click()
)
await sleep(1500)
await term(page, 'echo restarted', 700)
record(
  'Restart revives the shell',
  !(await page.evaluate(() => document.body.innerText.includes('Process exited')))
)

// Projects must survive a restart of the app itself.
await app.close()
await sleep(1500)
;({ app, page } = await launch())
record('projects survive an app restart', (await rows(page)).length === 2)
const stored = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'projects.json'), 'utf8'))
record(
  'projects.json holds paths in the target format',
  Array.isArray(stored) && stored.length === 2 && stored.every((p) => p.id && p.path && p.kind)
)

// Removing a project must kill its shell.
await select(page, 'alpha')
await term(page, 'echo alpha-live', 800)
const pidsWithAlpha = shellPids()
await page.evaluate(() => {
  ;[...document.querySelectorAll('[data-testid="project-row"]')]
    .find((el) => el.textContent?.includes('alpha'))
    ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
})
await sleep(700)
await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('Remove'))?.click()
)
await sleep(700)
await shot(page, '09-remove-confirm')
await page.evaluate(() =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove')?.click()
)
await sleep(1500)
record(
  'remove drops the project and kills its shell',
  (await rows(page)).length === 1 && shellPids().length < pidsWithAlpha.length,
  `shell pids ${pidsWithAlpha.length} -> ${shellPids().length}`
)

// Quitting must leave nothing behind — with a live shell, or the check is vacuous.
await select(page, 'beta')
await term(page, 'echo live-at-quit', 900)
const pidsBeforeQuit = shellPids()
record('a shell is live at quit time (guards the orphan check)', pidsBeforeQuit.length >= 1)
await app.close()
await sleep(2500)
record(
  'quitting leaves no orphaned shells',
  shellPids().length === 0,
  `${pidsBeforeQuit.length} -> ${shellPids().length} (baseline ${pidsBaseline.length})`
)

record('no uncaught renderer errors', rendererErrors.length === 0, rendererErrors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`screenshots: ${SHOTS}`)
process.exit(failed.length === 0 ? 0 : 1)
