// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { useWorkspace } from '../src/renderer/store/workspace'
import { testLayout } from './helpers/terminal-layout'

vi.mock('../src/renderer/terminal/sessions', () => ({
  attachSession: () => ({ term: { focus: vi.fn() } }),
  detachSession: vi.fn(),
  fitSession: () => null,
  getSession: () => ({ term: { focus: vi.fn() } }),
}))
vi.mock('../src/renderer/components/TerminalGitInfo', () => ({ TerminalGitInfo: () => null }))

let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false }, wslAvailable: false,
    terminalDirectories: { 'source-pane': '/workspace/current' }, statuses: {}, exits: {},
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('opens the terminal launcher from a focused native Mac terminal with Cmd+N', async () => {
  await act(async () => root.render(createElement(TerminalView, {
    session: {
      id: 'workspace-1', name: 'App', kind: 'native',
      createdAt: '2026-01-01T00:00:00Z',
    },
    activeTab: { id: 'tab-1', name: 'Tab 1', layout: testLayout([{ id: 'pane-1' }]) },
    terminalLayout: testLayout([{ terminalId: 'source-pane' }]),
    onAddPane: vi.fn(), onSplitPane: vi.fn(), onLayoutResize: vi.fn(), onPaneOrderChange: vi.fn(),
    onClosePane: vi.fn(), onPaneFocus: vi.fn(), onPaneTitleChange: vi.fn(),
  })))
  const textarea = document.createElement('textarea')
  document.querySelector('.terminal-host')!.append(textarea)
  await act(async () => textarea.focus())
  const event = new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true, cancelable: true })
  await act(async () => textarea.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('[data-testid="terminal-launcher-opencode"]')?.disabled).toBe(false)
})
