/*
 * A shell command as the Inbox shows it at a glance: split into the commands it chains (`cd app && npm test` is two),
 * with a leading `cd` folded into where the rest ran. Models often start every command with a `cd` into the folder
 * they are already in, and a row that shows only the start of the line then shows only that `cd`.
 *
 * Nothing is hidden for good: the whole command stays in the opened row. A `cd` that leaves the thread's folder, or
 * one MDE cannot follow, is kept in sight and marked, since where a command ran is part of what it did.
 */

/** What joins a step to the one before it; `newline` is a line break, which chains like `;`. */
export type StepOp = '&&' | '||' | ';' | '&' | 'newline'

/** Where a command ran, against the thread's folder. */
export interface Place {
  /** As shown: relative inside the thread's folder, `~/…` or absolute outside it, the raw text when unknown. */
  shown: string
  /** `inside`: within the thread's folder; `outside`: somewhere else; `unknown`: MDE cannot tell (`cd "$DIR"`). */
  status: 'inside' | 'outside' | 'unknown'
}

export interface CommandStep {
  /** What joins it to the step before; null for the first. */
  op: StepOp | null
  /** The step on one line: line continuations joined, cut at a line break inside it. */
  text: string
  /** The step went on past its first line (a quoted string or a script across lines). */
  cut: boolean
  /** For a `cd` left among the steps: where it went. */
  place?: Place
}

export interface CommandView {
  /** Where the steps ran, when that is not the thread's own folder; from the tool's working directory and leading `cd`s. */
  place: Place | null
  steps: CommandStep[]
  /** The command could not be split (a heredoc, an `if` or `for`, unbalanced quotes): the one step is its first line. */
  raw: boolean
}

interface RawStep {
  op: StepOp | null
  text: string
}

const COMPOUND = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function'])

/**
 * The commands a shell line chains with `&&`, `||`, `;`, `&` and line breaks, outside quotes, `$(…)`, backticks,
 * subshells and braces. A pipe stays within its step: `grep x | head` is one thing done. Comments are dropped.
 * Null when the command is not a plain chain: a heredoc, a compound statement, or quotes and brackets that do not close.
 * With `windows` a backslash is a path separator (cmd, PowerShell), not an escape.
 */
export function splitCommand(command: string, windows = false): RawStep[] | null {
  const steps: RawStep[] = []
  const stack: string[] = []
  let op: StepOp | null = null
  let start = 0
  let i = 0
  const push = (end: number, next: StepOp, skip: number): void => {
    const text = command.slice(start, end).trim()
    if (text) {
      steps.push({ op: steps.length === 0 ? null : op, text })
      op = next
    } else if (steps.length > 0 && next !== 'newline') {
      // `a;\nb` is joined by the `;`, not by the line break after it.
      op = op === 'newline' || op === null ? next : op
    }
    i = end + skip
    start = i
  }
  while (i < command.length) {
    const c = command[i]!
    const next = command[i + 1]
    const top = stack[stack.length - 1]
    if (top === "'") {
      if (c === "'") stack.pop()
      i += 1
      continue
    }
    if (c === '\\' && !windows) {
      i += 2
      continue
    }
    if (top === '"') {
      if (c === '"') stack.pop()
      else if (c === '$' && next === '(') {
        stack.push('(')
        i += 1
      } else if (c === '`') stack.push('`')
      i += 1
      continue
    }
    if (c === "'" || c === '"') {
      stack.push(c)
      i += 1
      continue
    }
    if (c === '`') {
      if (top === '`') stack.pop()
      else stack.push('`')
      i += 1
      continue
    }
    if (c === '$' && (next === '(' || next === '{')) {
      stack.push(next)
      i += 2
      continue
    }
    if (c === '(' || c === '{') {
      stack.push(c)
      i += 1
      continue
    }
    if (c === ')') {
      if (top !== '(') return null
      stack.pop()
      i += 1
      continue
    }
    if (c === '}') {
      if (top === '{') stack.pop()
      i += 1
      continue
    }
    const wordStart = i === 0 || /[\s;&|()]/.test(command[i - 1]!)
    if (c === '#' && wordStart && top !== '`') {
      // The comment goes, up to the end of its line; what came before it stays.
      const end = command.indexOf('\n', i)
      command = command.slice(0, i) + (end === -1 ? '' : command.slice(end))
      continue
    }
    if (c === '<' && next === '<') {
      // `<<<` is a here-string, on its line; `<<` starts a heredoc, whose lines are not commands.
      if (command[i + 2] !== '<') return null
      i += 3
      continue
    }
    if (stack.length > 0) {
      i += 1
      continue
    }
    if (c === '&' && next === '&') push(i, '&&', 2)
    else if (c === '|' && next === '|') push(i, '||', 2)
    else if (c === ';' && next === ';') return null
    else if (c === ';') push(i, ';', 1)
    else if (c === '\n') push(i, 'newline', 1)
    else if (c === '&' && next !== '>' && !/[<>]/.test(command[i - 1] ?? '') && command[i - 1] !== '|') push(i, '&', 1)
    else i += 1
  }
  if (stack.length > 0) return null
  const text = command.slice(start).trim()
  if (text) steps.push({ op: steps.length === 0 ? null : op, text })
  if (steps.some((step) => COMPOUND.has(firstWord(step.text)))) return null
  return steps
}

