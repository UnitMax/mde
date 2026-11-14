// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown } from '../src/renderer/components/inbox/ChatMarkdown'
import { ChatFileSourceContext } from '../src/renderer/components/inbox/mcp-context'
import { createFileLookup, fileReference, type ChatFileSource } from '../src/renderer/lib/chat-file-links'

describe('reading a file name in a reply', () => {
  const folder = '/home/me/project'

  it('takes paths relative to the folder, with or without a line', () => {
    expect(fileReference('src/a.ts', folder)).toEqual({ path: 'src/a.ts' })
    expect(fileReference('./src/a.ts:12', folder)).toEqual({ path: 'src/a.ts', line: 12 })
    expect(fileReference('src/a.ts:12:4', folder)).toEqual({ path: 'src/a.ts', line: 12 })
    expect(fileReference('src/a.ts#L7-L9', folder)).toEqual({ path: 'src/a.ts', line: 7 })
    expect(fileReference('package.json', folder)).toEqual({ path: 'package.json' })
    expect(fileReference('.gitignore', folder)).toEqual({ path: '.gitignore' })
    expect(fileReference('docs/My%20Notes.md', folder)).toEqual({ path: 'docs/My Notes.md' })
  })

  it('takes absolute paths and file links under the folder only', () => {
    expect(fileReference('/home/me/project/src/a.ts:3', folder)).toEqual({ path: 'src/a.ts', line: 3 })
    expect(fileReference('file:///home/me/project/src/a.ts', folder)).toEqual({ path: 'src/a.ts' })
    expect(fileReference('/home/me/other/a.ts', folder)).toBeNull()
    expect(fileReference('/home/me/project-two/a.ts', folder)).toBeNull()
    expect(fileReference('C:\\Users\\Me\\Project\\src\\a.ts', 'C:\\Users\\Me\\project')).toEqual({ path: 'src/a.ts' })
    expect(fileReference('file:///C:/Users/Me/project/a.ts', 'C:\\Users\\Me\\project\\')).toEqual({ path: 'a.ts' })
  })

  it('leaves alone what is not a file of the folder', () => {
    for (const text of [
      'https://example.com/a.ts', 'mailto:me@example.com', 'useEffect', 'npm run dev', 'src/', '../a.ts', 'src/../a.ts',
      '~/a.ts', '*.ts', 'a=b.ts', '1.2.3', '#heading', '',
    ]) expect(fileReference(text, folder), text).toBeNull()
  })
})

describe('looking files up', () => {
  it('lists each folder once while the listing is fresh, and answers no for folders and failures', async () => {
    let time = 0
    const list = vi.fn(async (path: string) => {
      if (path === 'missing') throw new Error('Not found')
      return {
        path,
        truncated: false,
        entries: [{ name: 'a.ts', kind: 'file' as const }, { name: 'lib', kind: 'directory' as const }],
      }
    })
    const exists = createFileLookup(list, () => time)
    expect(await exists('src/a.ts')).toBe(true)
    expect(await exists('src/lib')).toBe(false)
    expect(await exists('src/b.ts')).toBe(false)
    expect(list).toHaveBeenCalledTimes(1)
    expect(await exists('missing/a.ts')).toBe(false)
    time = 60_000
    expect(await exists('src/a.ts')).toBe(true)
    expect(list).toHaveBeenCalledTimes(3)
  })
})

describe('links and files in a reply', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })
  afterEach(async () => {
    await act(async () => dispose?.())
    dispose = undefined
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function render(text: string, source: ChatFileSource | null): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    await act(async () => root.render(createElement(ChatFileSourceContext.Provider, { value: source }, createElement(ChatMarkdown, { text }))))
    // The lookups answer, and the chips are drawn on the next transaction.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    return container
  }

  function source(files: string[]): ChatFileSource & { open: ReturnType<typeof vi.fn<ChatFileSource['open']>> } {
    return { directory: '/home/me/project', exists: async (path) => files.includes(path), open: vi.fn<ChatFileSource['open']>() }
  }

  it('makes the files the folder has into chips that open them, and leaves the rest as written', async () => {
    const files = source(['src/a.ts', 'src/b.ts'])
    const container = await render(
      'Changed `src/a.ts:12` and [b.ts](/home/me/project/src/b.ts), not `src/gone.ts`. See http://localhost:3000.',
      files,
    )
    const chips = Array.from(container.querySelectorAll<HTMLElement>('.chat-file-link'))
    expect(chips.map((chip) => [chip.textContent, chip.dataset.filePath, chip.dataset.fileLine])).toEqual([
      ['src/a.ts:12', 'src/a.ts', '12'],
      ['b.ts', 'src/b.ts', undefined],
    ])
    // A name in code can be reached with Tab; a link already can.
    expect(chips[0]!.getAttribute('tabindex')).toBe('0')
    expect(chips[1]!.hasAttribute('tabindex')).toBe(false)
    expect(container.textContent).toContain('src/gone.ts')
    expect(container.querySelector('a[href="http://localhost:3000"]')?.querySelector('.chat-file-link')).toBeNull()

    await act(async () => chips[0]!.click())
    expect(files.open).toHaveBeenLastCalledWith({ path: 'src/a.ts', line: 12 })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await act(async () => container.querySelector<HTMLElement>('a[href^="/home"]')!.click())
    expect(files.open).toHaveBeenLastCalledWith({ path: 'src/b.ts' })
    await act(async () => chips[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(files.open).toHaveBeenCalledTimes(3)
    expect(open).not.toHaveBeenCalled()
  })

  it('draws no chips without a folder to look in', async () => {
    const container = await render('Changed `src/a.ts`.', null)
    expect(container.querySelector('.chat-file-link')).toBeNull()
  })
})
