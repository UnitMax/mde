// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_HOLD_MS, ThoughtRow } from '../src/renderer/components/inbox/ChatActivity'
import { ChatMessageView } from '../src/renderer/components/inbox/ChatMessageView'
import { ToolCallView } from '../src/renderer/components/inbox/ChatTools'
import type { ChatMessage, ChatPart } from '../src/shared/types'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const DIR = '/home/me/app'
const MODEL = { id: 'm', providerId: 'p' }

let dispose: (() => void) | undefined
let root: Root | undefined
const writeText = vi.fn(async (_text: string) => undefined)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'api', { configurable: true, value: { clipboard: { writeText } } })
  writeText.mockClear()
})
afterEach(async () => {
  await act(async () => dispose?.())
  dispose = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  dispose = () => mounted.unmount()
  await act(async () => mounted.render(element))
  return container
}

/** Draws the same place again with another element, as the conversation does when a message changes. */
const rerender = (element: ReturnType<typeof createElement>) => act(async () => root!.render(element))

const q = (selector: string, root: ParentNode = document.body): HTMLElement | null => root.querySelector<HTMLElement>(selector)
const all = (selector: string, root: ParentNode = document.body): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector))
const text = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
const click = (element: HTMLElement | null) => act(async () => { element?.click() })

let counter = 0
function tool(name: string, input: unknown = {}, extra: Partial<ToolPart> = {}): ToolPart {
  counter += 1
  return { kind: 'tool', id: `call_${counter}`, name, status: 'completed', input: typeof input === 'string' ? input : JSON.stringify(input, null, 2), ...extra }
}

async function call(part: ToolPart): Promise<HTMLElement> {
  const view = await mount(createElement(ToolCallView, { part, directory: DIR }))
  return q(`[data-testid="chat-tool-${part.id}"]`, view)!
}

/** Opens a row: the first button in the row's container. */
const open = (row: HTMLElement) => click(row.querySelector<HTMLButtonElement>(':scope > button'))

function assistant(parts: ChatPart[], extra: Partial<Extract<ChatMessage, { kind: 'assistant' }>> = {}): ChatMessage {
  return { kind: 'assistant', id: 'msg_a', time: 1, agent: 'build', model: MODEL, parts, completed: true, ...extra }
}

function message(msg: ChatMessage, working?: boolean): Promise<HTMLElement> {
  return mount(createElement(ChatMessageView, { message: msg, directory: DIR, ...(working === undefined ? {} : { working }) }))
}

