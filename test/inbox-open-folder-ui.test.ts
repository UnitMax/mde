// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  // The real one draws xterm.js, which needs a real browser.
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { InboxSidebar } from '../src/renderer/components/inbox/InboxChanges'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { DirectoryContext, InboxThread } from '../src/shared/types'

const FOLDER = 'Open folder in File Explorer'
const VS_CODE = 'Open folder in VS Code'

const revealInbox = vi.fn(async () => undefined)
const openInboxInVsCode = vi.fn(async () => undefined)
const revealTerminal = vi.fn(async () => undefined)
const openTerminalInVsCode = vi.fn(async () => undefined)

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: null,
    status: 'completed',
    createdAt: 1,
    lastActivityAt: Date.now() - 5 * 60_000,
    readAt: 0,
    archived: false,
    folderId: 'fld_app',
    ...overrides,
  }
}

const sessionFor = (id: string, overrides: Partial<DirectoryContext> = {}): DirectoryContext =>
  ({ id, name: 'app', path: '/home/me/app', kind: 'wsl', distro: 'Ubuntu', createdAt: '', ...overrides })

let root: Root
let container: HTMLDivElement
const render = (element: ReactElement): Promise<void> => act(async () => root.render(element))
const button = (label: string, within: ParentNode = container): HTMLButtonElement | null =>
  within.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
const click = (element: HTMLElement | null): Promise<void> => act(async () => element!.click())
const onWindows = (wslAvailable = true): void =>
  useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, wslAvailable })
const onMac = (): void => useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false }, wslAvailable: false })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('api', {
    paths: { revealInbox, openInboxInVsCode, revealTerminal, openTerminalInVsCode },
    inbox: {
      changes: vi.fn(async () => ({ available: false })),
      folders: vi.fn(async () => ({ folders: [], composer: {} })),
      setRead: vi.fn(async () => null),
    },
    files: { list: vi.fn(async ({ path }: { path: string }) => ({ path, truncated: false, entries: [{ name: 'README.md', kind: 'file' }] })) },
    chat: {
      draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })),
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      messages: vi.fn(async () => ({ messages: [], older: null, running: false })),
      requests: vi.fn(async () => ({ permissions: [], forms: [] })),
      options: vi.fn(() => new Promise(() => {})),
    },
  })
  for (const mock of [revealInbox, openInboxInVsCode, revealTerminal, openTerminalInVsCode]) mock.mockClear()
  useInboxChat.setState({ threads: {}, recent: [], draftReloads: {} })
  useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files' })
  useWorkspace.setState({
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    inboxMarkedUnread: {},
    inboxCues: {},
    activeWorkspaceView: 'inbox',
    fileTreeCollapsed: false,
    openFiles: {},
    settingsDialog: { open: false, section: 'appearance' },
  })
  onWindows()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Inbox Files sidebar', () => {
  const sidebar = (session: DirectoryContext, threadId?: string): Promise<void> =>
    render(createElement(InboxSidebar, { session, threadId }))

  it('opens the thread folder in File Explorer and VS Code, by thread ID', async () => {
    await sidebar(sessionFor('ses_one'), 'ses_one')
    const panel = container.querySelector<HTMLElement>('[data-testid="file-tree-panel"]')!

    await click(button(FOLDER, panel))
    expect(revealInbox).toHaveBeenCalledExactlyOnceWith('ses_one')

    await click(button(VS_CODE, panel))
    expect(openInboxInVsCode).toHaveBeenCalledExactlyOnceWith('ses_one')
    expect(revealTerminal).not.toHaveBeenCalled()
    expect(openTerminalInVsCode).not.toHaveBeenCalled()
  })

  it('does the same for the project a new thread starts in, by project ID', async () => {
    await sidebar(sessionFor('fld_app'))

    await click(button(FOLDER))
    await click(button(VS_CODE))

    expect(revealInbox).toHaveBeenCalledExactlyOnceWith('fld_app')
    expect(openInboxInVsCode).toHaveBeenCalledExactlyOnceWith('fld_app')
  })

  it('puts the buttons in the footer beside Refresh, so the tab strip keeps the header', async () => {
    await sidebar(sessionFor('ses_one'), 'ses_one')
    const header = container.querySelector('[role="tablist"]')!.parentElement!
    const footer = button('Refresh files')!.parentElement!

    expect(footer.querySelector(`[aria-label="${VS_CODE}"]`)).not.toBeNull()
    expect(footer.querySelector(`[aria-label="${FOLDER}"]`)).not.toBeNull()
    expect(header.querySelector(`[aria-label="${VS_CODE}"]`)).toBeNull()
    expect(header.querySelector(`[aria-label="${FOLDER}"]`)).toBeNull()
    expect(header.querySelector('[aria-label="Collapse files"]')).not.toBeNull()
    expect(header.querySelector('[aria-label="Refresh files"]')).toBeNull()
  })

  it('offers VS Code only for a WSL folder on Windows with WSL installed', async () => {
    onMac()
    await sidebar(sessionFor('ses_one', { kind: 'native', distro: undefined }), 'ses_one')
    expect(button(VS_CODE)).toBeNull()
    // The file manager works for a folder on the Mac too.
    expect(button(FOLDER)).not.toBeNull()

    onWindows(false)
    await sidebar(sessionFor('ses_one'), 'ses_one')
    expect(button(VS_CODE)).toBeNull()
    expect(button(FOLDER)).not.toBeNull()

    onWindows(true)
    await sidebar(sessionFor('ses_one', { kind: 'native', distro: undefined }), 'ses_one')
    expect(button(VS_CODE)).toBeNull()

    await sidebar(sessionFor('ses_one'), 'ses_one')
    expect(button(VS_CODE)).not.toBeNull()
  })
})

describe('Inbox thread header', () => {
  const header = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-thread-view"]')!

  it('opens the thread folder in File Explorer and VS Code', async () => {
    await render(createElement(InboxThreadView))

    await click(button(FOLDER, header()))
    expect(revealInbox).toHaveBeenCalledExactlyOnceWith('ses_one')

    await click(button(VS_CODE, header()))
    expect(openInboxInVsCode).toHaveBeenCalledExactlyOnceWith('ses_one')
  })

  it('follows the selected thread', async () => {
    useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two', title: 'Other' })] })
    await render(createElement(InboxThreadView))
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))

    await click(button(FOLDER, header()))

    expect(revealInbox).toHaveBeenCalledExactlyOnceWith('ses_two')
  })

  it('offers VS Code only where main can open it, and always offers the file manager', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ target: { kind: 'native' } })] })
    onMac()
    await render(createElement(InboxThreadView))

    expect(button(VS_CODE, header())).toBeNull()
    expect(button(FOLDER, header())).not.toBeNull()
  })

  it('shows no folder buttons on the new-thread page', async () => {
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render(createElement(InboxThreadView))

    expect(container.querySelector('[data-testid="inbox-thread-view"]')).toBeNull()
    expect(button(FOLDER)).toBeNull()
  })
})
