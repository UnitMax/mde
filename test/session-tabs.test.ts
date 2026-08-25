import { describe, expect, it } from 'vitest'
import type { Session } from '../src/shared/types'
import {
  activeSessionTab,
  createRuntimeLayout,
  persistRuntimeLayout,
  sessionTabs,
  tabCloseSelection,
  terminalIdForPane
} from '../src/renderer/terminal/tabs'

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'App',
  kind: 'native',
  path: '/workspace/app',
  createdAt: '2026-01-01T00:00:00.000Z',
  tabs: [
    {
      id: 'tab-1',
      name: 'Tab 1',
      layout: {
        layout: 'columns',
        panes: [
          { id: 'primary', primary: true },
          { id: 'pane-1', primary: false }
        ],
        sizes: { columnRatio: 0.35, rowRatio: 0.5 }
      }
    },
    {
      id: 'tab-2',
      name: 'Tab 2',
      layout: {
        layout: 'single',
        panes: [{ id: 'primary', primary: true }],
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }
  ],
  activeTabId: 'tab-2'
}

describe('session tab runtime helpers', () => {
  it('uses stable tab and pane identities without sharing terminal IDs', () => {
    expect(terminalIdForPane(session.id, 'tab-1', 'primary')).toBe('session-1:tab:tab-1:pane:primary')
    expect(terminalIdForPane(session.id, 'tab-1', 'primary')).not.toBe(
      terminalIdForPane(session.id, 'tab-2', 'primary')
    )

    const layout = createRuntimeLayout(session.id, session.tabs![0]!)
    expect(layout.panes[0]).toMatchObject({
      terminalId: 'session-1:tab:tab-1:pane:primary',
      paneId: 'primary',
      primary: true
    })
    expect(persistRuntimeLayout(layout)).toEqual(session.tabs![0]!.layout)
  })

  it('falls back to a default tab and restores the persisted active tab', () => {
    expect(sessionTabs({ ...session, tabs: undefined, activeTabId: undefined })[0]?.name).toBe('Tab 1')
    expect(activeSessionTab(session).id).toBe('tab-2')
  })

  it('selects the right neighbor, then the left neighbor, when closing the active tab', () => {
    expect(tabCloseSelection(session.tabs!, 'tab-1', 'tab-1')).toBe('tab-2')
    expect(tabCloseSelection(session.tabs!, 'tab-2', 'tab-2')).toBe('tab-1')
    expect(tabCloseSelection(session.tabs!.slice(0, 1), 'tab-1', 'tab-1')).toBeNull()
  })
})
