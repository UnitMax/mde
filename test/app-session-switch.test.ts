// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import { App } from '../src/renderer/App'
import { useWorkspace } from '../src/renderer/store/workspace'

vi.mock('../src/renderer/terminal/sessions', () => {
  const term = { focus: vi.fn(), reset: vi.fn(), buffer: { active: { type: 'normal' } } }
  return {
    attachSession: () => ({ term, container: document.createElement('div') }),
    detachSession: vi.fn(),
    fitSession: () => null,
    getSession: () => ({ term, container: document.createElement('div') }),
    disposeSession: vi.fn(),
    applyTerminalSettings: vi.fn(),
    applyTerminalTheme: vi.fn(),
    initTerminalBridge: vi.fn()
  }
})
vi.mock('../src/renderer/components/TerminalGitInfo', () => ({ TerminalGitInfo: () => null }))

/** A `window.api` whose every call resolves to nothing, with the calls the screen reads answered. */
function stubApi(): unknown {
  const answers: Record<string, unknown> = {
    'files.list': { entries: [], truncated: false },
    'files.read': { path: 'README.md', content: '# Notes\n', size: 8, binary: false, tooLarge: false }
  }
  const call = (name: string) => () => {
    const result = (() => undefined) as unknown as { then: (resolve: (value: unknown) => unknown) => Promise<unknown> }
    result.then = (resolve) => Promise.resolve(answers[name]).then(resolve)
    return result
  }
  return new Proxy({}, {
    get: (_, namespace: string) => new Proxy({}, { get: (_target, method: string) => call(`${namespace}.${method}`) })
  })
}

const roots: Root[] = []

function session(id: string, name: string, paneCount: number): Session {
  return {
    id, projectId: 'project-1', name, kind: 'native', path: `/home/me/${name.toLowerCase()}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    tabs: [{
      id: `${id}-tab`, name: 'Tab 1',
      layout: {
        layout: paneCount === 4 ? 'quadrant' : 'columns',
        panes: Array.from({ length: paneCount }, (_, index) => ({ id: `pane-${index + 1}` })),
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }],
    activeTabId: `${id}-tab`
  }
}

const alpha = session('alpha', 'Alpha', 4)
const beta = session('beta', 'Beta', 2)

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(App)))
  return container
}

const select = (id: string): Promise<void> => act(async () => useWorkspace.getState().selectSession(id))
const paneCount = (): number => document.querySelectorAll('[data-terminal-pane-slot]').length
const viewerPath = (): string | null =>
  document.querySelector('[data-testid="file-viewer"] [title]')?.getAttribute('title') ?? null

describe('switching sessions with a file open', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', { configurable: true, value: stubApi() })
    useWorkspace.setState({
      init: async () => undefined,
      ready: true,
      platform: { platform: 'linux', isWindows: false },
      projects: [{ id: 'project-1', name: 'Demo', createdAt: '2026-01-01T00:00:00.000Z' }],
      sessions: [alpha, beta],
      selectedSessionId: 'alpha',
      activeWorkspaceView: 'projects',
      openFiles: { alpha: 'README.md' },
      statuses: {}, exits: {}, terminalDirectories: {}, terminalTaskLinks: {},
      opencodeTuiInstances: {}, opencodeTuiStatuses: {}
    })
  })

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
  })

  it('shows only the selected session\'s terminals after the switch', async () => {
    await render()
    await act(async () => {})
    expect(paneCount()).toBe(4)
    expect(viewerPath()).toBe('README.md')

    await select('beta')
    expect(paneCount()).toBe(2)
    expect(viewerPath()).toBeNull()

    await select('alpha')
    expect(paneCount()).toBe(4)
    expect(viewerPath()).toBe('README.md')
  })
})
