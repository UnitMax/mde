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
    expect(store.getState().layout.layout).toBe('single')
    expect(store.getState().layout.panes).toEqual([{ terminalId: ID(1), paneId: 'pane-1' }])
  })

  it('grows to the chosen layout and keeps the arrangement for next time, and nothing else', async () => {
    const store = await load()
    store.getState().switchLayout('columns')
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1), ID(2)])
    expect(stored()).toEqual({ layout: 'columns', sizes: { columnRatio: 0.5, rowRatio: 0.5 } })
  })

  it('saves a divider after it settles, not at every step of a drag', async () => {
    const store = await load()
    store.getState().switchLayout('columns')
    store.getState().resize('column', 0.3)
    store.getState().resize('column', 0.35)
    expect(store.getState().layout.sizes.columnRatio).toBe(0.35)
    expect((stored() as { sizes: { columnRatio: number } }).sizes.columnRatio).toBe(0.5)
    await vi.advanceTimersByTimeAsync(200)
    expect((stored() as { sizes: { columnRatio: number } }).sizes.columnRatio).toBe(0.35)
  })

  it('comes back with the arrangement it was left in, one fresh terminal per pane', async () => {
    localStorage.setItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY, JSON.stringify({ layout: 'three', sizes: { columnRatio: 0.4, rowRatio: 0.6 } }))
    const store = await load()
    expect(store.getState().layout.layout).toBe('three')
    expect(store.getState().layout.panes).toHaveLength(3)
    expect(store.getState().layout.sizes).toMatchObject({ columnRatio: 0.4, rowRatio: 0.6 })
  })

  it.each([
    ['not JSON', '{'],
    ['an unknown layout', JSON.stringify({ layout: 'sixty', sizes: { columnRatio: 0.5, rowRatio: 0.5 } })],
    ['a divider outside the window', JSON.stringify({ layout: 'columns', sizes: { columnRatio: 4, rowRatio: 0.5 } })],
    ['a divider that is not a number', JSON.stringify({ layout: 'columns', sizes: { columnRatio: '0.5', rowRatio: 0.5 } })],
  ])('starts with one terminal when the stored layout is %s', async (_name, raw) => {
    localStorage.setItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY, raw)
    const store = await load()
    expect(store.getState().layout.layout).toBe('single')
    expect(store.getState().layout.panes).toHaveLength(1)
  })

  it('ends the terminals a smaller layout drops, and hands the keyboard to one that is left', async () => {
    const store = await load()
    store.getState().switchLayout('quadrant')
    store.getState().paneFocused(ID(4))
    store.getState().reduceLayout('columns', [ID(3), ID(4)])
    expect(dispose.mock.calls.map(([id]) => id)).toEqual([ID(3), ID(4)])
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1), ID(2)])
    expect(store.getState().layout.layout).toBe('columns')
    expect(focus).toHaveBeenCalledTimes(1)
    expect([ID(1), ID(2)]).toContain(focus.mock.calls[0]![0])
  })

  it('closes a pane by ending its terminal and shrinking to the layout that fits', async () => {
    const store = await load()
    store.getState().switchLayout('columns')
    store.getState().closePane(ID(1))
    expect(dispose).toHaveBeenCalledWith(ID(1))
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(2)])
    expect(store.getState().layout.layout).toBe('single')
    // The last terminal cannot be closed.
    store.getState().closePane(ID(2))
    expect(store.getState().layout.panes).toHaveLength(1)
  })

  it('adds a pane for a terminal started from the launcher, and puts the keyboard there', async () => {
    const store = await load()
    const launch = { sourceTerminalId: ID(1), directory: 'terminal', agent: 'opencode' } as never
    store.getState().addPane('elsewhere', launch)
    expect(store.getState().layout.panes).toHaveLength(1)
    store.getState().addPane(ID(1), launch)
    expect(store.getState().layout.panes).toHaveLength(2)
    expect(store.getState().layout.panes[1]!.launch).toBe(launch)
    expect(store.getState().layout.layout).toBe('columns')
    expect(focus).toHaveBeenCalledWith(ID(2))
  })

  it('keeps the title of a pane, reorders panes, and ignores an order that is not one', async () => {
    const store = await load()
    store.getState().switchLayout('columns')
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

    it('removes one of several, and shrinks the layout to fit the rest', async () => {
      const store = await load()
      store.getState().switchLayout('columns')
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
      store.getState().switchLayout('columns')
      const unsubscribe = store.getState().init()
      onExit.mock.calls[0]![0](exit(ID(2)))
      expect(store.getState().layout.panes).toHaveLength(1)
      unsubscribe()
      expect(stop).toHaveBeenCalled()
    })
  })
})