describe('a command', () => {
  it('reads as one line with the command, and opens to a terminal with its output', async () => {
    const row = await call(tool('shell', { command: 'npm test', description: 'Run the tests' }, { exitCode: 0, durationMs: 4200, output: 'ok\n3 passed\n' }))
    expect(text(row)).toContain('Ran npm test')
    expect(text(row)).toContain('4.2 s')
    expect(q('[data-testid="chat-shell"]', row)).toBeNull()
    await open(row)
    const terminal = q('[data-testid="chat-shell"]', row)!
    expect(text(q('pre', terminal))).toBe('npm test')
    expect(text(terminal)).toContain('$')
    expect(text(terminal)).toContain('Run the tests')
    expect(text(terminal)).toContain('ok 3 passed')
    expect(row.hasAttribute('data-failed')).toBe(false)
  })

  it('shows a failing exit code on the row and under the output', async () => {
    const row = await call(tool('shell', { command: 'npm test' }, { exitCode: 2, output: 'FAIL' }))
    expect(row.hasAttribute('data-failed')).toBe(true)
    expect(text(row)).toContain('exit 2')
    await open(row)
    expect(text(row)).toContain('The command exited with code 2.')
  })

  it('does not call a command that exited with 0 a failure', async () => {
    const row = await call(tool('shell', { command: 'true' }, { exitCode: 0, output: '' }))
    expect(text(row)).not.toContain('exit')
    await open(row)
    expect(text(row)).toContain('No output')
  })

  it('tells a command that is still running, and has no panel until it has something to show', async () => {
    const row = await call(tool('shell', '{"command": "npm te', { status: 'pending' }))
    expect(text(row)).toContain('Running')
    expect(row.querySelector(':scope > button')).toBeNull()
    expect(row.getAttribute('data-status')).toBe('pending')
  })

  it('writes only the first line of a script on the row, and all of it in the terminal', async () => {
    const row = await call(tool('bash', { command: 'set -e\nnpm ci\nnpm test' }, { output: 'done' }))
    expect(text(row)).toContain('Ran set -e …')
    expect(text(row)).not.toContain('npm ci')
    await open(row)
    expect(q('[data-testid="chat-shell"] pre', row)!.textContent).toBe('set -e\nnpm ci\nnpm test')
  })

  it('drops what is left of color codes from the output', async () => {
    const row = await call(tool('shell', { command: 'ls' }, { exitCode: 0, output: '[32mgreen[0m text' }))
    await open(row)
    expect(text(q('[data-testid="chat-shell"]', row))).toContain('green text')
    expect(text(q('[data-testid="chat-shell"]', row))).not.toContain('[32m')
  })

  it('cuts long output, with the rest a click away', async () => {
    const output = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join('\n')
    const row = await call(tool('shell', { command: 'seq 50' }, { exitCode: 0, output }))
    await open(row)
    expect(text(row)).toContain('line 20')
    expect(text(row)).not.toContain('line 21 ')
    const more = all('button', row).find((button) => text(button) === 'Show 30 lines more')!
    await click(more)
    expect(text(row)).toContain('line 50')
  })

  it('copies the command and the output', async () => {
    const row = await call(tool('shell', { command: 'echo hi' }, { exitCode: 0, output: 'hi' }))
    await open(row)
    await click(q('button[aria-label="Copy command"]', row))
    expect(writeText).toHaveBeenLastCalledWith('echo hi')
    await click(q('button[aria-label="Copy output"]', row))
    expect(writeText).toHaveBeenLastCalledWith('hi')
  })
})

describe('reading a file', () => {
  const output = (lines: string[], from = 1): string => `Read file ${DIR}/src/a.ts, lines ${from}-${from + lines.length - 1}\n${lines.map((line, index) => `${from + index}: ${line}`).join('\n')}`

  it('shows the file with its line numbers when opened', async () => {
    const row = await call(tool('read', { path: `${DIR}/src/a.ts` }, { output: output(['const a = 1', '', 'export {}']) }))
    expect(text(row)).toContain('Read src/a.ts')
    expect(text(row)).toContain('3 lines')
    await open(row)
    const preview = q('[data-testid="chat-read"]', row)!
    expect(all('.file-diff-gutter', preview).map((gutter) => gutter.textContent)).toEqual(['1', '2', '3'])
    expect(all('.file-diff-code', preview).map((line) => line.textContent)).toEqual(['const a = 1', '', 'export {}'])
  })

  it('says which lines a partial read covers', async () => {
    const row = await call(tool('read', { path: `${DIR}/src/a.ts`, offset: 40, limit: 2 }, { output: output(['x', 'y'], 40) }))
    expect(text(row)).toContain('lines 40–41')
  })

  it('keeps the first lines and offers the rest', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `row ${index + 1}`)
    const row = await call(tool('read', { path: `${DIR}/src/a.ts` }, { output: output(lines) }))
    await open(row)
    expect(all('.file-diff-code', row)).toHaveLength(24)
    await click(all('button', row).find((button) => text(button) === 'Show 36 lines more')!)
    expect(all('.file-diff-code', row)).toHaveLength(60)
  })

  it('shows what OpenCode said after the lines', async () => {
    const row = await call(tool('read', { path: `${DIR}/src/a.ts` }, { output: `${output(['a'])}\n\n(File has more lines. Use offset 2 to continue.)` }))
    await open(row)
    expect(text(row)).toContain('File has more lines')
  })

  it('shows output that is not a file as it came', async () => {
    const row = await call(tool('read', { path: `${DIR}/src` }, { output: 'Read directory /home/me/app/src\na.ts\nb.ts' }))
    await open(row)
    expect(q('[data-testid="chat-read"] pre', row)!.textContent).toContain('a.ts\nb.ts')
    expect(q('.file-diff-gutter', row)).toBeNull()
  })

  it('names the failure on the row and in a block', async () => {
    const row = await call(tool('read', { path: `${DIR}/missing.ts` }, { status: 'error', error: 'File not found' }))
    expect(row.hasAttribute('data-failed')).toBe(true)
    expect(text(row)).toContain('Read missing.ts — File not found')
    await open(row)
    expect(text(q('[data-testid="chat-tool-error"]', row))).toContain('File not found')
  })
})