function firstWord(text: string): string {
  return /^[^\s;&|()]+/.exec(text.replace(/^[({\s]+/, ''))?.[0] ?? ''
}

/** The words of a short step, unquoted; null when one of them needs the shell to say what it is (`$DIR`, `*`). */
function words(text: string, windows: boolean): Array<{ word: string; plain: boolean }> {
  const out: Array<{ word: string; plain: boolean }> = []
  const re = windows ? /'([^']*)'|"([^"]*)"|([^\s'"]+)/g : /'([^']*)'|"((?:[^"\\]|\\.)*)"|((?:[^\s'"\\]|\\.)+)/g
  let current: { word: string; plain: boolean } | null = null
  let last = -1
  for (const match of text.matchAll(re)) {
    const joined = current !== null && match.index === last
    const quoted = match[2] ?? match[3] ?? ''
    const part = match[1] ?? (windows ? quoted : quoted.replace(/\\(.)/g, '$1'))
    const plain = match[1] !== undefined || !/[$`*?[\]]/.test(match[2] ?? match[3] ?? '')
    if (joined && current) {
      current.word += part
      current.plain &&= plain
    } else {
      current = { word: part, plain }
      out.push(current)
    }
    last = match.index + match[0].length
  }
  return out
}

/** The folder a `cd` step goes to, as written; `~` for none. Undefined when the step is not a `cd`. */
function cdTarget(text: string, windows: boolean): { target: string; plain: boolean } | undefined {
  const list = words(text, windows)
  const program = list[0]?.word.toLowerCase()
  if (program !== 'cd' && program !== 'pushd' && program !== 'set-location' && program !== 'sl' && program !== 'chdir') return undefined
  const rest = list.slice(1)
  // Options: `cd -P x`, `cd /d C:\x` (cmd), `Set-Location -Path x`; `cd -` goes back and cannot be followed.
  while (rest.length > 0 && rest[0]!.word !== '-' && (/^-[A-Za-z-]+$/.test(rest[0]!.word) || /^\/d$/i.test(rest[0]!.word))) rest.shift()
  if (rest.length > 1) return { target: rest.map((item) => item.word).join(' '), plain: false }
  if (rest.length === 0) return { target: '~', plain: true }
  const only = rest[0]!
  return { target: only.word, plain: only.plain && only.word !== '-' }
}

interface Folder {
  windows: boolean
  parts: string[]
  /** A drive (`C:`) or empty for a POSIX path. */
  root: string
}

function folderOf(path: string): Folder | null {
  const slashed = path.replace(/\\/g, '/')
  const drive = /^([A-Za-z]:)(\/|$)/.exec(slashed)
  if (!drive && !slashed.startsWith('/')) return null
  const body = drive ? slashed.slice(2) : slashed
  const parts: string[] = []
  for (const part of body.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return { windows: Boolean(drive), parts, root: drive ? drive[1]!.toUpperCase() : '' }
}

function join(base: Folder, relative: string): Folder {
  const parts = [...base.parts]
  for (const part of relative.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return { ...base, parts }
}

function same(a: string, b: string, windows: boolean): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether `inner` is `outer` or within it. */
function within(inner: Folder, outer: Folder): boolean {
  if (inner.windows !== outer.windows || inner.root !== outer.root || inner.parts.length < outer.parts.length) return false
  return outer.parts.every((part, index) => same(part, inner.parts[index]!, outer.windows))
}

function text(folder: Folder): string {
  return folder.windows ? `${folder.root}\\${folder.parts.join('\\')}` : `/${folder.parts.join('/')}`
}

/** The home folder the thread's folder is in, when its path says so (`/home/me/…`, `C:\Users\Me\…`). */
function homeOf(directory: Folder | null): Folder | null {
  if (!directory) return null
  const [first, second] = directory.parts
  if (directory.windows) return first?.toLowerCase() === 'users' && second ? { ...directory, parts: [first, second] } : null
  if (first === 'root') return { ...directory, parts: ['root'] }
  if ((first === 'home' || first === 'Users') && second) return { ...directory, parts: [first, second] }
  return null
}

/** Where a folder is, against the thread's folder; null when it is that folder. */
function placeOf(folder: Folder | null, raw: string, directory: Folder | null, home: Folder | null): Place | null {
  if (!folder || !directory) return { shown: raw, status: 'unknown' }
  if (within(folder, directory)) {
    if (folder.parts.length === directory.parts.length) return null
    return { shown: folder.parts.slice(directory.parts.length).join('/'), status: 'inside' }
  }
  if (home && within(folder, home)) {
    const rest = folder.parts.slice(home.parts.length)
    return { shown: rest.length > 0 ? `~/${rest.join('/')}` : '~', status: 'outside' }
  }
  return { shown: text(folder), status: 'outside' }
}

/** Where a `cd` from `base` goes; null when MDE cannot follow it. */
function resolve(base: Folder | null, target: string, home: Folder | null): Folder | null {
  if (target === '~' || target.startsWith('~/') || target.startsWith('~\\')) return home ? join(home, target.slice(1)) : null
  if (target.startsWith('~')) return null
  const absolute = folderOf(target)
  if (absolute) return absolute
  // `\foo` on Windows is the root of the current drive.
  return base ? join(base, target) : null
}

function oneLine(text: string): { text: string; cut: boolean } {
  const joined = text.replace(/[ \t]*\\\r?\n\s*/g, ' ')
  const lines = joined.split('\n')
  return { text: lines[0]!.trimEnd(), cut: lines.length > 1 }
}

/**
 * A shell command as the Inbox shows it: the steps it chains, each on one line, with the folder it ran in when that is
 * not the thread's own. The tool's working directory and any `cd`s at the start of the chain set that folder and leave
 * the steps; a `cd` later on stays among them, with where it went.
 */
export function commandView(command: string, directory: string, workdir: string | null = null): CommandView {
  const root = folderOf(directory)
  const home = homeOf(root)
  let base: Folder | null = root
  let place: Place | null = null
  if (workdir) {
    base = resolve(root, workdir, home)
    place = placeOf(base, workdir, root, home)
  }
  const windows = root?.windows ?? false
  const split = splitCommand(command, windows)
  if (!split || split.length === 0) {
    const first = command.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
    const cut = command.trim().includes('\n')
    return { place, steps: first ? [{ op: null, text: first, cut }] : [], raw: Boolean(split === null && command.trim()) }
  }
  const steps: CommandStep[] = []
  let leading = true
  for (let index = 0; index < split.length; index += 1) {
    const step = split[index]!
    const cd = cdTarget(step.text, windows)
    const following = split[index + 1]
    if (cd) {
      const folder = cd.plain ? resolve(base, cd.target, home) : null
      const where = placeOf(folder, cd.target, root, home)
      base = folder
      // A `cd` that the rest runs after (`&&`, `;`, a new line) only says where; one whose failure is handled
      // (`cd x || exit`) or that ends the chain is a command of its own.
      if (leading && following && following.op !== '||' && following.op !== '&') {
        place = where
        continue
      }
      leading = false
      steps.push({ op: steps.length === 0 ? null : step.op, ...oneLine(step.text), place: where ?? { shown: '.', status: 'inside' } })
      continue
    }
    leading = false
    steps.push({ op: steps.length === 0 ? null : step.op, ...oneLine(step.text) })
  }
  return { place, steps, raw: false }
}

/** How a step's joining operator reads; a line break shows as nothing. */
export function opText(op: StepOp | null): string {
  return op === null || op === 'newline' ? '' : op
}
