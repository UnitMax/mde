// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatFileEntry } from '../src/shared/types'
import { InboxFilePicker } from '../src/renderer/components/inbox/InboxFilePicker'
import { filePickerRows, inTerminal, isFilePickerShortcut } from '../src/renderer/lib/inbox-file-picker'
import { useWorkspace } from '../src/renderer/store/workspace'

const file = (path: string): ChatFileEntry => ({ path, directory: false })

describe('the Ctrl+P shortcut', () => {
  const key = (init: Partial<KeyboardEventInit & { type: string }>) => ({ key: 'p', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init })
  it('is Ctrl+P or Cmd+P, without Shift or Alt', () => {
    expect(isFilePickerShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isFilePickerShortcut(key({ metaKey: true, key: 'P' }))).toBe(true)
    expect(isFilePickerShortcut(key({}))).toBe(false)
    expect(isFilePickerShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isFilePickerShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isFilePickerShortcut(key({ ctrlKey: true, type: 'keyup' }))).toBe(false)
  })

  it('leaves a terminal its Ctrl+P', () => {
    document.body.innerHTML = '<div class="xterm"><textarea id="term"></textarea></div><textarea id="box"></textarea>'
    expect(inTerminal(document.getElementById('term'))).toBe(true)
    expect(inTerminal(document.getElementById('box'))).toBe(false)
    expect(inTerminal(null)).toBe(false)
    document.body.innerHTML = ''
  })
})

describe('the files listed for a query', () => {
  it('leaves folders out and puts files whose name fits first, keeping the order otherwise', () => {
    const rows = filePickerRows([file('docs/app-notes.md'), { path: 'src/', directory: true }, file('src/store/widget.ts'), file('src/app.ts')], 'app')
    expect(rows.map((row) => row.path)).toEqual(['docs/app-notes.md', 'src/app.ts', 'src/store/widget.ts'])
    expect(rows[1]).toMatchObject({ name: 'app.ts', folder: 'src/', matches: { name: [0, 1, 2], folder: [] } })
  })

  it('marks a word that spans the folder and the name in both', () => {
    const [row] = filePickerRows([file('src/app.ts')], 'src/ap')
    expect(row).toMatchObject({ name: 'app.ts', folder: 'src/', matches: { folder: [0, 1, 2, 3], name: [0, 1] } })
  })

  it('keeps a file OpenCode found without marking anything when the letters cannot be placed', () => {
    const [row] = filePickerRows([file('README.md')], 'zz')
    expect(row).toMatchObject({ name: 'README.md', folder: '', matches: { name: [], folder: [] } })
  })
})

describe('the file picker', () => {
  const roots: Root[] = []
  let files: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    files = vi.fn(async ({ query }: { query: string }) => [file('src/app.ts'), file('docs/app-notes.md'), { path: 'src/', directory: true }].filter((entry) => entry.path.includes(query)))
    vi.stubGlobal('api', { chat: { files } })
    useWorkspace.setState({ openFiles: {} })
  })
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount())
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  async function render(place: { threadId: string } | { folderId: string } = { threadId: 'ses_a' }, onOpenChange = vi.fn()) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(createElement(InboxFilePicker, { open: true, onOpenChange, place, rootId: 'threadId' in place ? place.threadId : place.folderId, project: 'app' })))
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="file-picker-input"]')!
    return { input, onOpenChange }
  }
  const results = () => Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="file-picker-result"]'))
  const empty = () => document.body.querySelector('[data-testid="file-picker-empty"]')?.textContent
  const key = (input: HTMLElement, name: string) => act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  }

  it('asks for nothing until something is typed, then lists the files OpenCode finds', async () => {
    vi.useFakeTimers()
    const { input } = await render()
    expect(empty()).toBe('Type part of a file name to search app.')
    expect(files).not.toHaveBeenCalled()
    await type(input, 'app')
    expect(files).toHaveBeenCalledWith({ threadId: 'ses_a', query: 'app', search: true })
    expect(results().map((row) => row.title)).toEqual(['src/app.ts', 'docs/app-notes.md'])
    expect(results()[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('opens the highlighted file in the viewer of the thread with ↓ Enter, and closes', async () => {
    vi.useFakeTimers()
    const { input, onOpenChange } = await render()
    await type(input, 'app')
    await key(input, 'ArrowDown')
    await key(input, 'Enter')
    expect(useWorkspace.getState().openFiles).toEqual({ ses_a: 'docs/app-notes.md' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('searches the folder of a new thread and opens the file in its viewer', async () => {
    vi.useFakeTimers()
    const { input } = await render({ folderId: 'fld_app' })
    await type(input, 'src/app')
    expect(files).toHaveBeenCalledWith({ folderId: 'fld_app', query: 'src/app', search: true })
    await key(input, 'Enter')
    expect(useWorkspace.getState().openFiles).toEqual({ fld_app: 'src/app.ts' })
  })

  it('says when nothing fits or the search failed', async () => {
    vi.useFakeTimers()
    const { input } = await render()
    await type(input, 'zzz')
    expect(empty()).toBe('No matching files.')
    files.mockRejectedValueOnce(new Error('OpenCode is not running'))
    await type(input, 'zzzz')
    expect(empty()).toBe('The files could not be searched: OpenCode is not running')
  })
})