describe('searching', () => {
  const grep = [
    'Found 3 matches',
    `${DIR}/src/a.ts:`,
    '  Line 8: export function createSession() {',
    '  Line 31:   const s = createSession(user)',
    `${DIR}/src/b.ts:`,
    '  Line 2: createSession()',
  ].join('\n')

  it('counts the matches on the row and lists them by file, with the matched words marked', async () => {
    const row = await call(tool('grep', { pattern: 'createSession', path: `${DIR}/src` }, { output: grep }))
    expect(text(row)).toContain('Searched createSession in src')
    expect(text(row)).toContain('3 matches')
    await open(row)
    const results = q('[data-testid="chat-grep"]', row)!
    expect(all('mark', results).map((mark) => mark.textContent)).toEqual(['createSession', 'createSession', 'createSession'])
    expect(text(results)).toContain('src/a.ts')
    expect(text(results)).toContain('src/b.ts')
    expect(all('.file-diff-gutter', results).map((gutter) => gutter.textContent)).toEqual(['8', '31', '2'])
  })

  it('does not say "in" for the folder the thread is in', async () => {
    const row = await call(tool('grep', { pattern: 'x', path: DIR }, { output: 'No matches found' }))
    expect(text(row)).toContain('Searched x')
    expect(text(row)).not.toContain(' in ')
    expect(text(row)).toContain('No matches')
  })

  it('shows a pattern that is not a regular expression without marks', async () => {
    const row = await call(tool('grep', { pattern: 'foo(' }, { output: 'Found 1 match\na.ts:\n  Line 1: foo( bar' }))
    await open(row)
    expect(q('mark', row)).toBeNull()
    expect(text(row)).toContain('foo( bar')
  })

  it('keeps to the first matches', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `  Line ${index + 1}: hit ${index + 1}`)
    const row = await call(tool('grep', { pattern: 'hit' }, { output: `Found 60 matches\na.ts:\n${lines.join('\n')}` }))
    await open(row)
    expect(all('.file-diff-row', row)).toHaveLength(40)
    await click(all('button', row).find((button) => text(button) === 'Show 20 matches more')!)
    expect(all('.file-diff-row', row)).toHaveLength(60)
  })

  it('lists the files a pattern matched', async () => {
    const row = await call(tool('glob', { pattern: '**/*.test.ts', path: `${DIR}/src` }, { output: `${DIR}/src/a.test.ts\n${DIR}/src/b.test.ts` }))
    expect(text(row)).toContain('Found files **/*.test.ts in src')
    expect(text(row)).toContain('2 files')
    await open(row)
    expect(all('li', q('[data-testid="chat-glob"]', row)!).map((item) => text(item))).toEqual(['src/a.test.ts', 'src/b.test.ts'])
  })

  it('says when no file matched', async () => {
    const row = await call(tool('glob', { pattern: '*.zig' }, { output: 'No files found' }))
    expect(text(row)).toContain('No files')
    await open(row)
    expect(text(row)).toContain('No files matched.')
  })
})

