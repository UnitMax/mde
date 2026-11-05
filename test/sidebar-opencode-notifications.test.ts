// @vitest-environment happy-dom
import { testLayout } from './helpers/terminal-layout'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeTuiInstanceStatus, Project, Session } from '../src/shared/types'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { SessionSwitcher } from '../src/renderer/components/SessionSwitcher'
import { useWorkspace } from '../src/renderer/store/workspace'
import { sessionTabs } from '../src/renderer/terminal/tabs'
import { TERMINAL_SETTINGS_STORAGE_KEY } from '../src/renderer/terminal/terminal-settings'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

const project: Project = {
  id: 'project-1',
  name: 'Workspace',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const session: Session = {
  id: 'session-1',
  projectId: project.id,
  name: 'Frontend',
  kind: 'native',
  path: '/workspace/frontend',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const instances: OpenCodeTuiInstanceStatus[] = [
  { terminalId: 'session-1:agent:1', status: 'completed', revision: 4 },
  { terminalId: 'session-1:agent:2', status: 'attention', attentionReason: 'permission', revision: 2 },
  { terminalId: 'session-1:agent:3', status: 'working', revision: 3 }
]

function resetWorkspace(sidebarCollapsed = false): void {
  useWorkspace.setState({
    projects: [project],
    todoProjects: [],
    todoTasks: [],
    sessions: [session],
    selectedSessionId: 'other-session',
    selectedTodoProjectId: null,
    activeWorkspaceView: 'projects',
    statuses: {},
    terminalDirectories: {},
    exits: {},
    opencodeTuiStatuses: {},
    opencodeTuiInstances: { [session.id]: instances },
    opencodeTuiReadRevisions: {},
    sidebarCollapsed,
    ready: false
  })
}

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(element))
  return container
}

function sidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}): React.ReactElement {
  return createElement(Sidebar, {
    onNewProject: vi.fn(),
    onNewTodoProject: vi.fn(),
    onNewTodoTask: vi.fn(),
    onNewSession: vi.fn(),
    terminalLayouts: {},
    onFocusTerminal: vi.fn(),
    ...overrides
  })
}

describe('OpenCode notification badges in navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    resetWorkspace()
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('places the per-session count immediately before Session actions', () => {
    const container = render(sidebar())
    const row = container.querySelector('[data-testid="session-row"]')
    const badge = row?.querySelector('[data-testid="opencode-notification-count"]')
    const actions = row?.querySelector('button[title="Session actions"]')

    expect(badge?.textContent).toBe('2')
    expect(badge?.nextElementSibling).toBe(actions)
  })

  it('keeps the count visible on collapsed session icons', () => {
    resetWorkspace(true)
    const container = render(sidebar())
    const badge = container.querySelector('[data-testid="opencode-notification-count"]')

    expect(badge?.textContent).toBe('2')
    expect(badge?.parentElement?.getAttribute('aria-label')).toBe('Workspace: Frontend')
  })

  it('shows the same per-session count in the Ctrl+O switcher', () => {
    render(
      createElement(SessionSwitcher, { open: true, onOpenChange: vi.fn() })
    )
    const result = document.querySelector('[data-testid="session-switcher-result"]')
    const badge = document.querySelector('[data-testid="opencode-notification-count"]')

    expect(result?.textContent).toContain('Frontend')
    expect(badge?.textContent).toBe('2')
    expect(badge?.getAttribute('aria-label')).toBe('2 OpenCode agents finished or need attention')
  })

  it.each(['completed', 'error'] as const)('shows unread %s results until the session is viewed', (status) => {
    useWorkspace.setState({
      opencodeTuiStatuses: { [session.id]: { status, revision: 4, unread: true } }
    })
    const container = render(sidebar())
    const indicator = (): Element | null => container.querySelector('[data-testid="session-status"]')

    expect(indicator()?.getAttribute('data-status')).toBe(status)
    act(() => useWorkspace.getState().selectSession(session.id))

    expect(indicator()?.getAttribute('data-status')).toBe('idle')
    expect(indicator()?.getAttribute('title')).toBe('OpenCode idle')
    expect(container.querySelector('[data-testid="opencode-notification-count"]')?.textContent).toBe('1')
  })

  it.each(['permission', 'question'] as const)('keeps unresolved %s requests visible after viewing the session', (attentionReason) => {
    useWorkspace.setState({
      opencodeTuiStatuses: {
        [session.id]: { status: 'attention', attentionReason, revision: 2, unread: false }
      },
      opencodeTuiInstances: {
        [session.id]: [{ terminalId: session.id, status: 'attention', attentionReason, revision: 2 }]
      }
    })
    const container = render(sidebar())
    act(() => useWorkspace.getState().selectSession(session.id))
    const indicator = container.querySelector('[data-testid="session-status"]')

    expect(indicator?.getAttribute('data-status')).toBe('attention')
    expect(indicator?.getAttribute('title')).toBe(attentionReason === 'question'
      ? 'OpenCode is asking a question'
      : 'OpenCode is waiting for permission')
    expect(container.querySelector('[data-testid="opencode-notification-count"]')?.textContent).toBe('1')
  })

  it('uses ordinary shell status when agent reporting is absent', () => {
    const tab = sessionTabs(session)[0]!
    useWorkspace.setState({ statuses: { [session.id]: 'running' }, opencodeTuiInstances: {} })
    const container = render(sidebar({
      terminalLayouts: {
        [session.id]: {
          [tab.id]: testLayout([{ terminalId: session.id }])
        }
      }
    }))

    expect(container.querySelector('[data-testid="session-status"]')?.getAttribute('data-status')).toBe('running')
    expect(container.querySelector('[data-testid="opencode-notification-count"]')).toBeNull()
  })

  it('includes OpenCode panes in the terminal list when terminal instances are enabled', () => {
    const tab = sessionTabs(session)[0]!
    const onFocusTerminal = vi.fn()
    localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify({ showTerminalInstances: true }))
    const container = render(sidebar({
      onFocusTerminal,
      terminalLayouts: {
        [session.id]: {
          [tab.id]: testLayout([instances[2]!, instances[0]!, instances[1]!].map(({ terminalId }) => ({ terminalId })))
        }
      }
    }))
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-testid="terminal-instances"] button')

    expect(rows).toHaveLength(3)
    expect(Array.from(rows, (row) => row.textContent)).toEqual([
      'Terminal 1Tab 1',
      'Terminal 2Tab 1',
      'Terminal 3Tab 1',
    ])
    act(() => rows[1]!.click())
    expect(onFocusTerminal).toHaveBeenCalledWith(session.id, tab.id, instances[0]!.terminalId)
  })
})
