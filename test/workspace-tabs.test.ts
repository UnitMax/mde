import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  createSession,
  createSessionTab,
  initWorkspaceStore,
  loadWorkspace,
  removeSessionTab,
  selectSessionTab,
  updateSessionTab
} from '../src/main/store/workspace'

describe('workspace session tabs', () => {
  let storeDir: string

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(join(tmpdir(), 'mde-workspace-tabs-'))
    initWorkspaceStore(storeDir)
  })

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true })
  })

  it('creates, selects, updates, and persists independent tabs', async () => {
    const project = await createProject({ name: 'Work' })
    const session = await createSession({
      projectId: project.id,
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })

    expect(session.tabs).toHaveLength(1)
    expect(session.tabs?.[0]?.name).toBe('Tab 1')

    const withSecondTab = await createSessionTab({ sessionId: session.id })
    expect(withSecondTab?.tabs).toHaveLength(2)
    expect(withSecondTab?.tabs?.[1]?.name).toBe('Tab 2')
    expect(withSecondTab?.activeTabId).toBe(withSecondTab?.tabs?.[1]?.id)

    const firstTab = withSecondTab?.tabs?.[0]
    if (!firstTab) throw new Error('Expected first tab')
    const selected = await selectSessionTab({ sessionId: session.id, tabId: firstTab.id })
    expect(selected?.activeTabId).toBe(firstTab.id)

    const updated = await updateSessionTab({
      sessionId: session.id,
      tabId: firstTab.id,
      patch: {
        name: 'Shell',
        layout: {
          layout: 'columns',
          panes: [
            { id: 'primary', primary: true },
            { id: 'pane-1', primary: false }
          ],
          sizes: { columnRatio: 0.4, rowRatio: 0.5 }
        }
      }
    })
    expect(updated?.tabs?.[0]).toMatchObject({ name: 'Shell', layout: { layout: 'columns' } })

    const reloaded = await loadWorkspace()
    expect(reloaded.sessions[0]?.tabs?.[0]).toMatchObject({ name: 'Shell', layout: { layout: 'columns' } })
    expect(reloaded.sessions[0]?.activeTabId).toBe(firstTab.id)
  })

  it('selects the neighboring tab when removing the active tab and protects the final tab', async () => {
    const project = await createProject({ name: 'Work' })
    const session = await createSession({
      projectId: project.id,
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })
    const withTabs = await createSessionTab({ sessionId: session.id })
    const tabs = withTabs?.tabs ?? []
    const activeTabId = tabs[1]?.id
    if (!activeTabId) throw new Error('Expected second tab')

    const removed = await removeSessionTab({ sessionId: session.id, tabId: activeTabId })
    expect(removed?.tabs).toHaveLength(1)
    expect(removed?.activeTabId).toBe(tabs[0]?.id)
    expect(await removeSessionTab({ sessionId: session.id, tabId: tabs[0]?.id ?? '' })).toBeNull()
  })

  it('persists a six-pane layout with both column boundaries', async () => {
    const project = await createProject({ name: 'Work' })
    const session = await createSession({
      projectId: project.id,
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })
    const panes = [
      { id: 'primary', primary: true },
      { id: 'pane-1', primary: false },
      { id: 'pane-2', primary: false },
      { id: 'pane-3', primary: false },
      { id: 'pane-4', primary: false },
      { id: 'pane-5', primary: false }
    ]
    const updated = await updateSessionTab({
      sessionId: session.id,
      tabId: session.tabs?.[0]?.id ?? '',
      patch: {
        layout: {
          layout: 'sixGrid',
          panes,
          sizes: { columnRatio: 0.3, secondColumnRatio: 0.7, rowRatio: 0.4 }
        }
      }
    })

    expect(updated?.tabs?.[0]?.layout).toEqual({
      layout: 'sixGrid',
      panes,
      sizes: { columnRatio: 0.3, secondColumnRatio: 0.7, rowRatio: 0.4 }
    })
    await expect(loadWorkspace()).resolves.toMatchObject({
      sessions: [{ tabs: [{ layout: { layout: 'sixGrid' } }] }]
    })
  })
})
