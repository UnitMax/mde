// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
vi.mock('../src/renderer/components/inbox/TerminalThreadView', () => ({
  // The real one draws xterm.js, which needs a real browser.
  TerminalThreadView: () => createElement('div'),
}))
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'native' },
    branch: 'feature/login',
    status: 'completed',
    createdAt: 1,
    lastActivityAt: Date.now() - 38 * 60_000,
    readAt: 0,
    archived: false,
    folderId: 'fld_app',
    ...overrides,
  }
}

const fork = vi.fn()
const setCustomTitle = vi.fn()
const writeText = vi.fn(async () => undefined)

let root: Root
let container: HTMLDivElement
const header = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-thread-view"]')!
const byLabel = (label: string): HTMLButtonElement | null => header().querySelector(`[aria-label="${label}"]`)
const render = (): Promise<void> => act(async () => root.render(createElement(InboxThreadView)))
const openThreadMenu = (): Promise<void> =>
  act(async () => void byLabel('Thread actions')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
const menuItem = (label: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === label)
const choose = async (label: string): Promise<void> => {
  await openThreadMenu()
  await act(async () => menuItem(label)!.click())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  fork.mockReset()
  setCustomTitle.mockReset()
  writeText.mockClear()
  vi.stubGlobal('api', {
    paths: { revealInbox: vi.fn(), openInboxInVsCode: vi.fn() },
    inbox: {
      changes: vi.fn(async () => ({ available: false })),
      folders: vi.fn(async () => ({ folders: [], composer: {} })),
      setRead: vi.fn(async () => null),
      setCustomTitle,
    },
    files: { list: vi.fn(async () => ({ path: '/', truncated: false, entries: [] })) },
    chat: {
      fork,
      draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })),
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      messages: vi.fn(async () => ({ messages: [], older: null, running: false })),
      requests: vi.fn(async () => ({ permissions: [], forms: [] })),
      options: vi.fn(() => new Promise(() => {})),
    },
  })
  useInboxChat.setState({ threads: {}, recent: [], draftReloads: {}, titleRegenerations: {} })
  useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files' })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false },
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    inboxMarkedUnread: {},
    inboxCues: {},
    activeWorkspaceView: 'inbox',
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Inbox thread header', () => {
  it('is one row: the title, the folder and the branch, and no model, no path and no "Last activity"', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ model: { providerId: 'p', id: 'glm-5.3-flash-free' } })] })
    await render()
    expect(header().querySelector('h2')?.textContent).toBe('Fix login')
    expect(header().querySelector('[data-testid="inbox-thread-folder"]')?.textContent).toBe('app')
    expect(header().querySelector('[data-testid="inbox-thread-branch"]')?.textContent).toBe('feature/login')
    expect(header().textContent).not.toContain('glm-5.3-flash-free')
    expect(header().textContent).not.toContain('/home/me/app')
    expect(header().textContent).not.toContain('Last activity')
    expect(header().querySelector('dl')).toBeNull()
  })

  it('names the thread whose agent started this one, and opens it', async () => {
    useWorkspace.setState({
      inboxThreads: [thread({ spawnedBy: { threadId: 'ses_parent' } }), thread({ id: 'ses_parent', title: 'Plan the release' })],
    })
    await render()
    const link = header().querySelector<HTMLButtonElement>('[data-testid="inbox-spawned-by"]')!
    expect(link.textContent).toBe('Started by Plan the release')
    await act(async () => link.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_parent')
  })

  it('says only that an agent started it when the parent is unknown or gone', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ spawnedBy: {} })] })
    await render()
    expect(header().querySelector('[data-testid="inbox-spawned-by"]')?.textContent).toBe('Started by an agent')
    useWorkspace.setState({ inboxThreads: [thread({ spawnedBy: { threadId: 'ses_gone' } })] })
    await render()
    expect(header().querySelector('[data-testid="inbox-spawned-by"]')?.textContent).toBe('Started by a thread that is no longer in the Inbox')
  })

  it('keeps the details in tooltips: the full path and when the thread was last active', async () => {
    await render()
    expect(header().querySelector('[data-testid="inbox-thread-folder"]')?.getAttribute('title')).toBe('/home/me/app')
    expect(header().querySelector('h2')?.getAttribute('title')).toContain('Last activity 38m ago')
  })

  it('names the distro in the folder tooltip of a WSL thread', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ target: { kind: 'wsl', distro: 'Ubuntu-24.04' } })] })
    await render()
    expect(header().querySelector('[data-testid="inbox-thread-folder"]')?.getAttribute('title')).toBe('/home/me/app (Ubuntu-24.04)')
  })

  it('leaves out the branch of a thread that has none', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ branch: null })] })
    await render()
    expect(header().querySelector('[data-testid="inbox-thread-branch"]')).toBeNull()
  })

  it('shows a status only while something is going on: not "Done", but Working, and a failure', async () => {
    await render()
    expect(header().querySelector('[data-testid="inbox-status-chip"]')).toBeNull()
    await act(async () => useWorkspace.setState({ inboxThreads: [thread({ status: 'working', workingSince: Date.now() })] }))
    expect(header().querySelector('[data-testid="inbox-status-chip"]')?.textContent).toBe('Working')
    await act(async () => useWorkspace.setState({ inboxThreads: [thread({ status: 'error' })] }))
    expect(header().querySelector('[data-testid="inbox-status-chip"]')?.textContent).toBe('Failed')
  })

  it('has the folder button, compact mode and one menu, and no labelled Regenerate button', async () => {
    await render()
    expect(byLabel('Open folder in File Explorer')).not.toBeNull()
    expect(byLabel('Compact mode')).not.toBeNull()
    expect(byLabel('Thread actions')).not.toBeNull()
    expect(byLabel('Regenerate title')).toBeNull()
    expect(header().textContent).not.toContain('Regenerate title')
  })

  it('has no compact toggle on a terminal thread', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ mode: 'terminal' })] })
    await render()
    expect(byLabel('Compact mode')).toBeNull()
    expect(byLabel('Thread actions')).not.toBeNull()
  })

  it('lists what can be done to the thread in the menu', async () => {
    await render()
    await openThreadMenu()
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)
    expect(items).toEqual(['Regenerate title', 'Rename thread', 'Fork thread', 'Copy folder path'])
  })

  it('renames from the menu and by double-clicking the title', async () => {
    setCustomTitle.mockImplementation(async ({ customTitle }: { customTitle: string | null }) => ({ ...thread(), customTitle }))
    await render()
    await choose('Rename thread')
    const input = document.body.querySelector<HTMLInputElement>('input[id="inbox-thread-name-ses_one"]')!
    expect(input.value).toBe('Fix login')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'My task')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(setCustomTitle).toHaveBeenLastCalledWith({ id: 'ses_one', customTitle: 'My task' })
    await vi.waitFor(() => expect(header().querySelector('h2')?.textContent).toBe('My task'))
    expect(document.body.querySelector('input[id="inbox-thread-name-ses_one"]')).toBeNull()

    await act(async () => header().querySelector('h2')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(document.body.querySelector<HTMLInputElement>('input[id="inbox-thread-name-ses_one"]')?.value).toBe('My task')
  })

  it('forks from the menu, and says why when that fails', async () => {
    fork.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:fork': Error: This OpenCode service does not support forking."))
    await render()
    await choose('Fork thread')
    expect(fork).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(header().querySelector('[role="alert"]')?.textContent).toBe('This OpenCode service does not support forking.')
  })

  it('copies the folder path', async () => {
    await render()
    await choose('Copy folder path')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/home/me/app')
  })
})
