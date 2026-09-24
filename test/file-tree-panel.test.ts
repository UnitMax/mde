// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import { FileTreePanel } from '../src/renderer/components/FileTreePanel'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

const list = vi.fn()
const reveal = vi.fn(async () => undefined)
const openInVsCode = vi.fn(async () => undefined)

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'App',
  kind: 'native',
  path: '/home/me/app',
  createdAt: '2026-01-01T00:00:00.000Z'
}

async function renderPanel(target: Session = session): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  await act(async () => {
    root.render(createElement(FileTreePanel, { session: target }))
  })

  return container
}

function treeItem(container: HTMLElement, path: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`)
  if (!item) throw new Error(`No tree item for ${path}`)
  return item
}

describe('FileTreePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { files: { list }, paths: { reveal, openInVsCode } }
    })
    list.mockReset()
    reveal.mockClear()
    openInVsCode.mockClear()
    list.mockImplementation(async ({ path }: { path: string }) => {
      if (path === '') {
        return {
          path,
          entries: [
            { name: 'src', kind: 'directory' },
            { name: 'README.md', kind: 'file' }
          ],
          truncated: false
        }
      }
      if (path === 'src') {
        return { path, entries: [{ name: 'index.ts', kind: 'file' }], truncated: false }
      }
      throw new Error("Error invoking remote method 'files:list': Error: Folder not found.")
    })
    useWorkspace.setState({ fileTreeCollapsed: false, platform: null, wslAvailable: false })
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
  })

  it('lists the session root and loads a folder when it is expanded', async () => {
    const container = await renderPanel()

    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1', path: '' })
    const src = treeItem(container, 'src')
    expect(src.getAttribute('aria-expanded')).toBe('false')
    expect(treeItem(container, 'README.md').getAttribute('aria-expanded')).toBeNull()

    await act(async () => {
      src.click()
    })

    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1', path: 'src' })
    expect(treeItem(container, 'src').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem(container, 'src/index.ts').textContent).toBe('index.ts')

    await act(async () => {
      treeItem(container, 'src').click()
    })
    expect(container.querySelector('[data-path="src/index.ts"]')).toBeNull()
  })

  it('does nothing when a file is clicked', async () => {
    const container = await renderPanel()
    await act(async () => {
      treeItem(container, 'README.md').click()
    })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('shows listing errors without the IPC prefix', async () => {
    list.mockRejectedValueOnce(new Error("Error invoking remote method 'files:list': Error: Session folder not found."))
    const container = await renderPanel()
    expect(container.textContent).toContain('Session folder not found.')
    expect(container.textContent).not.toContain('invoking remote method')
  })

  it('collapses into a rail and expands again', async () => {
    const container = await renderPanel()
    const collapse = container.querySelector<HTMLButtonElement>('[aria-label="Collapse files"]')

    await act(async () => {
      collapse?.click()
    })
    expect(container.querySelector('[role="tree"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Expand files"]')?.click()
    })
    expect(container.querySelector('[role="tree"]')).not.toBeNull()
  })

  it('labels the panel Files and opens the root in File Explorer', async () => {
    const container = await renderPanel()
    expect(container.querySelector('[data-testid="file-tree-panel"]')?.textContent).toContain('Files')
    expect(container.querySelector('[aria-label="Open folder in VS Code"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open folder in File Explorer"]')?.click()
    })
    expect(reveal).toHaveBeenCalledWith('session-1')
  })

  it('opens a WSL session root in VS Code on Windows', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, wslAvailable: true })
    const container = await renderPanel({ ...session, kind: 'wsl', distro: 'Ubuntu-24.04' })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open folder in VS Code"]')?.click()
    })
    expect(openInVsCode).toHaveBeenCalledWith('session-1')
  })
})