describe('the web', () => {
  it('shows the host of a fetched page, its text, and buttons to open and copy the address', async () => {
    const open_ = vi.spyOn(window, 'open').mockImplementation(() => null)
    const row = await call(tool('webfetch', { url: 'https://www.example.com/docs/page?x=1' }, { output: '# Title\n\nBody text' }))
    expect(text(row)).toContain('Fetched example.com/docs/page?x=1')
    await open(row)
    expect(text(q('[data-testid="chat-webfetch"]', row))).toContain('Body text')
    await click(q('button[aria-label="Open in the browser"]', row))
    expect(open_).toHaveBeenCalledExactlyOnceWith('https://www.example.com/docs/page?x=1', '_blank', 'noopener,noreferrer')
    await click(q('button[aria-label="Copy address"]', row))
    expect(writeText).toHaveBeenLastCalledWith('https://www.example.com/docs/page?x=1')
  })

  it('offers no way to open an address that is not a web one', async () => {
    const row = await call(tool('webfetch', { url: 'file:///etc/passwd' }, { output: 'x' }))
    await open(row)
    expect(q('button[aria-label="Open in the browser"]', row)).toBeNull()
  })

  it('lists the results of a search and opens one on click', async () => {
    const open_ = vi.spyOn(window, 'open').mockImplementation(() => null)
    const output = JSON.stringify({ results: [
      { url: 'https://a.example/x', title: 'First', excerpts: ['About the first'] },
      { url: 'javascript:alert(1)', title: 'Unsafe' },
    ] })
    const row = await call(tool('websearch', { query: 'reset password' }, { output }))
    expect(text(row)).toContain('Searched the web reset password')
    expect(text(row)).toContain('2 results')
    await open(row)
    const results = all('li button', q('[data-testid="chat-websearch"]', row)!)
    expect(results.map((result) => text(result))).toEqual(['Firsta.exampleAbout the first', 'Unsafe'])
    await click(results[0]!)
    expect(open_).toHaveBeenCalledExactlyOnceWith('https://a.example/x', '_blank', 'noopener,noreferrer')
    expect(results[1]!.hasAttribute('disabled')).toBe(true)
    await click(results[1]!)
    expect(open_).toHaveBeenCalledOnce()
  })

  it('shows an answer that is not JSON as it came', async () => {
    const row = await call(tool('websearch', { query: 'x' }, { output: '1. A result\n2. Another' }))
    await open(row)
    expect(text(row)).toContain('1. A result')
  })
})

describe('plans and questions', () => {
  const todos = { todos: [
    { content: 'Reproduce', status: 'completed', priority: 'high' },
    { content: 'Fix', status: 'in_progress', priority: 'high' },
    { content: 'Test', status: 'pending', priority: 'medium' },
    { content: 'Drop', status: 'cancelled' },
  ] }

  it('shows how far the to-do list has come and what is being worked on', async () => {
    const row = await call(tool('todowrite', todos))
    expect(text(row)).toContain('Updated the to-do list')
    expect(text(row)).toContain('Fix')
    expect(text(row)).toContain('1/4')
    await open(row)
    const items = all('li', q('[data-testid="chat-todos"]', row)!)
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['done', 'active', 'pending', 'cancelled'])
    expect(text(items[1]!)).toContain('high')
    expect(text(items[0]!)).not.toContain('high')
  })

  it('draws an answered question as a card with the answer', async () => {
    const part = tool('question', { questions: [{ header: 'City', question: 'Which city?' }] }, { answers: [['Paris']] })
    const row = await call(part)
    expect(text(row)).toContain('City')
    expect(text(row)).toContain('Which city?')
    expect(text(row)).toContain('Paris')
    expect(row.querySelector(':scope > button')).toBeNull()
  })

  it('draws a question that has not been answered as a row', async () => {
    const row = await call(tool('question', { questions: [{ question: 'Which city?' }] }, { status: 'running' }))
    expect(text(row)).toContain('Asking Which city?')
  })
})

