// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INBOX_TERMINAL_LAYOUT_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import type { PtyExitInfo } from '../src/shared/types'

const dispose = vi.fn((_terminalId: string) => {})
const focus = vi.fn((_terminalId: string) => () => {})
vi.mock('../src/renderer/terminal/dispose', () => ({ disposeRuntimeTerminal: (id: string) => dispose(id) }))
vi.mock('../src/renderer/terminal/focus', () => ({ focusTerminalWhenReady: (id: string) => focus(id) }))

const ID = (pane: number): string => `inbox-terminal:tab:inbox-terminal:tab:default:pane:pane-${pane}`
const stored = (): unknown => JSON.parse(localStorage.getItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY) ?? 'null')
const exit = (terminalId: string, sessionId = 'inbox-terminal'): PtyExitInfo => ({ terminalId, sessionId, exitCode: 0 }) as PtyExitInfo

async function load() {
  vi.resetModules()
  const { useInboxTerminal } = await import('../src/renderer/store/inbox-terminal')
  return useInboxTerminal
}

beforeEach(() => {
  localStorage.clear()
  dispose.mockClear()
  focus.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the Inbox terminal store', () => {
  it('starts as one terminal whose ID belongs to the Inbox terminal session', async () => {
    const store = await load()
    expect(store.getState().layout.tree).toEqual({ type: 'pane', paneId: 'pane-1' })
    expect(store.getState().layout.panes).toEqual([{ terminalId: ID(1), paneId: 'pane-1' }])
  })

  it('splits on a chosen side, focuses the new pane and stores only the arrangement', async () => {
    const store = await load()
    store.getState().titlePane(ID(1), 'private title')
    store.getState().splitPane(ID(1), 'top')
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(2), ID(1)])
    expect(focus).toHaveBeenCalledWith(ID(2))
    expect(stored()).toEqual({ tree: store.getState().layout.tree })
    expect(JSON.stringify(stored())).not.toContain('private title')
    expect(JSON.stringify(stored())).not.toContain(ID(1))
  })

  it('saves a divider after it settles, not at every step of a drag', async () => {
    const store = await load()
    store.getState().splitPane(ID(1), 'right')
    const tree = store.getState().layout.tree
    if (tree.type !== 'split') throw new Error('Expected split')
    store.getState().resize(tree.id, 0.3)
    store.getState().resize(tree.id, 0.35)
    expect(store.getState().layout.tree).toMatchObject({ ratio: 0.35 })
    expect(stored()).toMatchObject({ tree: { ratio: 0.5 } })
    await vi.advanceTimersByTimeAsync(200)
    expect(stored()).toMatchObject({ tree: { ratio: 0.35 } })
  })

  it('restores the saved arrangement with fresh shells and stable pane IDs', async () => {
    const tree = { type: 'split', id: 'split', axis: 'row', ratio: 0.3, first: { type: 'pane', paneId: 'pane-2' }, second: { type: 'pane', paneId: 'pane-1' } }
    localStorage.setItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY, JSON.stringify({ tree }))
    const store = await load()
    expect(store.getState().layout.tree).toEqual(tree)
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(2), ID(1)])
    expect(store.getState().layout.panes.every((pane) => !pane.exited)).toBe(true)
  })

  it.each(['{', 'null', JSON.stringify({ layout: 'columns', sizes: {} }), JSON.stringify({ tree: { type: 'pane' } })])('starts with one terminal for an invalid or old layout: %s', async (raw) => {
    localStorage.setItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY, raw)
    const store = await load()
    expect(store.getState().layout.tree).toEqual({ type: 'pane', paneId: 'pane-1' })
  })

  it('closes a pane, expands its sibling and keeps the last pane available', async () => {
    const store = await load()
    store.getState().splitPane(ID(1), 'right')
    store.getState().paneFocused(ID(1))
    store.getState().closePane(ID(1))
    expect(dispose).toHaveBeenCalledWith(ID(1))
    expect(focus).toHaveBeenLastCalledWith(ID(2))
    expect(store.getState().layout.tree).toEqual({ type: 'pane', paneId: 'pane-2' })
    store.getState().closePane(ID(2))
    expect(store.getState().layout.panes).toHaveLength(1)
  })

  it('keeps the title of a pane, reorders panes, and ignores an order that is not one', async () => {
    const store = await load()
    store.getState().splitPane(ID(1), 'right')
    store.getState().titlePane(ID(2), 'server')
    expect(store.getState().layout.panes[1]!.title).toBe('server')
    store.getState().reorder([ID(2), ID(1)])
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(2), ID(1)])
    store.getState().reorder([ID(2)])
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(2), ID(1)])
  })

  describe('when a shell ends', () => {
    it('ignores terminals of other sessions', async () => {
      const store = await load()
      store.getState().paneExited(exit(ID(1), 'ses-1'))
      expect(store.getState().layout.panes[0]!.exited).toBeUndefined()
    })

    it('keeps the last terminal, marked as ended so it can be restarted', async () => {
      const store = await load()
      store.getState().paneExited(exit(ID(1)))
      expect(store.getState().layout.panes).toEqual([{ terminalId: ID(1), paneId: 'pane-1', exited: true }])
      expect(dispose).not.toHaveBeenCalled()
    })

    it('removes an ended pane and expands its sibling', async () => {
      const store = await load()
      store.getState().splitPane(ID(1), 'right')
      store.getState().paneFocused(ID(2))
      store.getState().paneExited(exit(ID(2)))
      expect(dispose).toHaveBeenCalledWith(ID(2))
      expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1)])
      expect(focus).toHaveBeenCalledWith(ID(1))
    })

    it('hears about ends once the store is started, and stops when told to', async () => {
      const store = await load()
      const stop = vi.fn()
      const onExit = vi.fn((_listener: (info: PtyExitInfo) => void) => stop)
      vi.stubGlobal('api', { pty: { onExit } })
      store.getState().splitPane(ID(1), 'right')
      const unsubscribe = store.getState().init()
      onExit.mock.calls[0]![0](exit(ID(2)))
      expect(store.getState().layout.panes).toHaveLength(1)
      unsubscribe()
      expect(stop).toHaveBeenCalled()
    })
  })
})
