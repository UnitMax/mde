// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalDirectoryRequest } from '../src/shared/ipc'
import type { FileReadResponse, Session } from '../src/shared/types'
import { useWorkspace } from '../src/renderer/store/workspace'
import { FileViewer } from '../src/renderer/components/FileViewer'
import { languageForPath } from '../src/renderer/lib/code-languages'
import {
  externalLinkUrl,
  formatFileSize,
  isMarkdownPath,
  resolveRelativeLink
} from '../src/renderer/lib/file-viewer'
import { saveTerminalSettings, TERMINAL_SETTINGS_STORAGE_KEY } from '../src/renderer/terminal/terminal-settings'
import {
  getMarkdownPreviewWidth,
  MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY,
  saveMarkdownPreviewWidth
} from '../src/renderer/lib/markdown-preview-width'

const roots: Root[] = []
const containers: HTMLDivElement[] = []
const read = vi.fn()
const writeText = vi.fn(async (_text: string): Promise<void> => undefined)

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'App',
  kind: 'native',
  path: '/home/me/app',
  createdAt: '2026-01-01T00:00:00.000Z'
}

function file(overrides: Partial<FileReadResponse> = {}): FileReadResponse {
  return { path: 'README.md', content: '', size: 0, binary: false, tooLarge: false, ...overrides }
}

async function renderViewer(
  path: string,
  handlers: { onOpenFile?: (path: string) => void; onClose?: () => void; root?: TerminalDirectoryRequest } = {}
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  await act(async () => {
    root.render(
      createElement(FileViewer, {
        session,
        root: handlers.root,
        path,
        onOpenFile: handlers.onOpenFile ?? (() => undefined),
        onClose: handlers.onClose ?? (() => undefined)
      })
    )
  })
  // Let the language chunk load and apply.
  await act(async () => {})
  return container
}

async function rightClick(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2,
    }))
  })
}

function menuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!item) throw new Error(`Missing menu item: ${label}`)
  return item
}

async function choose(label: string): Promise<void> {
  await act(async () => menuItem(label).click())
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
}

describe('file viewer helpers', () => {

  it('resolves relative Markdown links inside the session only', () => {
    expect(resolveRelativeLink('docs/guide.md', 'setup.md')).toBe('docs/setup.md')
    expect(resolveRelativeLink('docs/guide.md', './img/../api.md#auth')).toBe('docs/api.md')
    expect(resolveRelativeLink('docs/guide.md', '../README.md')).toBe('README.md')
    expect(resolveRelativeLink('README.md', 'my%20notes.md')).toBe('my notes.md')
    expect(resolveRelativeLink('README.md', '../outside.md')).toBeNull()
    expect(resolveRelativeLink('README.md', '/etc/passwd')).toBeNull()
    expect(resolveRelativeLink('README.md', '#heading')).toBeNull()
    expect(resolveRelativeLink('README.md', 'file:///etc/passwd')).toBeNull()
    expect(resolveRelativeLink('README.md', 'javascript:alert(1)')).toBeNull()
    expect(resolveRelativeLink('README.md', 'a%5Cb.md')).toBeNull()
  })

  it('accepts only web URLs as external links', () => {
    expect(externalLinkUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(externalLinkUrl('http://example.com')).toBe('http://example.com/')
    expect(externalLinkUrl('file:///etc/passwd')).toBeNull()
    expect(externalLinkUrl('docs/a.md')).toBeNull()
  })

  it('recognizes Markdown files and formats sizes', () => {
    expect(isMarkdownPath('docs/README.MD')).toBe(true)
    expect(isMarkdownPath('notes.mdx')).toBe(true)
    expect(isMarkdownPath('src/md.ts')).toBe(false)
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('remembers the Markdown preview width and falls back to centered', () => {
    expect(getMarkdownPreviewWidth()).toBe('centered')

    saveMarkdownPreviewWidth('full')
    expect(localStorage.getItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY)).toBe('full')
    expect(getMarkdownPreviewWidth()).toBe('full')

    localStorage.setItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY, 'wide')
    expect(getMarkdownPreviewWidth()).toBe('centered')
  })

  it('treats unavailable storage as the centered default without throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(getMarkdownPreviewWidth()).toBe('centered')
    expect(() => saveMarkdownPreviewWidth('full')).not.toThrow()
  })

  it('maps file names to syntaxes and falls back to plain text', () => {
    expect(languageForPath('src/App.tsx')?.name).toBe('TSX')
    expect(languageForPath('scripts/build.MJS')?.name).toBe('JavaScript')
    expect(languageForPath('Cargo.toml')?.name).toBe('TOML')
    expect(languageForPath('docker/Dockerfile')?.name).toBe('Dockerfile')
    expect(languageForPath('Dockerfile.dev')?.name).toBe('Dockerfile')
    expect(languageForPath('install.ps1')?.name).toBe('PowerShell')
    expect(languageForPath('LICENSE')).toBeNull()
    expect(languageForPath('.gitignore')).toBeNull()
    expect(languageForPath('notes.txt')).toBeNull()
  })
})

