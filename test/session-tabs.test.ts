import { testLayout } from './helpers/terminal-layout'
import { describe, expect, it } from 'vitest'
import type { Session } from '../src/shared/types'
import {
  activeSessionTab,
  createRuntimeLayout,
  nextPaneId,
  persistRuntimeLayout,
  sessionTabs,
  tabCloseSelection,
  terminalIdForPane
} from '../src/renderer/terminal/tabs'

const session: Session = {
  id: 'session-1',
  name: 'App',
  kind: 'native',
  createdAt: '2026-01-01T00:00:00.000Z',
  tabs: [
    {
      id: 'tab-1',
      name: 'Tab 1',
      layout: testLayout([
        { id: 'pane-1' },
        { id: 'pane-2' }
      ], 0.35)
    },
    {
      id: 'tab-2',
      name: 'Tab 2',
      layout: testLayout([{ id: 'pane-1' }])
    }
  ],
  activeTabId: 'tab-2'
}

describe('session tab runtime helpers', () => {
  it('uses stable tab and pane identities without sharing terminal IDs', () => {
    expect(terminalIdForPane(session.id, 'tab-1', 'pane-1')).toBe('session-1:tab:tab-1:pane:pane-1')
    expect(terminalIdForPane(session.id, 'tab-1', 'pane-1')).not.toBe(
      terminalIdForPane(session.id, 'tab-2', 'pane-1')
    )

    const layout = createRuntimeLayout(session.id, session.tabs![0]!)
    expect(layout.panes[0]).toMatchObject({
      terminalId: 'session-1:tab:tab-1:pane:pane-1',
      paneId: 'pane-1'
    })
    expect(persistRuntimeLayout(layout)).toEqual(session.tabs![0]!.layout)
  })

  it('preserves custom pane titles through runtime conversion', () => {
    const titledTab = {
      ...session.tabs![0]!,
      layout: {
        ...session.tabs![0]!.layout,
        panes: [
          { id: 'pane-1', title: 'Shell' },
          { id: 'pane-2' }
        ]
      }
    }

    const runtimeLayout = createRuntimeLayout(session.id, titledTab)

    expect(runtimeLayout.panes[0]).toMatchObject({ title: 'Shell' })
    expect(persistRuntimeLayout(runtimeLayout)).toEqual(titledTab.layout)
  })

  it('skips persisted split-pane keys when allocating a new runtime pane', () => {
    const layout = createRuntimeLayout(session.id, session.tabs![0]!)

    expect(nextPaneId(layout.panes)).toBe('pane-3')
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

  it('keeps nested splits and divider ratios stable through runtime conversion', () => {
    const tab = { ...session.tabs![0]!, layout: testLayout(Array.from({ length: 12 }, (_, index) => ({ id: `pane-${index}` })), 0.35) }
    const runtime = createRuntimeLayout(session.id, tab)
    expect(runtime.panes).toHaveLength(12)
    expect(persistRuntimeLayout(runtime)).toEqual(tab.layout)
  })
})