describe('changes to files', () => {
  it('draws each file of a patch as a card', async () => {
    const patchText = '*** Begin Patch\n*** Update File: src/a.ts\n-a\n+b\n*** Add File: src/new.ts\n+x\n*** Delete File: src/old.ts\n*** End Patch'
    const part = tool('patch', { patchText })
    const view = await mount(createElement(ToolCallView, { part, directory: DIR }))
    expect(all('[data-testid="chat-diff"]', view).map((card) => card.getAttribute('aria-label'))).toEqual(['Edited src/a.ts', 'Created src/new.ts', 'Deleted src/old.ts'])
    expect(text(view)).toContain('The file was deleted')
  })

  it('draws a change as a row with its diff on the rail, not as a box of its own', async () => {
    const part = tool('write', { path: `${DIR}/src/new.ts`, content: 'export const a = 1\n' }, { existed: false })
    const view = await mount(createElement(ToolCallView, { part, directory: DIR }))
    const row = q('[data-testid="chat-diff"]', view)!
    // The same row as every other step: a group named for what was done, open onto the diff.
    expect(row.getAttribute('role')).toBe('group')
    expect(row.getAttribute('aria-label')).toBe('Created src/new.ts')
    expect(row.getAttribute('data-path')).toBe(`${DIR}/src/new.ts`)
    expect(text(q(':scope > button', row))).toBe('Created src/new.ts+1')
    expect(q(':scope > button', row)!.getAttribute('aria-expanded')).toBe('true')
    // No border, panel or rounded card around it or its parts; the diff hangs from the rail like any panel's content.
    expect(all('.border, .bg-panel, .rounded-lg, .border-t', row)).toHaveLength(0)
    expect(row.classList.contains('border')).toBe(false)
    expect(q('[data-testid="chat-diff-scroll"]', row)!.closest('.border-l')).not.toBeNull()
    expect(text(row)).toContain('export const a = 1')
  })

  it('keeps the counts on the row when the diff is shut, and opens it again', async () => {
    const part = tool('edit', { filePath: `${DIR}/src/a.ts`, oldString: 'a', newString: 'b' }, { patches: [{ path: `${DIR}/src/a.ts`, patch: '@@ -1,2 +1,2 @@\n keep\n-old\n+new\n' }] })
    const view = await mount(createElement(ToolCallView, { part, directory: DIR }))
    const row = q('[data-testid="chat-diff"]', view)!
    expect(text(q('[data-testid="chat-diff-stats"]', row))).toBe('+1−1')
    expect(all('.file-diff-row', row)).toHaveLength(3)
    await open(row)
    expect(all('.file-diff-row', row)).toHaveLength(0)
    expect(text(q('[data-testid="chat-diff-stats"]', row))).toBe('+1−1')
    await open(row)
    expect(all('.file-diff-row', row)).toHaveLength(3)
  })

  it('shows a change that is still being made as work in progress, with what is known of it', async () => {
    const part = tool('write', { path: `${DIR}/src/a.ts`, content: 'let a' }, { status: 'running', existed: false })
    const view = await mount(createElement(ToolCallView, { part, directory: DIR }))
    const row = q('[data-testid="chat-diff"]', view)!
    expect(row.getAttribute('data-status')).toBe('running')
    expect(text(q(':scope > button', row))).toContain('Creating src/a.ts')
    expect(q('svg.animate-spin', row)).not.toBeNull()
  })

  it('keeps a failed edit as a row with the reason and the input', async () => {
    const row = await call(tool('edit', { filePath: `${DIR}/src/a.ts`, oldString: 'a', newString: 'b' }, { status: 'error', error: 'Found 2 matches for oldString' }))
    expect(q('[data-testid="chat-diff"]', row)).toBeNull()
    expect(text(row)).toContain('Edited src/a.ts — Found 2 matches for oldString')
    expect(row.hasAttribute('data-failed')).toBe(true)
    await open(row)
    expect(text(row)).toContain('oldString')
  })
})

describe('other tools', () => {
  it('writes an unknown tool’s name as words, with its arguments', async () => {
    const row = await call(tool('apply_thing', { target: 'x', depth: 2 }, { output: 'done' }))
    expect(text(row)).toContain('Apply thing')
    expect(text(row)).toContain('target: x, depth: 2')
    await open(row)
    expect(text(row)).toContain('target')
    expect(text(row)).toContain('done')
  })

  it('has a row that is not a button when there is nothing to open', async () => {
    const row = await call(tool('mystery', {}))
    expect(text(row)).toContain('Mystery')
    expect(row.querySelector(':scope > button')).toBeNull()
  })

  it('draws a skill, a script and a lookup in the same way', async () => {
    const script = await call(tool('execute', { code: 'return 1' }, { output: '1' }))
    expect(text(script)).toContain('Ran a script')
    await open(script)
    expect(text(script)).toContain('return 1')
    const lookup = await call(tool('search', { namespace: 'demo_math' }))
    expect(text(lookup)).toContain('Looked up demo_math tools')
  })
})

