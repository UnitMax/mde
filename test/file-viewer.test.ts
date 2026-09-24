// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileReadResponse, Session } from '../src/shared/types'
import { FileViewer } from '../src/renderer/components/FileViewer'
import { languageForPath } from '../src/renderer/lib/code-languages'
import {
  externalLinkUrl,
  formatFileSize,
  isMarkdownPath,
  resolveRelativeLink
} from '../src/renderer/lib/file-viewer'

const roots: Root[] = []
const containers: HTMLDivElement[] = []
const read = vi.fn()

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
  handlers: { onOpenFile?: (path: string) => void; onClose?: () => void } = {}
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
    Object.defineProperty(window, 'api', { configurable: true, value: { files: { read } } })
    read.mockReset()
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

  it('shows code read-only with line numbers', async () => {
    read.mockResolvedValue(file({ path: 'src/index.ts', content: 'const a = 1\nconst b = 2\n', size: 24 }))

    const container = await renderViewer('src/index.ts')

    const viewer = container.querySelector('[data-testid="code-viewer"]')
    expect(viewer?.querySelector('.cm-content')?.textContent).toContain('const b = 2')
    expect(viewer?.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
    expect(viewer?.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(container.textContent).not.toContain('Preview')
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
