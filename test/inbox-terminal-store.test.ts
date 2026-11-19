// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getInboxTerminalDistro, INBOX_TERMINAL_DISTRO_STORAGE_KEY, INBOX_TERMINAL_LAYOUT_STORAGE_KEY, saveInboxTerminalDistro } from '../src/renderer/lib/inbox-settings'
import type { PtyExitInfo } from '../src/shared/types'

const dispose = vi.fn((_terminalId: string) => {})
const focus = vi.fn((_terminalId: string) => () => {})
const disposeScreen = vi.fn()
vi.mock('../src/renderer/terminal/dispose', () => ({ disposeRuntimeTerminal: (id: string) => dispose(id) }))
vi.mock('../src/renderer/terminal/focus', () => ({ focusTerminalWhenReady: (id: string) => focus(id) }))
const screens = new Map<string, { term: { buffer: { active: { length: number; getLine: (index: number) => { isWrapped: boolean; translateToString: () => string } | undefined } } } }>()
vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: (id: string) => disposeScreen(id), getSession: (id: string) => screens.get(id) }))

// New panes get the next number, never one a closed pane had, as the store's random keys never repeat either.
let lastPane = 0
vi.mock('../src/renderer/terminal/tabs', async (original) => ({
  ...await original<typeof import('../src/renderer/terminal/tabs')>(),
  randomPaneId: () => `pane-${++lastPane}`,
}))

const ID = (pane: number): string => `inbox-terminal:tab:inbox-terminal:tab:default:pane:pane-${pane}`
const stored = (): unknown => JSON.parse(localStorage.getItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY) ?? 'null')
const exit = (terminalId: string, sessionId = 'inbox-terminal'): PtyExitInfo => ({ terminalId, sessionId, exitCode: 0 }) as PtyExitInfo

const forget = vi.fn(async (_req: { terminalIds: string[] }) => {})
const retain = vi.fn(async (_req: { terminalIds: string[] }) => {})
/** Main's API as a test gives it, with the calls that keep terminal refs to their panes. */
function stubApi(api: Record<string, Record<string, unknown>>): void {
  vi.stubGlobal('api', { ...api, terminalReferences: { forget, retain, ...api.terminalReferences } })
}

async function load() {
  lastPane = 0
  vi.resetModules()
  const { useInboxTerminal } = await import('../src/renderer/store/inbox-terminal')
  return useInboxTerminal
}