describe('thinking', () => {
  it('says what the thought began with once it is done', async () => {
    const view = await message(assistant([{ kind: 'reasoning', text: '**Planning the fix**\n\nFirst…' }]))
    const row = q('[data-testid="chat-reasoning"]', view)!
    expect(text(row)).toBe('Thought Planning the fix')
    expect(row.getAttribute('data-status')).toBe('completed')
    await open(row)
    expect(text(row)).toContain('First…')
  })

  it('names the latest heading while the thought is written', async () => {
    const view = await message(assistant([{ kind: 'reasoning', text: '**Reading**\n\nText.\n\n**Planning**\n\nMore' }], { completed: false }))
    const row = q('[data-testid="chat-reasoning"]', view)!
    expect(text(row)).toBe('Thinking Planning')
    expect(row.getAttribute('data-status')).toBe('running')
  })

  it('shows the latest finished sentence when the thought has no headings, not the line being written', async () => {
    const view = await message(assistant([{ kind: 'reasoning', text: 'First idea.\nI should check `a.ts` next' }], { completed: false }))
    expect(text(q('[data-testid="chat-reasoning"]', view))).toBe('Thinking First idea.')
    await rerender(createElement(ChatMessageView, { message: assistant([{ kind: 'reasoning', text: 'First idea.\nI should check `a.ts` next. Then' }], { completed: false }), directory: DIR }))
    expect(text(q('[data-testid="chat-reasoning"]', view))).toBe('Thinking First idea.')
  })

  it('does not go on thinking when the agent is not at work on the message', async () => {
    const view = await message(assistant([{ kind: 'reasoning', text: 'Idea' }], { completed: false }), false)
    expect(text(q('[data-testid="chat-reasoning"]', view))).toBe('Thought')
  })
})

describe('the preview of a thought being written', () => {
  const thought = (body: string, live = true) => createElement(ThoughtRow, { text: body, live })
  const preview = (view: HTMLElement) => text(q('[data-testid="chat-reasoning"]', view))
  const pass = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })

  it('stays put while the words stream in, and holds each line long enough to read', async () => {
    vi.useFakeTimers()
    const view = await mount(thought('Check the config. '))
    expect(preview(view)).toBe('Thinking Check the config.')

    // Tokens of the next sentence arrive: nothing on the row changes.
    for (const partial of ['Check the config. Now', 'Check the config. Now I will', 'Check the config. Now I will read the']) {
      await rerender(thought(partial))
      expect(preview(view)).toBe('Thinking Check the config.')
    }
    // Two sentences finish in a flurry inside the hold: the first of them is skipped, not shown for an instant.
    await rerender(thought('Check the config. Now I will read the file. '))
    await rerender(thought('Check the config. Now I will read the file. Then run it. '))
    await pass(PREVIEW_HOLD_MS - 1)
    expect(preview(view)).toBe('Thinking Check the config.')
    await pass(1)
    expect(preview(view)).toBe('Thinking Then run it.')

    // The hold starts again with every change; a new line waits for it, and comes in without delay after it.
    await rerender(thought('Check the config. Now I will read the file. Then run it. And report. '))
    expect(preview(view)).toBe('Thinking Then run it.')
    await pass(PREVIEW_HOLD_MS)
    expect(preview(view)).toBe('Thinking And report.')
    await pass(PREVIEW_HOLD_MS * 3)
    await rerender(thought('Check the config. Now I will read the file. Then run it. And report. Done. '))
    expect(preview(view)).toBe('Thinking Done.')
  })

  it('fades a new line in rather than cutting over to it', async () => {
    vi.useFakeTimers()
    const view = await mount(thought('One. '))
    const first = q('[data-testid="chat-reasoning"] .chat-swap', view)!
    expect(first.textContent).toBe('One.')
    await rerender(thought('One. Two. '))
    await pass(PREVIEW_HOLD_MS)
    const second = q('[data-testid="chat-reasoning"] .chat-swap', view)!
    expect(second.textContent).toBe('Two.')
    expect(second).not.toBe(first)
  })

  it('says only what it began with once the thought is done, at once', async () => {
    vi.useFakeTimers()
    const view = await mount(thought('**Planning the fix**\n\nFirst. Then more. ' ))
    expect(preview(view)).toBe('Thinking Planning the fix')
    await rerender(thought('**Planning the fix**\n\nFirst. Then more. ', false))
    expect(preview(view)).toBe('Thought Planning the fix')
    expect(q('[data-testid="chat-reasoning"] .chat-swap', view)).toBeNull()
  })

  it('shows nothing but the verb until a sentence is finished, and nothing at all for an empty thought', async () => {
    vi.useFakeTimers()
    const view = await mount(thought('Still on the first sentence'))
    expect(preview(view)).toBe('Thinking')
    await rerender(thought('   '))
    expect(q('[data-testid="chat-reasoning"]', view)).toBeNull()
    await rerender(thought('First one. '))
    expect(preview(view)).toBe('Thinking First one.')
  })
})

