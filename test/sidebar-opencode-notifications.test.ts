// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeTuiInstanceStatus, Project, Session } from '../src/shared/types'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { SessionSwitcher } from '../src/renderer/components/SessionSwitcher'
import { useWorkspace } from '../src/renderer/store/workspace'

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
    terminalTaskLinks: {},
    gitStatuses: {},
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

function sidebar(): React.ReactElement {
  return createElement(Sidebar, {
    onNewProject: vi.fn(),
    onNewTodoProject: vi.fn(),
    onNewTodoTask: vi.fn(),
    onNewSession: vi.fn(),
    onOpenGit: vi.fn(),
    terminalLayouts: {},
    onFocusTerminal: vi.fn()
  })
}

describe('OpenCode notification badges in navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    resetWorkspace()
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
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
})