describe('FileViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', { configurable: true, value: { files: { read }, clipboard: { writeText } } })
    read.mockReset()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    window.getSelection()?.removeAllRanges()
    localStorage.clear()
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the selected terminal root instead of the session launch folder', async () => {
    read.mockResolvedValue(file({ content: '# Current folder' }))
    useWorkspace.setState({ statuses: { 'pane-2': 'running' } })
    const root = { terminalId: 'pane-2', directory: '/workspace/current' }
    const container = await renderViewer('README.md', { root })
    expect(read).toHaveBeenCalledWith({ ...root, path: 'README.md' })
    expect(container.textContent).toContain('Current folder')
  })

  it('previews Markdown with tables and task lists, and toggles to the source', async () => {
    const markdown = '# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n'
    read.mockResolvedValue(file({ content: markdown, size: markdown.length }))

    const container = await renderViewer('docs/README.md')

    expect(read).toHaveBeenCalledWith({ sessionId: 'session-1', path: 'docs/README.md' })
    const preview = container.querySelector('.markdown-preview')
    expect(preview?.querySelector('h1')?.textContent).toBe('Title')
    expect(preview?.querySelectorAll('td')).toHaveLength(2)
    expect(preview?.querySelector('ul[data-type="taskList"]')).not.toBeNull()
    expect(preview?.querySelector('[contenteditable="true"]')).toBeNull()

    const source = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Source')
    await act(async () => {
      source?.click()
    })
    await act(async () => {})
    expect(container.querySelector('.markdown-preview')).toBeNull()
    expect(container.querySelector('[data-testid="code-viewer"] .cm-content')?.textContent).toContain('# Title')
  })

  it('switches the Markdown preview between a centered column and the full page', async () => {
    const markdown = '# Title\n\nSome text\n'
    read.mockResolvedValue(file({ content: markdown, size: markdown.length }))
    const button = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.getAttribute('aria-label') === label
      )

    let container = await renderViewer('docs/README.md')
    expect(container.querySelector('.markdown-preview')?.getAttribute('data-width')).toBe('centered')
    expect(button(container, 'Centered')?.getAttribute('aria-pressed')).toBe('true')
    expect(button(container, 'Full width')?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      button(container, 'Full width')?.click()
    })
    expect(container.querySelector('.markdown-preview')?.getAttribute('data-width')).toBe('full')
    expect(button(container, 'Full width')?.getAttribute('aria-pressed')).toBe('true')
    expect(button(container, 'Centered')?.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY)).toBe('full')
    // Switching the width must not rebuild the document.
    expect(container.querySelector('.markdown-preview h1')?.textContent).toBe('Title')

    // A fresh viewer, even for another file, starts in the remembered width.
    container = await renderViewer('docs/other.md')
    expect(container.querySelector('.markdown-preview')?.getAttribute('data-width')).toBe('full')

    await act(async () => {
      button(container, 'Centered')?.click()
    })
    expect(container.querySelector('.markdown-preview')?.getAttribute('data-width')).toBe('centered')
    expect(localStorage.getItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY)).toBe('centered')
  })

  it('offers the width control only while previewing Markdown', async () => {
    const markdown = '# Title\n'
    read.mockResolvedValue(file({ content: markdown, size: markdown.length }))
    const hasWidthControl = (container: HTMLElement): boolean =>
      container.querySelector('[aria-label="Markdown preview width"]') !== null

    const container = await renderViewer('README.md')
    expect(hasWidthControl(container)).toBe(true)

    const source = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Source')
    await act(async () => {
      source?.click()
    })
    await act(async () => {})
    expect(hasWidthControl(container)).toBe(false)

    const preview = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Preview')
    await act(async () => {
      preview?.click()
    })
    expect(hasWidthControl(container)).toBe(true)

    read.mockResolvedValue(file({ path: 'src/index.ts', content: 'const a = 1\n', size: 12 }))
    expect(hasWidthControl(await renderViewer('src/index.ts'))).toBe(false)
  })

  it('starts centered when the stored width is not recognised', async () => {
    localStorage.setItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY, 'huge')
    read.mockResolvedValue(file({ content: '# Title\n', size: 8 }))

    const container = await renderViewer('README.md')

    expect(container.querySelector('.markdown-preview')?.getAttribute('data-width')).toBe('centered')
  })

  it('shows code read-only with line numbers', async () => {
    read.mockResolvedValue(file({ path: 'src/index.ts', content: 'const a = 1\nconst b = 2\n', size: 24 }))

    const container = await renderViewer('src/index.ts')

    const viewer = container.querySelector('[data-testid="code-viewer"]')
    expect(viewer?.querySelector('.cm-content')?.textContent).toContain('const b = 2')
    expect(viewer?.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
    expect(viewer?.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(container.textContent).not.toContain('Preview')
  })

  it.each(['src/index.ts', 'README.md'])('selects and copies the entire source of %s, including lines outside the viewport', async (path) => {
    const content = Array.from({ length: 1000 }, (_, index) => `const value${index} = ${index}`).join('\n') + '\n'
    read.mockResolvedValue(file({ path, content, size: content.length }))
    const container = await renderViewer(path)
    if (path.endsWith('.md')) {
      const source = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Source')!
      await act(async () => source.click())
    }
    const host = container.querySelector('[data-testid="code-viewer"]')!
    const view = EditorView.findFromDOM(host.querySelector('.cm-content')!)!
    expect(host.textContent).not.toContain('value999')

    await rightClick(view.contentDOM)
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim()))
      .toEqual(['Copy', 'Select all'])
    expect(menuItem('Copy').hasAttribute('data-disabled')).toBe(true)
    await choose('Select all')
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(content.length)
    await vi.waitFor(() => expect(document.activeElement).toBe(view.contentDOM))

    await rightClick(view.contentDOM)
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(content)
    expect(view.state.doc.toString()).toBe(content)
  })

  it('copies just the selected source text and preserves the selection after the menu closes', async () => {
    read.mockResolvedValue(file({ path: 'notes.txt', content: 'hello world', size: 11 }))
    const container = await renderViewer('notes.txt')
    const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
    await act(async () => view.dispatch({ selection: { anchor: 6, head: 11 } }))

    await rightClick(view.contentDOM)
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('world')
    expect(view.state.selection.main.from).toBe(6)
    expect(view.state.selection.main.to).toBe(11)
    await vi.waitFor(() => expect(document.activeElement).toBe(view.contentDOM))
  })

  it('copies the Markdown selection captured before the menu took focus', async () => {
    read.mockResolvedValue(file({ content: '# Title\n\nHello **world**.', size: 25 }))
    const container = await renderViewer('README.md')
    const word = container.querySelector('.markdown-preview strong')!
    window.getSelection()!.selectAllChildren(word)

    await rightClick(word)
    expect(menuItem('Copy').hasAttribute('data-disabled')).toBe(false)
    window.getSelection()!.removeAllRanges()
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('world')
  })

  it('selects only the rendered Markdown contents, then copies them without source markup or the toolbar', async () => {
    read.mockResolvedValue(file({ content: '# Title\n\nHello **world**.', size: 25 }))
    const container = await renderViewer('README.md')
    const preview = container.querySelector('.markdown-preview')!

    // A selection outside the document must not be offered for copying.
    window.getSelection()!.selectAllChildren(container.querySelector('[title="README.md"]')!)
    await rightClick(preview)
    expect(menuItem('Copy').hasAttribute('data-disabled')).toBe(true)
    await choose('Select all')
    const selected = window.getSelection()!.toString()
    expect(selected).toContain('Title')
    expect(selected).toContain('Hello world.')
    expect(selected).not.toContain('README.md')
    expect(selected).not.toContain('Preview')
    expect(selected).not.toContain('**')
    expect(preview.contains(window.getSelection()!.anchorNode)).toBe(true)
    expect(preview.contains(window.getSelection()!.focusNode)).toBe(true)

    await rightClick(preview)
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(selected)
  })

  it.each(['empty.txt', 'empty.md'])('disables Copy and Select all for an empty file: %s', async (path) => {
    read.mockResolvedValue(file({ path }))
    const container = await renderViewer(path)
    await rightClick(container.querySelector('.markdown-preview, [data-testid="code-viewer"]')!)
    expect(menuItem('Copy').hasAttribute('data-disabled')).toBe(true)
    expect(menuItem('Select all').hasAttribute('data-disabled')).toBe(true)
  })

  it('shows clipboard errors and clears them after a successful copy', async () => {
    read.mockResolvedValue(file({ path: 'notes.txt', content: 'hello', size: 5 }))
    writeText.mockRejectedValueOnce(new Error("Error invoking remote method 'clipboard:write-text': Error: Clipboard unavailable."))
    const container = await renderViewer('notes.txt')
    const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!
    await act(async () => view.dispatch({ selection: { anchor: 0, head: 5 } }))

    await rightClick(view.contentDOM)
    await choose('Copy')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Clipboard unavailable.')
    expect(view.state.doc.toString()).toBe('hello')

    await rightClick(view.contentDOM)
    await choose('Copy')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(writeText).toHaveBeenLastCalledWith('hello')
  })

  it('uses the code preview font setting and follows changes to it', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: (query: string) => query.includes('Fira Code') || query.includes('JetBrains Mono') }
    })
    try {
      localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify({ family: 'JetBrains Mono', codeFamily: 'Fira Code' }))
      read.mockResolvedValue(file({ path: 'src/index.ts', content: 'const a = 1\n', size: 12 }))

      const container = await renderViewer('src/index.ts')
      const scroller = container.querySelector('[data-testid="code-viewer"] .cm-scroller')
      expect(scroller).not.toBeNull()
      expect(getComputedStyle(scroller!).fontFamily).toContain('Fira Code')

      await act(async () => {
        saveTerminalSettings({
          ...JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)!),
          codeFamily: 'JetBrains Mono'
        })
      })
      expect(getComputedStyle(scroller!).fontFamily).toContain('JetBrains Mono')
    } finally {
      delete (document as { fonts?: unknown }).fonts
    }
  })

  it('explains binary, oversized, and unreadable files', async () => {
    read.mockResolvedValueOnce(file({ path: 'a.png', content: null, binary: true, size: 10 }))
    let container = await renderViewer('a.png')
    expect(container.textContent).toContain('Binary file — preview not available.')

    read.mockResolvedValueOnce(file({ path: 'big.log', content: null, tooLarge: true, size: 3 * 1024 * 1024 }))
    container = await renderViewer('big.log')
    expect(container.textContent).toContain('File is 3.0 MB; previews are limited to 2 MB.')

    read.mockRejectedValueOnce(new Error("Error invoking remote method 'files:read': Error: File not found."))
    container = await renderViewer('gone.txt')
    expect(container.textContent).toContain('File not found.')
    expect(container.textContent).not.toContain('invoking remote method')
  })

  it('opens relative links in the viewer and web links through window.open', async () => {
    const markdown = '[Setup](setup.md) and [Site](https://example.com/docs)\n'
    read.mockResolvedValue(file({ content: markdown, size: markdown.length }))
    const onOpenFile = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    const container = await renderViewer('docs/guide.md', { onOpenFile })
    const links = container.querySelectorAll<HTMLAnchorElement>('.markdown-preview a')

    await act(async () => {
      links[0]?.click()
      links[1]?.click()
    })
    expect(onOpenFile).toHaveBeenCalledWith('docs/setup.md')
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  })

  it('reloads and closes from the header', async () => {
    read.mockResolvedValue(file({ path: 'a.txt', content: 'one', size: 3 }))
    const onClose = vi.fn()
    const container = await renderViewer('a.txt', { onClose })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Reload file"]')?.click()
    })
    expect(read).toHaveBeenCalledTimes(2)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close file"]')?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