describe('a run of steps', () => {
  const read = (name: string): ToolPart => tool('read', { path: `${DIR}/${name}` }, { output: '1: x' })
  const steps = (): ChatPart[] => [read('a.ts'), read('b.ts'), tool('shell', { command: 'ls' }, { exitCode: 0, output: 'a' }), { kind: 'text', text: 'Done.' }]

  it('folds into one line that sums it up, shut once the message is complete', async () => {
    const view = await message(assistant(steps()))
    const group = q('[data-testid="chat-activity"]', view)!
    expect(text(q('[data-testid="chat-activity-summary"]', group))).toBe('Read 2 files and ran 1 command')
    expect(group.hasAttribute('data-open')).toBe(false)
    expect(all('[data-testid^="chat-tool-"]', view)).toHaveLength(0)
    expect(text(view)).toContain('Done.')
  })

  it('opens on a click, and shows its steps', async () => {
    const view = await message(assistant(steps()))
    await open(q('[data-testid="chat-activity"]', view)!)
    expect(all('[data-testid^="chat-tool-"]', view)).toHaveLength(3)
    expect(q('[data-testid="chat-activity"]', view)!.hasAttribute('data-open')).toBe(true)
  })

  it('stays open while the message is at its end and being written, and shuts when it is not', async () => {
    const running = tool('shell', { command: 'npm test' }, { status: 'running' })
    const parts: ChatPart[] = [read('a.ts'), read('b.ts'), running]
    const view = await mount(createElement(ChatMessageView, { message: assistant(parts, { completed: false }), directory: DIR }))
    const group = q('[data-testid="chat-activity"]', view)!
    expect(group.hasAttribute('data-open')).toBe(true)
    expect(group.hasAttribute('data-live')).toBe(true)
    expect(text(q('[data-testid="chat-activity-summary"]', group))).toBe('Read 2 files and running 1 command')
    expect(q(`[data-testid="chat-tool-${running.id}"]`, group)?.getAttribute('data-status')).toBe('running')

    // The agent goes on to say something: the group shuts by itself.
    await rerender(createElement(ChatMessageView, {
      message: assistant([...parts.slice(0, 2), { ...running, status: 'completed', exitCode: 0 }, { kind: 'text', text: 'Now writing' }], { completed: false }),
      directory: DIR,
    }))
    expect(q('[data-testid="chat-activity"]', view)!.hasAttribute('data-open')).toBe(false)
  })

  it('keeps what the person chose when the work goes on', async () => {
    const parts: ChatPart[] = [read('a.ts'), read('b.ts'), read('c.ts')]
    const view = await mount(createElement(ChatMessageView, { message: assistant(parts, { completed: false }), directory: DIR }))
    // Shut by hand while it is still live.
    await open(q('[data-testid="chat-activity"]', view)!)
    expect(q('[data-testid="chat-activity"]', view)!.hasAttribute('data-open')).toBe(false)
    await rerender(createElement(ChatMessageView, {
      message: assistant([...parts, { kind: 'text', text: 'Hi' }], { completed: false }),
      directory: DIR,
    }))
    expect(q('[data-testid="chat-activity"]', view)!.hasAttribute('data-open')).toBe(false)
  })

  it('counts the steps that went wrong', async () => {
    const parts: ChatPart[] = [read('a.ts'), tool('read', { path: `${DIR}/b.ts` }, { status: 'error', error: 'nope' }), tool('shell', { command: 'false' }, { exitCode: 1 })]
    const view = await message(assistant(parts))
    expect(text(q('[data-testid="chat-activity"]', view))).toContain('2 failed')
  })

  it('does not fold two steps', async () => {
    const view = await message(assistant([read('a.ts'), read('b.ts')]))
    expect(q('[data-testid="chat-activity"]', view)).toBeNull()
    expect(all('[data-testid^="chat-tool-"]', view)).toHaveLength(2)
  })

  it('leaves a file change, an answered question and text outside the group', async () => {
    const edit = tool('edit', { filePath: `${DIR}/a.ts`, oldString: 'a', newString: 'b' })
    const view = await message(assistant([read('a.ts'), read('b.ts'), read('c.ts'), edit, read('d.ts'), read('e.ts')]))
    expect(all('[data-testid="chat-activity"]', view)).toHaveLength(1)
    expect(q('[data-testid="chat-diff"]', view)).not.toBeNull()
    expect(all('[data-testid^="chat-tool-"]', view).map((element) => element.getAttribute('data-testid'))).toEqual([`chat-tool-${edit.id}`, expect.any(String), expect.any(String)])
  })
})

