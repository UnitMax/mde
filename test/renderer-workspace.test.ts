import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OpenCodeTuiInstancesUpdate,
  OpenCodeTuiStatusUpdate,
  Session
} from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { useWorkspace } from '../src/renderer/store/workspace'

describe('renderer workspace event bridge', () => {
  const tuiStatusListeners: Array<(update: OpenCodeTuiStatusUpdate) => void> = []
  const tuiInstanceListeners: Array<(update: OpenCodeTuiInstancesUpdate) => void> = []
  const directoryListeners: Array<(update: { terminalId: string; directory: string | null }) => void> = []
  const api = {
    platform: { info: vi.fn(async () => ({ platform: 'linux', arch: 'x64' })) },
    workspace: { list: vi.fn(async () => ({ projects: [], sessions: [] })) },
    sessions: {
      create: vi.fn(),
      duplicate: vi.fn(),
      update: vi.fn(async ({ id, patch }: { id: string; patch: Partial<Session> }) => ({
        id,
        projectId: 'project-1',
        name: 'App',
        kind: 'native' as const,
        path: '/workspace/app',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...patch
      })),
      reorder: vi.fn()
    },
    tabs: {
      create: vi.fn(),
      select: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    },
    pty: {
      statuses: vi.fn(async () => ({})),
      directories: vi.fn(async () => ({})),
      onExit: vi.fn(() => vi.fn()),
      onDirectory: vi.fn((listener: (update: { terminalId: string; directory: string | null }) => void) => {
        directoryListeners.push(listener)
        return vi.fn()
      })
    },
    wsl: {
      available: vi.fn(async () => false),
      distros: vi.fn(async () => [])
    },
    opencodeTui: {
      settings: vi.fn(async () => ({
        enabled: false,
        currentPluginVersion: '1.1.0',
        instanceLabelMode: 'numbered' as const
      })),
      setEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
        enabled,
        currentPluginVersion: '1.1.0',
        instanceLabelMode: 'numbered' as const
      })),
      setInstanceLabelMode: vi.fn(async ({ mode }: { mode: 'numbered' | 'title' }) => ({
        enabled: false,
        currentPluginVersion: '1.1.0',
        instanceLabelMode: mode
      })),
      pluginState: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'not-installed' as const,
        installedVersion: null,
        currentVersion: '1.0.0'
      })),
      install: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'installed' as const,
        installedVersion: '1.0.0',
        currentVersion: '1.0.0'
      })),
      remove: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'not-installed' as const,
        installedVersion: null,
        currentVersion: '1.0.0'
      })),
      onStatus: vi.fn((listener: (update: OpenCodeTuiStatusUpdate) => void) => {
        tuiStatusListeners.push(listener)
        return vi.fn()
      }),
      onInstances: vi.fn((listener: (update: OpenCodeTuiInstancesUpdate) => void) => {
        tuiInstanceListeners.push(listener)
        return vi.fn()
      })
    },
  }

  beforeEach(() => {
    tuiStatusListeners.length = 0
    tuiInstanceListeners.length = 0
    directoryListeners.length = 0
    vi.stubGlobal('window', { api })
    useWorkspace.setState({
      opencodeTuiStatuses: {},
      opencodeTuiInstances: {},
      opencodeTuiInstanceLabelMode: 'numbered',
      sessions: [],
      selectedSessionId: null
    })
    api.pty.onExit.mockClear()
    api.sessions.create.mockReset()
    api.sessions.duplicate.mockReset()
    api.sessions.update.mockClear()
    api.sessions.reorder.mockReset()
    api.tabs.create.mockReset()
    api.tabs.select.mockReset()
    api.tabs.update.mockReset()
    api.tabs.remove.mockReset()
    api.opencodeTui.onStatus.mockClear()
    api.opencodeTui.onInstances.mockClear()
    api.opencodeTui.setInstanceLabelMode.mockClear()
  })

  it('tracks exits by runtime terminal ID, including split panes', () => {
    useWorkspace.setState({ statuses: {}, exits: {} })

    useWorkspace.getState().noteExit({
      sessionId: 'session-1',
      terminalId: 'session-1:split:1',
      exitCode: 0
    })
    expect(useWorkspace.getState().statuses).toEqual({ 'session-1:split:1': 'exited' })
    expect(useWorkspace.getState().exits['session-1:split:1']).toMatchObject({ exitCode: 0 })

    useWorkspace.getState().noteExit({ sessionId: 'session-1', terminalId: 'session-1', exitCode: 1 })
    expect(useWorkspace.getState().statuses['session-1']).toBe('exited')
    expect(useWorkspace.getState().exits['session-1']).toMatchObject({ exitCode: 1 })
  })

  it('keeps split terminal statuses addressable by runtime terminal ID', () => {
    useWorkspace.setState({ statuses: {} })

    useWorkspace.getState().setStatus('session-1', 'running')
    useWorkspace.getState().setStatus('session-1:split:1', 'running')

    expect(useWorkspace.getState().statuses).toEqual({
      'session-1': 'running',
      'session-1:split:1': 'running'
    })
  })

  it('tracks TUI completion as unread until the session is selected', () => {
    useWorkspace.setState({ selectedSessionId: 'other-session', opencodeTuiStatuses: {} })

    useWorkspace.getState().appendOpenCodeTuiStatus({
      sessionId: 'terminal-1',
      status: 'completed',
      revision: 1
    })
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']).toMatchObject({
      status: 'completed',
      unread: true
    })

    useWorkspace.getState().selectSession('terminal-1')
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']?.unread).toBe(false)

    useWorkspace.getState().appendOpenCodeTuiStatus({
      sessionId: 'terminal-1',
      status: null,
      revision: 0
    })
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']).toBeUndefined()
  })

  it('tracks and removes independent OpenCode TUI pane instances', () => {
    useWorkspace.getState().appendOpenCodeTuiInstances({
      sessionId: 'session-1',
      instances: [
        {
          terminalId: 'session-1',
          status: 'working',
          title: 'Checkout flow',
          revision: 2
        },
        {
          terminalId: 'session-1:split:1',
          status: 'completed',
          revision: 4
        }
      ]
    })

    expect(useWorkspace.getState().opencodeTuiInstances['session-1']).toEqual([
      {
        terminalId: 'session-1',
        status: 'working',
        title: 'Checkout flow',
        revision: 2
      },
      {
        terminalId: 'session-1:split:1',
        status: 'completed',
        revision: 4
      }
    ])

    useWorkspace.getState().appendOpenCodeTuiInstances({
      sessionId: 'session-1',
      instances: []
    })
    expect(useWorkspace.getState().opencodeTuiInstances['session-1']).toBeUndefined()
  })

  it('persists the global OpenCode TUI instance label mode', async () => {
    await useWorkspace.getState().setOpenCodeTuiInstanceLabelMode('title')

    expect(api.opencodeTui.setInstanceLabelMode).toHaveBeenCalledWith({ mode: 'title' })
    expect(useWorkspace.getState().opencodeTuiInstanceLabelMode).toBe('title')
  })

  it('creates and selects a terminal session', async () => {
    api.sessions.create.mockResolvedValue({
      id: 'terminal-session',
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    })

    const session = await useWorkspace.getState().addSession({
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })

    expect(api.sessions.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })
    expect(session.id).toBe('terminal-session')
    expect(useWorkspace.getState().selectedSessionId).toBe('terminal-session')
  })

  it('appends and selects a duplicated session returned by the main process', async () => {
    const source: Session = {
      id: 'terminal-1',
      projectId: 'project-1',
      name: 'App',
      color: 'teal',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      shell: '/bin/zsh',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const duplicate: Session = {
      ...source,
      id: 'terminal-2',
      name: 'App (copy)',
      createdAt: '2026-01-02T00:00:00.000Z'
    }
    useWorkspace.setState({ sessions: [source] })
    api.sessions.duplicate.mockResolvedValue(duplicate)

    const result = await useWorkspace.getState().duplicateSession(source.id)

    expect(api.sessions.duplicate).toHaveBeenCalledWith(source.id)
    expect(result).toEqual(duplicate)
    expect(useWorkspace.getState().sessions).toEqual([source, duplicate])
    expect(useWorkspace.getState().selectedSessionId).toBe(duplicate.id)
  })

  it('creates and selects a tab returned by the main process', async () => {
    const firstTab = {
      id: 'tab-1',
      name: 'Tab 1',
      layout: {
        layout: 'single' as const,
        panes: [{ id: 'primary', primary: true }],
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }
    const secondTab = { ...firstTab, id: 'tab-2', name: 'Tab 2' }
    const session: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z',
      tabs: [firstTab],
      activeTabId: firstTab.id
    }
    const withSecondTab = { ...session, tabs: [firstTab, secondTab], activeTabId: secondTab.id }
    useWorkspace.setState({ sessions: [session] })
    api.tabs.create.mockResolvedValue(withSecondTab)

    const created = await useWorkspace.getState().addTab(session.id)

    expect(api.tabs.create).toHaveBeenCalledWith({ sessionId: session.id })
    expect(created).toEqual(withSecondTab)
    expect(useWorkspace.getState().sessions[0]).toEqual(withSecondTab)

    const selected = { ...withSecondTab, activeTabId: firstTab.id }
    api.tabs.select.mockResolvedValue(selected)
    await useWorkspace.getState().selectTab(session.id, firstTab.id)

    expect(api.tabs.select).toHaveBeenCalledWith({ sessionId: session.id, tabId: firstTab.id })
    expect(useWorkspace.getState().sessions[0]?.activeTabId).toBe(firstTab.id)
  })

  it('persists and updates a session color', async () => {
    const session: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    useWorkspace.setState({ sessions: [session] })
    api.sessions.update.mockResolvedValueOnce({ ...session, color: 'teal' })

    await useWorkspace.getState().setSessionColor('session-1', 'teal')

    expect(api.sessions.update).toHaveBeenCalledWith({
      id: 'session-1',
      patch: { color: 'teal' }
    })
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ id: 'session-1', color: 'teal' })
  })

  it('persists and updates a session icon', async () => {
    const session: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    useWorkspace.setState({ sessions: [session] })
    api.sessions.update.mockResolvedValueOnce({ ...session, icon: 'robot' })

    await useWorkspace.getState().setSessionIcon('session-1', 'robot')

    expect(api.sessions.update).toHaveBeenCalledWith({
      id: 'session-1',
      patch: { icon: 'robot' }
    })
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ id: 'session-1', icon: 'robot' })

    api.sessions.update.mockResolvedValueOnce(session)
    await useWorkspace.getState().setSessionIcon('session-1', null)

    expect(api.sessions.update).toHaveBeenLastCalledWith({
      id: 'session-1',
      patch: { icon: null }
    })
    expect(useWorkspace.getState().sessions[0]?.icon).toBeUndefined()
  })

  it('persists and applies a reordered session list without changing selection', async () => {
    const first: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'First',
      kind: 'native',
      path: '/workspace/first',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const second: Session = { ...first, id: 'session-2', name: 'Second' }
    const otherProject: Session = { ...first, id: 'session-3', projectId: 'project-2', name: 'Other' }
    const reordered = [second, otherProject, first]
    useWorkspace.setState({ sessions: [first, second, otherProject], selectedSessionId: first.id })
    api.sessions.reorder.mockResolvedValue(reordered)

    await useWorkspace.getState().reorderSession(first.id, second.id)

    expect(api.sessions.reorder).toHaveBeenCalledWith({ id: first.id, beforeId: second.id })
    expect(useWorkspace.getState().sessions).toEqual(reordered)
    expect(useWorkspace.getState().selectedSessionId).toBe(first.id)
  })

  it('leaves the session list unchanged when reorder is rejected', async () => {
    const session: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    useWorkspace.setState({ sessions: [session] })
    api.sessions.reorder.mockResolvedValue(null)

    await useWorkspace.getState().reorderSession(session.id, null)

    expect(useWorkspace.getState().sessions).toEqual([session])
  })

  it('keeps session colors unchanged when OpenCode status events arrive', () => {
    const session: Session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      color: 'teal',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    useWorkspace.setState({ sessions: [session], selectedSessionId: 'other-session' })

    useWorkspace.getState().appendOpenCodeTuiStatus({
      sessionId: 'session-1',
      status: 'attention',
      revision: 1
    })

    expect(useWorkspace.getState().sessions).toEqual([session])
    expect(useWorkspace.getState().opencodeTuiStatuses['session-1']).toMatchObject({
      status: 'attention'
    })
  })

  it('registers process-lifetime push listeners only once', async () => {
    api.pty.directories.mockResolvedValueOnce({
      'session-1:snapshot': '/home/me/snapshot'
    })
    await Promise.all([useWorkspace.getState().init(), useWorkspace.getState().init()])

    expect(api.pty.onExit).toHaveBeenCalledTimes(1)
    expect(api.pty.onDirectory).toHaveBeenCalledTimes(1)
    expect(api.opencodeTui.onStatus).toHaveBeenCalledTimes(1)
    expect(api.opencodeTui.onInstances).toHaveBeenCalledTimes(1)
    expect(useWorkspace.getState().terminalDirectories).toEqual({
      'session-1:snapshot': '/home/me/snapshot'
    })

    directoryListeners[0]?.({ terminalId: 'session-1:split:1', directory: '/home/me/app' })
    expect(useWorkspace.getState().terminalDirectories).toEqual({
      'session-1:snapshot': '/home/me/snapshot',
      'session-1:split:1': '/home/me/app'
    })
    directoryListeners[0]?.({ terminalId: 'session-1:split:1', directory: null })
    expect(useWorkspace.getState().terminalDirectories).toEqual({
      'session-1:snapshot': '/home/me/snapshot'
    })
  })
})