beforeEach(() => {
  localStorage.clear()
  dispose.mockClear()
  focus.mockClear()
  disposeScreen.mockClear()
  forget.mockClear()
  retain.mockClear()
  stubApi({})
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the Inbox terminal store', () => {
  it('remembers the WSL preference and clears it when the default is chosen', async () => {
    saveInboxTerminalDistro('Debian')
    expect(getInboxTerminalDistro()).toBe('Debian')
    const store = await load()
    expect(store.getState().distro).toBe('Debian')
    saveInboxTerminalDistro(null)
    expect(getInboxTerminalDistro()).toBeNull()
    expect(localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)).toBeNull()
  })

  it('switches distro after main-process validation, preserving splits and clearing old screens and exits', async () => {
    const configureInbox = vi.fn(async () => ({ session: { id: 'inbox-terminal', name: 'Terminal', kind: 'wsl', distro: 'Debian', createdAt: '' }, changed: true }))
    stubApi({ pty: { configureInbox } })
    const store = await load()
    store.getState().splitPane(ID(1), 'right')
    store.setState({ session: { id: 'inbox-terminal', name: 'Terminal', kind: 'wsl', distro: 'Ubuntu', createdAt: '' } })
    const tree = store.getState().layout.tree
    expect(await store.getState().configureDistro('Debian')).toBe(true)
    expect(configureInbox).toHaveBeenCalledWith({ distro: 'Debian' })
    expect(store.getState().session).toMatchObject({ distro: 'Debian' })
    expect(store.getState().layout.tree).toEqual(tree)
    expect(disposeScreen.mock.calls.map(([id]) => id)).toEqual([ID(1), ID(2)])
    expect(dispose).not.toHaveBeenCalled()
    expect(localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)).toBe('Debian')
  })

  it('keeps the previous preference and screens when validation fails', async () => {
    stubApi({ pty: { configureInbox: vi.fn(async () => { throw new Error('Missing distro') }) } })
    const store = await load()
    expect(await store.getState().configureDistro('Missing')).toBe(false)
    expect(store.getState()).toMatchObject({ distro: null, error: 'Missing distro', configuring: false })
    expect(disposeScreen).not.toHaveBeenCalled()
    expect(localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)).toBeNull()
  })

  it('reattaches without clearing screens when the main process keeps the same distro', async () => {
    const session = { id: 'inbox-terminal', name: 'Terminal', kind: 'wsl' as const, distro: 'Debian', createdAt: '' }
    stubApi({ pty: { configureInbox: vi.fn(async () => ({ session, changed: false })) } })
    const store = await load()
    expect(await store.getState().configureDistro('Debian')).toBe(true)
    expect(disposeScreen).not.toHaveBeenCalled()
    expect(store.getState().session).toEqual(session)
  })

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

  it('never gives a new pane the ID of a closed one, and has main forget the refs of a closed pane', async () => {
    const store = await load()
    store.getState().splitPane(ID(1), 'right')
    store.getState().splitPane(ID(2), 'right')
    store.getState().closePane(ID(2))
    expect(forget).toHaveBeenCalledWith({ terminalIds: [ID(2)] })
    store.getState().splitPane(ID(1), 'right')
    expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1), ID(4), ID(3)])
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
      expect(forget).toHaveBeenCalledWith({ terminalIds: [ID(2)] })
      expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1)])
      expect(focus).toHaveBeenCalledWith(ID(1))
    })

    it('hears about ends once the store is started, and stops when told to', async () => {
      const store = await load()
      const stop = vi.fn()
      const onExit = vi.fn((_listener: (info: PtyExitInfo) => void) => stop)
      const stopAgents = vi.fn()
      const stopReads = vi.fn()
      stubApi({ pty: { onExit }, agentTerminals: { onOpen: vi.fn(() => stopAgents) }, terminalReferences: { onRead: vi.fn(() => stopReads) } })
      store.getState().splitPane(ID(1), 'right')
      const unsubscribe = store.getState().init()
      expect(retain).toHaveBeenCalledWith({ terminalIds: [ID(1), ID(2)] })
      onExit.mock.calls[0]![0](exit(ID(2)))
      expect(store.getState().layout.panes).toHaveLength(1)
      unsubscribe()
      expect(stop).toHaveBeenCalled()
      expect(stopAgents).toHaveBeenCalled()
      expect(stopReads).toHaveBeenCalled()
    })
  })

  describe('reading a pane for an agent', () => {
    const screen = (lines: string[]) => ({
      term: { buffer: { active: { length: lines.length, getLine: (index: number) => ({ isWrapped: false, translateToString: () => lines[index]! }) } } },
    })

    afterEach(() => screens.clear())

    it('answers with the pane\'s last lines, its title and directory', async () => {
      const answer = vi.fn(async () => {})
      stubApi({ terminalReferences: { answer } })
      const store = await load()
      store.getState().titlePane(ID(1), 'Dev server')
      const { useWorkspace } = await import('../src/renderer/store/workspace')
      useWorkspace.setState({ terminalDirectories: { [ID(1)]: '/home/me/app' } })
      screens.set(ID(1), screen(['one', 'two', 'three', '', '']))
      store.getState().answerRead({ requestId: 'r1', terminalId: ID(1), lines: 2 })
      expect(answer).toHaveBeenCalledWith({
        requestId: 'r1',
        reading: { title: 'Dev server', directory: '/home/me/app', running: true, totalLines: 3, text: 'two\nthree' },
      })
    })

    it('says when the pane was closed or has not been opened since MDE started', async () => {
      const answer = vi.fn(async () => {})
      stubApi({ terminalReferences: { answer } })
      const store = await load()
      store.getState().answerRead({ requestId: 'r1', terminalId: ID(7), lines: 2 })
      store.getState().answerRead({ requestId: 'r2', terminalId: ID(1), lines: 2 })
      expect(answer).toHaveBeenNthCalledWith(1, { requestId: 'r1', error: expect.stringMatching(/closed/) })
      expect(answer).toHaveBeenNthCalledWith(2, { requestId: 'r2', error: expect.stringMatching(/not been opened/) })
    })
  })

  describe('opening a Files tree folder', () => {
    const wsl = (distro: string) => ({ id: 'inbox-terminal', name: 'Terminal', kind: 'wsl' as const, distro, createdAt: '' })
    const folder = { sessionId: 'ses_thread', path: 'src' }

    async function loadOnWindows() {
      const store = await load()
      const { useWorkspace } = await import('../src/renderer/store/workspace')
      useWorkspace.setState({ platform: { platform: 'win32', isWindows: true } })
      return store
    }

    it('adds a pane below the one last used, after main has set its folder', async () => {
      const startInFolder = vi.fn(async () => {})
      stubApi({ pty: { startInFolder } })
      const store = await loadOnWindows()
      store.setState({ session: wsl('Ubuntu') })

      await store.getState().openInFolder(folder, { kind: 'wsl', distro: 'Ubuntu' }, 'bottom')

      expect(startInFolder).toHaveBeenCalledWith({ terminalId: ID(2), sessionId: 'inbox-terminal', folder })
      expect(store.getState().layout.panes.map((pane) => pane.terminalId)).toEqual([ID(1), ID(2)])
      expect(store.getState().layout.tree).toMatchObject({ type: 'split', axis: 'row' })
      expect(focus).toHaveBeenLastCalledWith(ID(2))
    })

    it('sets up the terminal first when it has not been opened yet', async () => {
      const configureInbox = vi.fn(async () => ({ session: wsl('Ubuntu'), changed: false }))
      const startInFolder = vi.fn(async () => {})
      stubApi({ pty: { configureInbox, startInFolder } })
      const store = await loadOnWindows()

      await store.getState().openInFolder(folder, { kind: 'wsl', distro: 'Ubuntu' }, 'right')

      expect(configureInbox).toHaveBeenCalled()
      expect(startInFolder).toHaveBeenCalledTimes(1)
    })

    it('refuses a folder in another environment and adds no pane', async () => {
      const startInFolder = vi.fn(async () => {})
      stubApi({ pty: { startInFolder } })
      const store = await loadOnWindows()
      store.setState({ session: wsl('Ubuntu') })

      await expect(store.getState().openInFolder(folder, { kind: 'native', distro: undefined }, 'right'))
        .rejects.toThrow('This folder is on Windows, but the Inbox terminal runs in WSL (Ubuntu).')
      await expect(store.getState().openInFolder(folder, { kind: 'wsl', distro: 'Debian' }, 'right'))
        .rejects.toThrow('in WSL (Debian)')
      expect(startInFolder).not.toHaveBeenCalled()
      expect(store.getState().layout.panes).toHaveLength(1)
    })

    it('adds no pane when main refuses the folder', async () => {
      stubApi({ pty: { startInFolder: vi.fn(async () => { throw new Error('Folder not found.') }) } })
      const store = await loadOnWindows()
      store.setState({ session: wsl('Ubuntu') })

      await expect(store.getState().openInFolder(folder, { kind: 'wsl', distro: 'Ubuntu' }, 'right')).rejects.toThrow('Folder not found.')
      expect(store.getState().layout.panes).toHaveLength(1)
    })
  })

  describe('panes agents open through the MDE MCP', () => {
    const request = { requestId: 'req-1', title: 'Dev server', command: 'npm run dev', approval: true, from: 'Fix login' }
    const native = () => ({ id: 'inbox-terminal', name: 'Terminal', kind: 'native' as const, createdAt: '' })

    async function loadNative() {
      const store = await load()
      const { useWorkspace } = await import('../src/renderer/store/workspace')
      useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false } })
      store.setState({ session: native() })
      return store
    }

    it('adds a titled pane after main started its shell, without taking the keyboard, and keeps the command for approval', async () => {
      const claim = vi.fn(async () => {})
      const refuse = vi.fn(async () => {})
      const decide = vi.fn(async () => {})
      stubApi({ agentTerminals: { claim, refuse, decide } })
      const store = await loadNative()
      focus.mockClear()

      await store.getState().openForAgent(request)

      expect(claim).toHaveBeenCalledWith({ requestId: 'req-1', terminalId: ID(2), palette: expect.objectContaining({ foreground: expect.any(String) }) })
      expect(store.getState().layout.panes.map((pane) => [pane.terminalId, pane.title])).toEqual([[ID(1), undefined], [ID(2), 'Dev server']])
      expect(focus).not.toHaveBeenCalled()
      expect(store.getState().agentArrivals).toBe(1)
      expect(store.getState().agentCommands).toEqual({ [ID(2)]: { command: 'npm run dev', from: 'Fix login' } })
      expect(refuse).not.toHaveBeenCalled()

      store.getState().decideAgentCommand(ID(2), 'run-for-hour')
      expect(decide).toHaveBeenCalledWith({ terminalId: ID(2), decision: 'run-for-hour' })
      expect(store.getState().agentCommands).toEqual({})
      store.getState().decideAgentCommand(ID(2), 'run')
      expect(decide).toHaveBeenCalledTimes(1)
    })

    it('keeps nothing to approve when the command runs at once', async () => {
      stubApi({ agentTerminals: { claim: vi.fn(async () => {}), refuse: vi.fn(async () => {}) } })
      const store = await loadNative()
      await store.getState().openForAgent({ ...request, approval: false })
      expect(store.getState().agentCommands).toEqual({})
      expect(store.getState().agentArrivals).toBe(1)
    })

    it('shows a toast for each pane, saying when its command waits, and a click on it brings the pane into view', async () => {
      stubApi({ agentTerminals: { claim: vi.fn(async () => {}), refuse: vi.fn(async () => {}) } })
      const store = await loadNative()
      const { useToasts } = await import('../src/renderer/store/toasts')
      const { useWorkspace } = await import('../src/renderer/store/workspace')
      const { useInboxChanges } = await import('../src/renderer/store/inbox-changes')
      useWorkspace.setState({ activeWorkspaceView: 'sessions', fileTreeCollapsed: true })

      await store.getState().openForAgent(request)
      await store.getState().openForAgent({ ...request, requestId: 'req-2', title: 'Watcher', command: null, approval: false, from: null })

      const [waiting, opened] = useToasts.getState().toasts
      expect(waiting).toMatchObject({ icon: 'approval', label: 'Command waits for approval', title: 'npm run dev', detail: 'Dev server · From Fix login' })
      expect(opened).toMatchObject({ icon: 'agent-terminal', label: 'Agent opened a terminal', title: 'Watcher' })
      expect(opened!.detail).toBeUndefined()

      focus.mockClear()
      waiting!.onOpen!()
      expect(useWorkspace.getState()).toMatchObject({ activeWorkspaceView: 'inbox', fileTreeCollapsed: false })
      expect(useInboxChanges.getState().tab).toBe('terminal')
      expect(focus).toHaveBeenCalledWith(ID(2))
    })

    it('shows no toast when they are turned off', async () => {
      stubApi({ agentTerminals: { claim: vi.fn(async () => {}), refuse: vi.fn(async () => {}) } })
      const store = await loadNative()
      const { saveAlertSettings, getAlertSettings } = await import('../src/renderer/lib/alert-settings')
      const { useToasts } = await import('../src/renderer/store/toasts')
      saveAlertSettings({ ...getAlertSettings(), toasts: false })
      await store.getState().openForAgent(request)
      expect(useToasts.getState().toasts).toEqual([])
      expect(store.getState().agentArrivals).toBe(1)
    })

    it('tells main when the terminal already has as many panes as agents may open into, and adds nothing', async () => {
      const claim = vi.fn(async () => {})
      const refuse = vi.fn(async () => {})
      stubApi({ agentTerminals: { claim, refuse } })
      const store = await loadNative()
      for (let index = 0; index < 8; index += 1) store.getState().splitPane(store.getState().layout.panes.at(-1)!.terminalId, 'right')
      const panes = store.getState().layout.panes.length
      await store.getState().openForAgent(request)
      expect(claim).not.toHaveBeenCalled()
      expect(refuse).toHaveBeenCalledWith({ requestId: 'req-1', reason: expect.stringContaining('already has 9 panes') })
      expect(store.getState().layout.panes).toHaveLength(panes)
      expect(store.getState().agentArrivals).toBe(0)
    })

    it('adds nothing when main refuses the claim, and does not answer twice', async () => {
      const refuse = vi.fn(async () => {})
      stubApi({ agentTerminals: { claim: vi.fn(async () => { throw new Error('The directory is in WSL') }), refuse } })
      const store = await loadNative()
      await store.getState().openForAgent(request)
      expect(store.getState().layout.panes).toHaveLength(1)
      // The claim was refused before it was made, from main's side; the window says so once.
      expect(refuse).toHaveBeenCalledTimes(1)
    })

    it('keeps the pane main started when the person split another meanwhile', async () => {
      let release: () => void = () => {}
      const claim = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
      stubApi({ agentTerminals: { claim, refuse: vi.fn(async () => {}) } })
      const store = await loadNative()
      const opening = store.getState().openForAgent(request)
      await vi.waitFor(() => expect(claim).toHaveBeenCalled())
      store.getState().splitPane(ID(1), 'right')
      release()
      await opening
      expect(dispose).not.toHaveBeenCalled()
      expect(store.getState().layout.panes.map((pane) => pane.terminalId).sort()).toEqual([ID(1), ID(2), ID(3)])
      expect(store.getState().agentArrivals).toBe(1)
    })

    it('ends the shell instead of showing it elsewhere when the pane it was to go beside closed meanwhile', async () => {
      let release: () => void = () => {}
      const claim = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
      stubApi({ agentTerminals: { claim, refuse: vi.fn(async () => {}) } })
      const store = await loadNative()
      store.getState().splitPane(ID(1), 'right')
      const opening = store.getState().openForAgent(request)
      await vi.waitFor(() => expect(claim).toHaveBeenCalled())
      store.getState().closePane(ID(2))
      release()
      await opening
      expect(dispose).toHaveBeenCalledWith(ID(3))
      expect(store.getState().agentArrivals).toBe(0)
    })

    it('drops a waiting command when its pane closes or its shell ends', async () => {
      const decide = vi.fn(async () => {})
      stubApi({ agentTerminals: { claim: vi.fn(async () => {}), refuse: vi.fn(async () => {}), decide } })
      const store = await loadNative()
      await store.getState().openForAgent(request)
      await store.getState().openForAgent({ ...request, requestId: 'req-2' })
      expect(Object.keys(store.getState().agentCommands)).toEqual([ID(2), ID(3)])
      store.getState().closePane(ID(2))
      store.getState().paneExited(exit(ID(3)))
      expect(store.getState().agentCommands).toEqual({})
      expect(decide).toHaveBeenCalledWith({ terminalId: ID(3), decision: 'cancel' })
    })
  })
})