describe('notes', () => {
  const note = (extra: Partial<Extract<ChatMessage, { kind: 'note' }>>): ChatMessage => ({ kind: 'note', id: 'msg_n', time: 1, tone: 'info', text: 'A note', ...extra })

  it('shows a note as a quiet row, and its details when opened', async () => {
    const view = await message(note({ detail: 'More about it' }))
    expect(text(view)).toContain('A note')
    expect(text(view)).not.toContain('More about it')
    await open(q('[data-testid="chat-message-msg_n"]', view)!.firstElementChild as HTMLElement)
    expect(text(view)).toContain('More about it')
  })

  it('shows an error note in the color of an error', async () => {
    const view = await message(note({ tone: 'error', text: 'It broke' }))
    expect(q('[data-failed]', view)).not.toBeNull()
  })

  it('shows a finished compaction as a rule that opens onto the summary', async () => {
    const view = await message(note({ text: 'Conversation compacted', detail: '## Summary\n\nWe fixed it.', compaction: { status: 'completed', reason: 'manual', summaryTokens: 1840 } }))
    expect(text(view)).toContain('Conversation compacted · summary of about 1.8K tokens')
    expect(q('[data-testid="chat-compaction-summary"]', view)).toBeNull()
    await click(q('button[aria-expanded]', view))
    expect(text(q('[data-testid="chat-compaction-summary"]', view))).toContain('We fixed it.')
  })

  it('shows a compaction that is running', async () => {
    const view = await message(note({ text: 'Compacting the conversation', compaction: { status: 'running', reason: 'auto' } }))
    expect(q('[data-compaction="running"]', view)).not.toBeNull()
    expect(q('svg.animate-spin', view)).not.toBeNull()
  })

  it('shows a goal note with its text when opened', async () => {
    const view = await message(note({ text: 'Goal set', goal: 'set', detail: 'Ship the export' }))
    expect(q('[data-goal-note="set"]', view)).not.toBeNull()
    await click(q('[data-goal-note="set"] button', view))
    expect(text(q('[data-testid="chat-goal-note-detail"]', view))).toBe('Ship the export')
  })
})
