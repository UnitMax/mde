// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { useWorkspace } from '../src/renderer/store/workspace'

vi.mock('../src/renderer/components/InboxPanel', () => ({ InboxPanel: () => createElement('div', { 'data-testid': 'inbox-panel' }) }))

const native: Session = { id: 'native', name: 'Tools', kind: 'native', createdAt: '' }
const wsl: Session = { id: 'wsl', name: 'Build', kind: 'wsl', distro: 'Ubuntu-24.04', createdAt: '' }
let root: Root
let container: HTMLDivElement
const onNewSession = vi.fn()
const selectSession = vi.fn()
const reorderSession = vi.fn(async () => undefined)

function render(): void {
  act(() => root.render(createElement(Sidebar, {
    onNewSession,
    onNewTodoProject: vi.fn(),
    onNewTodoTask: vi.fn(),
    onFocusTerminal: vi.fn(),
    terminalLayouts: {},
  })))
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="session-row"]'))
}

describe('Sessions sidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    localStorage.clear()
    useWorkspace.setState({
      sessions: [native, wsl], activeWorkspaceView: 'sessions', sidebarCollapsed: false,
      selectedSessionId: native.id, terminalDirectories: {}, inboxThreads: [],
      selectSession, reorderSession,
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('lists sessions in saved order with runtime and distribution visible', () => {
    render()
    expect(rows().map((row) => row.querySelector('[data-testid="session-name"]')?.textContent)).toEqual(['Tools', 'Build'])
    expect(rows()[0]?.querySelector('[data-testid="session-environment"]')?.textContent).toBe('Native')
    expect(rows()[1]?.querySelector('[data-testid="session-environment"]')?.textContent).toBe('WSLUbuntu-24.04')
    act(() => rows()[1]!.click())
    expect(selectSession).toHaveBeenCalledWith(wsl.id)
  })

  it('offers session creation with an empty workspace', () => {
    useWorkspace.setState({ sessions: [], selectedSessionId: null })
    render()
    expect(container.textContent).toContain('No sessions yet.')
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === 'New session')!
    act(() => button.click())
    expect(onNewSession).toHaveBeenCalledOnce()
  })

  it('keeps environment details accessible when collapsed', () => {
    useWorkspace.setState({ sidebarCollapsed: true })
    render()
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Build · WSL · Ubuntu-24.04"]')!
    expect(button.title).toBe('Build · WSL · Ubuntu-24.04')
    act(() => button.click())
    expect(selectSession).toHaveBeenCalledWith(wsl.id)
  })

  it('keeps the toggle next to session creation and expands other sections', () => {
    render()
    const collapse = container.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')!
    expect(collapse.parentElement?.querySelector('[aria-label="New session"]')).not.toBeNull()
    act(() => collapse.click())
    expect(container.querySelector('[aria-label="Expand sidebar"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="collapsed-session-label"]')).not.toBeNull()
    act(() => useWorkspace.setState({ activeWorkspaceView: 'todo' }))
    expect(container.querySelector('aside')?.className).toContain('w-[260px]')
    expect(container.querySelector('[aria-label="New task"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Expand sidebar"]')).toBeNull()
    act(() => useWorkspace.setState({ activeWorkspaceView: 'inbox' }))
    expect(container.querySelector('[data-testid="inbox-panel"]')).not.toBeNull()
    expect(container.querySelector('aside')?.className).toContain('w-[260px]')
    expect(container.querySelector('[aria-label="Expand sidebar"]')).toBeNull()
    act(() => useWorkspace.setState({ activeWorkspaceView: 'sessions' }))
    expect(container.querySelector('[aria-label="Expand sidebar"]')).not.toBeNull()
  })

  it('reorders sessions across the whole list', async () => {
    render()
    const target = rows()[0]!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40 } as DOMRect)
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => wsl.id } })
    await act(async () => target.dispatchEvent(drop))
    expect(reorderSession).toHaveBeenCalledWith(wsl.id, native.id)
  })
})
