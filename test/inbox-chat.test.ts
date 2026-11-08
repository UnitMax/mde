// @vitest-environment happy-dom

import { act, createElement } from 'react'
import type { EditorView } from '@codemirror/view'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatCreateRequest, ChatDraft, ChatDraftRequest, ChatForkRequest, ChatForkResult, ChatMessage, ChatMessagesPage, ChatOptions, ChatRequests, ChatRevert, ChatRevertRequest, InboxFolder, InboxGitInfo, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { getTerminalSettings, saveTerminalSettings, TERMINAL_SETTINGS_STORAGE_KEY } from '../src/renderer/terminal/terminal-settings'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const options: ChatOptions = {
  agents: [{ id: 'plan', name: 'Plan' }, { id: 'build', name: 'Build' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free' }],
  defaultModel: { id: 'free-1', providerId: 'opencode' },
  defaultAgent: 'build',
  skills: [],
}

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model: { id: 'free-1', providerId: 'opencode' }, status: 'working',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
    ...overrides,
  }
}

/** What a fork of `ses_one` looks like once recorded. */
function forkedThread(): InboxThread {
  return thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one', readAt: Date.now() })
}

let page: ChatMessagesPage
let requests: ChatRequests
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    setComposer: vi.fn(async (composer: unknown) => composer),
    removeFolder: vi.fn(async () => undefined),
    folders: vi.fn(async () => ({ folders: useInboxChat.getState().folders, composer: useInboxChat.getState().composer })),
    gitInfo: vi.fn(async (): Promise<InboxGitInfo> => ({ repository: false, branch: null, branches: [] })),
  },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(async () => options),
    create: vi.fn(async (_request: ChatCreateRequest) => thread({ id: 'ses_new', title: 'New thread' })),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => requests),
    send: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    redo: vi.fn(async (): Promise<void> => undefined),
    revert: vi.fn(async (request: ChatRevertRequest): Promise<ChatRevert> => ({ messageId: request.messageId, files: [] })),
    fork: vi.fn(async (_request: ChatForkRequest): Promise<ChatForkResult> => ({ thread: forkedThread() })),
    compact: vi.fn(async (_request: { threadId: string }): Promise<void> => undefined),
    regenerateTitle: vi.fn(async (): Promise<void> => undefined),
    replyPermission: vi.fn(async () => undefined),
    replyForm: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
  },
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(InboxThreadView)))
  return container
}

async function type(element: EditorView, value: string): Promise<void> {
  await setMessageText(element, value)
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!found) throw new Error(`No button ${label}`)
  return found
}

/** Opens the header's thread menu and picks an item, as a person would with the keyboard. */
async function threadAction(container: HTMLElement, label: string): Promise<void> {
  await act(async () => button(container, 'Thread actions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim() === label)
  if (!item) throw new Error(`No menu item ${label}`)
  await act(async () => item.click())
}

/**
 * A draft store in miniature: what a composer loads is what was last typed or put above it, kept per
 * draft. `initial` is the text of the open thread's draft.
 */
function draftStore(initial: string): { saved: (key?: string) => string } {
  const stored: Record<string, string> = { 'thread:ses_one': initial }
  api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
    const current = stored[request.key] ?? ''
    if (request.action === 'text') stored[request.key] = request.text
    if (request.action === 'prepend') stored[request.key] = current.trim() ? `${request.text}\n\n${current}` : request.text
    return { text: stored[request.key] ?? current, revision: 1, attachments: [] }
  }) as never)
  return { saved: (key = 'thread:ses_one') => stored[key] ?? '' }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockClear()
  page = { messages: [], older: null, running: false }
  requests = { permissions: [], forms: [] }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
})

afterEach(async () => {
  // Tests that stand in for the service put the plain answers back.
  api.chat.draft.mockImplementation(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] }))
  api.chat.revert.mockImplementation(async (request: ChatRevertRequest) => ({ messageId: request.messageId, files: [] }))
  api.chat.fork.mockImplementation(async () => ({ thread: forkedThread() }))
  api.chat.compact.mockImplementation(async () => undefined)
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Inbox new thread', () => {
  it('starts a new thread with the effort chosen in the model menu and remembers it', async () => {
    api.chat.options.mockResolvedValue({ ...options, models: [{ ...options.models[0]!, variants: ['low', 'high'] }] })
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
      await act(async () => button(view, 'Model').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      const high = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((item) => item.textContent === 'High')!
      await act(async () => high.click())
      await type(messageInput(view), 'Review the implementation')
      await act(async () => button(view, 'Send').click())
      expect(api.chat.create).toHaveBeenLastCalledWith(expect.objectContaining({ model: { ...options.defaultModel!, variant: 'high' } }))
      expect(useInboxChat.getState().composer.model).toEqual({ ...options.defaultModel!, variant: 'high' })
    } finally {
      api.chat.options.mockResolvedValue(options)
    }
  })

  it('asks for a folder first', async () => {
    useInboxChat.setState({ folders: [], composer: {} })
    const view = await render()
    expect(view.querySelector('h1')?.textContent).toBe('What should we build?')
    expect(button(view, 'Add a project')).toBeTruthy()
    expect(view.querySelector('[data-testid="chat-composer"]')).toBeNull()
  })

  it('names the folder, picks the default model and agent, and starts a thread on Enter', async () => {
    const view = await render()
    expect(view.querySelector('h1')?.textContent).toContain('What should we build in app')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')?.textContent).toBe('OpenCode /Flint Free'))
    expect(view.querySelector('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build')
    expect(api.chat.options).toHaveBeenCalledWith({ folderId: 'fld_app' })

    const send = button(view, 'Send')
    expect(send.disabled).toBe(true)
    const input = messageInput(view)
    await type(input, 'Add a dark mode')
    expect(send.disabled).toBe(false)
    await act(async () => {
      input.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledWith({
      attachmentIds: [], draftRevision: 1, folderId: 'fld_app', text: 'Add a dark mode', agent: 'build', model: { id: 'free-1', providerId: 'opencode' },
      // The thread starts from the page's own draft, which is spent with it.
      draftId: expect.stringMatching(/^drf_/),
    }))
    await vi.waitFor(() => expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_new'))
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_new'])
  })

  it('keeps the text and shows the error when starting fails', async () => {
    api.chat.create.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:create': Error: Model unavailable"))
    const view = await render()
    await vi.waitFor(() => expect(button(view, 'Send')).toBeTruthy())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
    const input = messageInput(view)
    await type(input, 'Hello')
    await act(async () => button(view, 'Send').click())
    await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe('Model unavailable'))
    expect(input.state.doc.toString()).toBe('Hello')
  })
})

describe('Inbox worktree mode', () => {
  const repo: InboxGitInfo = {
    repository: true,
    branch: 'main',
    branches: [
      { name: 'main', remote: false },
      { name: 'feature/login', remote: false },
      { name: 'origin/main', remote: true },
    ],
  }
  /** Radix opens its menus on a pointer press; the keyboard route is what happy-dom supports reliably. */
  const open = async (trigger: Element): Promise<void> => {
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }
  const choose = async (label: string): Promise<void> => {
    const item = await vi.waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.includes(label))
      expect(found).toBeDefined()
      return found!
    })
    await act(async () => item.click())
  }
  const send = async (view: HTMLElement, text: string): Promise<void> => {
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')?.textContent).toContain('Flint Free'))
    await type(messageInput(view), text)
    await act(async () => button(view, 'Send').click())
  }
  afterEach(() => {
    api.inbox.gitInfo.mockReset()
    api.inbox.gitInfo.mockImplementation(async () => ({ repository: false, branch: null, branches: [] }))
  })

  it('has no bar for a folder that is not a Git repository, or when Git cannot be asked', async () => {
    const view = await render()
    await vi.waitFor(() => expect(api.inbox.gitInfo).toHaveBeenCalledWith({ folderId: 'fld_app' }))
    expect(view.querySelector('[data-testid="worktree-bar"]')).toBeNull()
    api.inbox.gitInfo.mockRejectedValue(new Error('Git could not be run.'))
    const other = await render()
    await vi.waitFor(() => expect(api.inbox.gitInfo).toHaveBeenCalledTimes(2))
    expect(other.querySelector('[data-testid="worktree-bar"]')).toBeNull()
    expect(other.querySelector('[data-testid="chat-composer"]')).not.toBeNull()
  })

  it('runs in the folder by default, showing its branch, and sends no worktree request', async () => {
    api.inbox.gitInfo.mockResolvedValue(repo)
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    expect(view.querySelector('[data-testid="worktree-mode-picker"]')?.textContent).toBe('Current directory')
    expect(view.querySelector('[data-testid="worktree-current-branch"]')?.textContent).toBe('main')
    expect(view.querySelector('[data-testid="worktree-branch-picker"]')).toBeNull()
    await send(view, 'Add a dark mode')
    await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
    expect(api.chat.create.mock.calls[0]?.[0]).not.toHaveProperty('worktree')
  })

  it('has the GUI / Terminal chip in the same strip, ahead of the choice of where to run, and keeps it for a new worktree', async () => {
    api.inbox.gitInfo.mockResolvedValue(repo)
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    const strip = view.querySelector('[data-testid="worktree-bar"]')!
    const how = view.querySelector('[data-testid="thread-mode-picker"]')!
    const where = view.querySelector('[data-testid="worktree-mode-picker"]')!
    expect(strip.contains(how)).toBe(true)
    expect(how.textContent).toBe('GUI')
    expect(how.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // One strip: the one that holds only the chip, for a folder without Git, is gone once Git answered.
    expect(view.querySelector('[data-testid="thread-bar"]')).toBeNull()
    await open(how)
    await choose('Terminal')
    await open(where)
    await choose('New worktree')
    expect(view.querySelector('[data-testid="thread-mode-picker"]')?.textContent).toBe('Terminal')
    await send(view, 'Add a dark mode')
    await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'terminal', worktree: { base: 'main' } })))
  })

  it('has the strip, with only the GUI / Terminal chip in it, for a folder without Git, and keeps the chip where it is when Git answers', async () => {
    let answer!: (info: typeof repo) => void
    api.inbox.gitInfo.mockImplementation(() => new Promise((resolve) => { answer = resolve as typeof answer }))
    const view = await render()
    await vi.waitFor(() => expect(api.inbox.gitInfo).toHaveBeenCalled())
    expect(view.querySelector('[data-testid="thread-bar"] [data-testid="thread-mode-picker"]')).not.toBeNull()
    expect(view.querySelector('[data-testid="worktree-mode-picker"]')).toBeNull()
    // It leads the strip both times, so it does not move when the Git choices arrive after it. (happy-dom has no layout.)
    const first = (id: string): string | null => view.querySelector(`[data-testid="${id}"] button`)?.getAttribute('data-testid') ?? null
    expect(first('thread-bar')).toBe('thread-mode-picker')
    await act(async () => answer(repo))
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-mode-picker"]')).not.toBeNull())
    expect(view.querySelector('[data-testid="worktree-bar"] [data-testid="thread-mode-picker"]')).not.toBeNull()
    expect(first('worktree-bar')).toBe('thread-mode-picker')
  })

  it('names a detached HEAD', async () => {
    api.inbox.gitInfo.mockResolvedValue({ ...repo, branch: null })
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-current-branch"]')?.textContent).toBe('Detached HEAD'))
  })

  it('starts the thread in a new worktree from the current branch, or from the branch picked', async () => {
    api.inbox.gitInfo.mockResolvedValue(repo)
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
    await choose('New worktree')
    expect(view.querySelector('[data-testid="worktree-mode-picker"]')?.textContent).toBe('New worktree')
    expect(view.querySelector('[data-testid="worktree-current-branch"]')).toBeNull()
    expect(view.querySelector('[data-testid="worktree-branch-picker"]')?.textContent).toBe('From main')

    await open(view.querySelector('[data-testid="worktree-branch-picker"]')!)
    await vi.waitFor(() => expect(document.querySelector('[data-testid="worktree-branch-list"]')?.textContent).toContain('origin/main'))
    const list = document.querySelector('[data-testid="worktree-branch-list"]')!
    expect(Array.from(list.querySelectorAll('[role="group"]')).map((group) => group.getAttribute('aria-label'))).toEqual(['Local', 'Remote'])
    await choose('origin/main')
    expect(view.querySelector('[data-testid="worktree-branch-picker"]')?.textContent).toBe('From origin/main')

    await send(view, 'Add a dark mode')
    await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'fld_app', worktree: { base: 'origin/main' } })))
  })

  describe('project icons and the project manager', () => {
    const rocket: InboxFolder = { ...folder, icon: { kind: 'emoji', emoji: '🚀' } }
    const docs: InboxFolder = { ...folder, id: 'fld_docs', name: 'docs', directory: '/home/me/docs', icon: { kind: 'symbol', id: 'book', color: 'teal' } }
    const chooser = async (view: HTMLElement): Promise<HTMLElement> => {
      await open(view.querySelector('[data-testid="inbox-folder-picker"]')!)
      return vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>('[role="menu"]')
        expect(found).not.toBeNull()
        return found!
      })
    }
    const iconOf = (scope: Element | null | undefined): string | null | undefined =>
      scope?.querySelector('[data-testid="project-icon"]')?.getAttribute('data-icon')

    it('shows the chosen project’s icon in the heading, and the plain folder when it has none', async () => {
      useInboxChat.setState({ folders: [rocket, docs], composer: { folderId: 'fld_app' } })
      const view = await render()
      const picker = view.querySelector('[data-testid="inbox-folder-picker"]')!
      expect(iconOf(picker)).toBe('emoji')
      expect(picker.textContent).toBe('🚀app')
      await act(async () => useInboxChat.setState({ composer: { folderId: 'fld_docs' } }))
      expect(iconOf(picker)).toBe('book')
      await act(async () => useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' } }))
      expect(iconOf(picker)).toBe('folder')
    })

    it('shows each project’s icon in the chooser', async () => {
      useInboxChat.setState({ folders: [rocket, docs], composer: { folderId: 'fld_app' } })
      const view = await render()
      const menu = await chooser(view)
      const rows = Array.from(menu.querySelectorAll('[data-testid="inbox-folder-item"]'))
      expect(rows.map((row) => iconOf(row))).toEqual(['emoji', 'book'])
    })

    it('uses the icon of the project a worktree was cut from for the heading, and none in the chooser', async () => {
      const tree: InboxFolder = {
        id: 'fld_tree', name: 'app · mde/1a2b3c4d', directory: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', target: folder.target,
        createdAt: 2, lastUsedAt: 2,
        worktree: { repository: folder.directory, root: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', branch: 'mde/1a2b3c4d', base: 'main' },
      }
      useInboxChat.setState({ folders: [rocket, tree], composer: { folderId: 'fld_tree' } })
      const view = await render()
      const picker = view.querySelector('[data-testid="inbox-folder-picker"]')!
      expect(iconOf(picker)).toBe('emoji')
      const menu = await chooser(view)
      expect(menu.querySelector('[data-testid="inbox-worktree-folder"] [data-testid="project-icon"]')).toBeNull()
    })

    it('offers to add a project and to manage them, below the list', async () => {
      useInboxChat.setState({ folders: [rocket, docs], composer: { folderId: 'fld_app' } })
      const view = await render()
      const menu = await chooser(view)
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim())
      expect(items.slice(-2)).toEqual(['Add project…', 'Manage projects…'])
    })

    it('opens the project manager from the chooser, with the projects in it', async () => {
      useInboxChat.setState({ folders: [rocket, docs], composer: { folderId: 'fld_app' } })
      const view = await render()
      const menu = await chooser(view)
      expect(document.querySelector('[data-testid="inbox-projects"]')).toBeNull()
      await act(async () => menu.querySelector<HTMLElement>('[data-testid="inbox-folder-manage"]')!.click())
      const manager = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-testid="inbox-projects"]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(Array.from(manager.querySelectorAll('[data-testid="inbox-project-name"]')).map((item) => item.textContent)).toEqual(['app', 'docs'])
    })

    it('opens the add dialog from the chooser as before', async () => {
      // This file runs as Windows, where the form lists the WSL distros; the others have no use for them here.
      const refreshDistros = useWorkspace.getState().refreshDistros
      useWorkspace.setState({ distros: [], refreshDistros: vi.fn(async () => undefined) })
      try {
        const view = await render()
        const menu = await chooser(view)
        await act(async () => menu.querySelector<HTMLElement>('[data-testid="inbox-folder-add"]')!.click())
        await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add a project'))
        expect(document.querySelector('[data-testid="inbox-projects"]')).toBeNull()
      } finally {
        // Unmounted first: the form would run the real one again the moment it is put back.
        await act(async () => roots.splice(0).forEach((root) => root.unmount()))
        useWorkspace.setState({ refreshDistros })
      }
    })
  })

  describe('worktree folders', () => {
    const tree: InboxFolder = {
      id: 'fld_tree', name: 'app · mde/1a2b3c4d', directory: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', target: folder.target,
      createdAt: 2, lastUsedAt: 2,
      worktree: { repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', branch: 'mde/1a2b3c4d', base: 'origin/main' },
    }
    const chooser = async (view: HTMLElement): Promise<HTMLElement> => {
      await open(view.querySelector('[data-testid="inbox-folder-picker"]')!)
      return vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>('[role="menu"]')
        expect(found).not.toBeNull()
        return found!
      })
    }

    it('lists worktrees under the folders, saying they are worktrees and what they were based on', async () => {
      useInboxChat.setState({ folders: [tree, folder], composer: { folderId: 'fld_app' } })
      const view = await render()
      const menu = await chooser(view)
      const real = Array.from(menu.querySelectorAll('[data-testid="inbox-folder-item"]'))
      const trees = Array.from(menu.querySelectorAll('[data-testid="inbox-worktree-folder"]'))
      expect(real.map((item) => item.textContent)).toEqual(['app/home/me/app · Ubuntu'])
      expect(trees).toHaveLength(1)
      expect(trees[0]?.textContent).toContain('mde/1a2b3c4d')
      expect(trees[0]?.textContent).toContain('Worktree')
      expect(trees[0]?.textContent).toContain('Based on origin/main in app')
      expect(menu.textContent).toContain('Worktrees')
      // The real folders come first, whatever was used last.
      const order = Array.from(menu.querySelectorAll('[data-testid]')).map((item) => item.getAttribute('data-testid'))
      expect(order.indexOf('inbox-folder-item')).toBeLessThan(order.indexOf('inbox-worktree-folder'))
    })

    it('shows no Worktrees group when there are none', async () => {
      const view = await render()
      const menu = await chooser(view)
      expect(menu.textContent).not.toContain('Worktrees')
      expect(menu.querySelector('[data-testid="inbox-worktree-folder"]')).toBeNull()
    })

    it('names the original folder from its directory when that folder is no longer in the Inbox', async () => {
      useInboxChat.setState({ folders: [tree], composer: { folderId: 'fld_tree' } })
      const view = await render()
      const menu = await chooser(view)
      expect(menu.querySelector('[data-testid="inbox-worktree-folder"]')?.textContent).toContain('Based on origin/main in app')
    })

    it('starts on a real folder, not a worktree, when nothing was chosen before', async () => {
      useInboxChat.setState({ folders: [tree, folder], composer: {} })
      const view = await render()
      expect(view.querySelector('[data-testid="inbox-folder-picker"]')?.textContent).toBe('app')
    })

    it('says what the folder in the heading is when it is a worktree', async () => {
      useInboxChat.setState({ folders: [folder, tree], composer: { folderId: 'fld_tree' } })
      const view = await render()
      const picker = view.querySelector('[data-testid="inbox-folder-picker"]')!
      expect(picker.textContent).toBe('app · mde/1a2b3c4d')
      expect(picker.getAttribute('title')).toContain('Worktree of app, based on origin/main')
      expect(picker.getAttribute('title')).toContain('/home/me/.mde/worktrees/app-abc/1a2b3c4d')
    })

    it('starts a thread in the chosen worktree, with no choice of where to run and no new worktree', async () => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      useInboxChat.setState({ folders: [folder, tree], composer: { folderId: 'fld_app' } })
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-mode-picker"]')).not.toBeNull())
      const menu = await chooser(view)
      await act(async () => Array.from(menu.querySelectorAll<HTMLElement>('[data-testid="inbox-worktree-folder"]'))[0]!.click())
      await vi.waitFor(() => expect(api.inbox.gitInfo).toHaveBeenLastCalledWith({ folderId: 'fld_tree' }))
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-fixed"]')).not.toBeNull())
      expect(view.querySelector('[data-testid="worktree-mode-picker"]')).toBeNull()
      expect(view.querySelector('[data-testid="worktree-branch-name"]')).toBeNull()
      expect(view.querySelector('[data-testid="worktree-fixed"]')?.textContent).toBe('Worktree')
      expect(view.querySelector('[data-testid="worktree-current-branch"]')?.textContent).toBe('main')
      // How the thread is shown is still a choice there.
      expect(view.querySelector('[data-testid="worktree-bar"] [data-testid="thread-mode-picker"]')?.textContent).toBe('GUI')
      await send(view, 'More work')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.chat.create.mock.calls[0]?.[0]).toMatchObject({ folderId: 'fld_tree', text: 'More work' })
      expect(api.chat.create.mock.calls[0]?.[0]).not.toHaveProperty('worktree')
    })

    it('does not carry a half-made choice for the folder over into a worktree folder', async () => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      useInboxChat.setState({ folders: [folder, tree], composer: { folderId: 'fld_app' } })
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-mode-picker"]')).not.toBeNull())
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('New worktree')
      await act(async () => useInboxChat.setState({ composer: { folderId: 'fld_tree' } }))
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-fixed"]')).not.toBeNull())
      await send(view, 'More work')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.chat.create.mock.calls[0]?.[0]).not.toHaveProperty('worktree')
    })

    it('reads the folders again after a thread was started in a new worktree, so the worktree is listed', async () => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
      api.inbox.folders.mockResolvedValueOnce({ folders: [folder, tree], composer: { folderId: 'fld_app' } })
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('New worktree')
      await send(view, 'Add a dark mode')
      await vi.waitFor(() => expect(api.inbox.folders).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(useInboxChat.getState().folders.map((item) => item.id)).toEqual(['fld_app', 'fld_tree']))
    })

    it('does not read the folders again after an ordinary thread', async () => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
      await send(view, 'Add a dark mode')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.inbox.folders).not.toHaveBeenCalled()
    })

    it('says in the trash button that removing a worktree from the list leaves it on disk', async () => {
      useInboxChat.setState({ folders: [folder, tree], composer: { folderId: 'fld_app' } })
      const view = await render()
      const menu = await chooser(view)
      const removers = Array.from(menu.querySelectorAll('button[aria-label^="Remove "]'))
      expect(removers.map((item) => item.getAttribute('title'))).toEqual(['Remove from the Inbox', 'Remove from the Inbox (the worktree stays on disk)'])
    })
  })

  describe('naming the new branch', () => {
    const nameField = (view: HTMLElement): HTMLInputElement => view.querySelector<HTMLInputElement>('[data-testid="worktree-branch-name"]')!
    const setName = async (view: HTMLElement, value: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameField(view), value)
        nameField(view).dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const inWorktreeMode = async (): Promise<HTMLElement> => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('New worktree')
      return view
    }
    const problem = (view: HTMLElement): string | undefined => view.querySelector('[data-testid="worktree-branch-problem"]')?.textContent ?? undefined

    it('offers the field only for a new worktree, empty so that the name is automatic', async () => {
      api.inbox.gitInfo.mockResolvedValue(repo)
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
      expect(nameField(view)).toBeNull()
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('New worktree')
      expect(nameField(view).value).toBe('')
      expect(nameField(view).placeholder).toBe('New branch name (auto)')
      expect(problem(view)).toBeUndefined()
    })

    it('sends the name that was typed, without surrounding spaces', async () => {
      const view = await inWorktreeMode()
      await setName(view, '  feature/dark-mode ')
      expect(problem(view)).toBeUndefined()
      await send(view, 'Add a dark mode')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.chat.create.mock.calls[0]?.[0]).toMatchObject({ worktree: { base: 'main', branch: 'feature/dark-mode' } })
    })

    it('sends no name when the field is empty or only spaces, so the name stays automatic', async () => {
      const view = await inWorktreeMode()
      await setName(view, '   ')
      await send(view, 'Add a dark mode')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.chat.create.mock.calls[0]?.[0].worktree).toEqual({ base: 'main' })
    })

    it('does not send the name when the thread runs in the folder, even if one was typed', async () => {
      const view = await inWorktreeMode()
      await setName(view, 'feature/dark-mode')
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('Current directory')
      await send(view, 'Add a dark mode')
      await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledTimes(1))
      expect(api.chat.create.mock.calls[0]?.[0]).not.toHaveProperty('worktree')
    })

    it('says why a name cannot be used and does not send until it is fixed', async () => {
      const view = await inWorktreeMode()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')?.textContent).toContain('Flint Free'))
      await type(messageInput(view), 'Add a dark mode')
      for (const [name, message] of [
        ['two words', /spaces/], ['--force', /start with -/], ['a..b', /\.\./], ['main', /already exists/],
        ['main/sub', /so main\/sub cannot be created/], ['feature', /Branches under feature\/ already exist/],
      ] as const) {
        await setName(view, name)
        expect(problem(view), name).toMatch(message)
        expect(nameField(view).getAttribute('aria-invalid')).toBe('true')
        expect(button(view, 'Send').disabled, name).toBe(true)
      }
      expect(api.chat.create).not.toHaveBeenCalled()
      await setName(view, 'feature/dark-mode')
      expect(problem(view)).toBeUndefined()
      expect(nameField(view).getAttribute('aria-invalid')).toBeNull()
      expect(button(view, 'Send').disabled).toBe(false)
    })

    it('ignores remote-tracking branches, which live apart from local ones', async () => {
      const view = await inWorktreeMode()
      // `origin/main` is a remote-tracking branch; a local branch called `origin` does not clash with it.
      await setName(view, 'origin')
      expect(problem(view)).toBeUndefined()
    })

    it('starts with an empty field again when another folder is chosen', async () => {
      const second: InboxFolder = { ...folder, id: 'fld_other', name: 'other', directory: '/home/me/other' }
      useInboxChat.setState({ folders: [folder, second] })
      const view = await inWorktreeMode()
      await setName(view, 'feature/dark-mode')
      await act(async () => useInboxChat.setState({ composer: { folderId: 'fld_other' } }))
      await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-mode-picker"]')?.textContent).toBe('Current directory'))
      await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
      await choose('New worktree')
      expect(nameField(view).value).toBe('')
    })
  })

  it('filters the branch list as the user types', async () => {
    api.inbox.gitInfo.mockResolvedValue(repo)
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
    await choose('New worktree')
    await open(view.querySelector('[data-testid="worktree-branch-picker"]')!)
    const search = await vi.waitFor(() => {
      const found = document.querySelector<HTMLInputElement>('input[aria-label="Search branches"]')
      expect(found).not.toBeNull()
      return found!
    })
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'LOGIN')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const names = Array.from(document.querySelectorAll('[data-testid="worktree-branch-list"] [role="menuitem"]')).map((item) => item.textContent)
    expect(names).toEqual(['feature/login'])
  })

  it('goes back to the folder itself when another folder is chosen', async () => {
    const second: InboxFolder = { ...folder, id: 'fld_other', name: 'other', directory: '/home/me/other' }
    useInboxChat.setState({ folders: [folder, second] })
    api.inbox.gitInfo.mockResolvedValue(repo)
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
    await choose('New worktree')
    await act(async () => useInboxChat.setState({ composer: { folderId: 'fld_other' } }))
    await vi.waitFor(() => expect(api.inbox.gitInfo).toHaveBeenCalledWith({ folderId: 'fld_other' }))
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-mode-picker"]')?.textContent).toBe('Current directory'))
  })

  it('offers no worktree in a repository that has no branches yet', async () => {
    api.inbox.gitInfo.mockResolvedValue({ repository: true, branch: null, branches: [] })
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="worktree-bar"]')).not.toBeNull())
    await open(view.querySelector('[data-testid="worktree-mode-picker"]')!)
    const item = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-testid="worktree-mode-worktree"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain('no branches yet')
  })
})

describe('Inbox conversation', () => {
  it.each([
    [undefined, 'high'],
    ['high', undefined],
  ] as const)('sends an effort-only change from %s to %s for the same model', async (before, after) => {
    const previous = { ...options.defaultModel!, ...(before ? { variant: before } : {}) }
    api.chat.options.mockResolvedValue({ ...options, models: [{ ...options.models[0]!, variants: ['low', 'high'] }] })
    page = { running: false, older: null, messages: [
      { kind: 'assistant', id: 'msg_effort', time: 1, agent: 'build', model: previous, completed: true, parts: [{ kind: 'text', text: 'Ready.' }] },
    ] }
    useWorkspace.setState({ inboxThreads: [thread({ model: previous })], selectedInboxThreadId: 'ses_one' })
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
      await act(async () => button(view, 'Model').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      const choice = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
        .find((item) => item.textContent === (after ? 'High' : 'DefaultUse model settings'))!
      await act(async () => choice.click())
      await type(messageInput(view), 'Continue')
      await act(async () => button(view, 'Send').click())
      expect(api.chat.send).toHaveBeenLastCalledWith(expect.objectContaining({
        threadId: 'ses_one', text: 'Continue', model: { ...options.defaultModel!, ...(after ? { variant: after } : {}) },
      }))
    } finally {
      api.chat.options.mockResolvedValue(options)
    }
  })

  it('regenerates the selected title, keeps pending state across navigation, and follows title updates', async () => {
    const original = thread({ archived: true })
    useWorkspace.setState({ inboxThreads: [original, thread({ id: 'ses_two', title: 'Other' })], selectedInboxThreadId: original.id })
    let finish!: () => void
    api.chat.regenerateTitle.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = await render()
    const regenerating = (): boolean => view.querySelector('[role="status"][aria-label="Regenerating title"]') !== null
    expect(regenerating()).toBe(false)
    await threadAction(view, 'Regenerate title')
    expect(api.chat.regenerateTitle).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(regenerating()).toBe(true)
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
    expect(regenerating()).toBe(false)
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }))
    expect(regenerating()).toBe(true)
    // The item cannot be picked again while the request runs.
    await act(async () => button(view, 'Thread actions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).find((entry) => entry.textContent === 'Regenerate title')?.hasAttribute('data-disabled')).toBe(true)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => {
      useWorkspace.getState().upsertInboxThread({ ...original, title: 'Updated title' })
      finish()
    })
    expect(view.querySelector('h2')?.textContent).toBe('Updated title')
    expect(regenerating()).toBe(false)
    expect(useWorkspace.getState().inboxThreads.find((item) => item.id === original.id)?.title).toBe('Updated title')
  })

  it('shows title errors only on their thread and permits retry', async () => {
    useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two' })], selectedInboxThreadId: 'ses_one' })
    api.chat.regenerateTitle.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:regenerate-title': Error: Service unavailable"))
    const view = await render()
    await threadAction(view, 'Regenerate title')
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Service unavailable')
    expect(view.querySelector('h2')?.textContent).toBe('Fix login')
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
    expect(view.querySelector('[role="alert"]')).toBeNull()
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }))
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Service unavailable')
    await threadAction(view, 'Regenerate title')
    expect(view.querySelector('[role="alert"]')).toBeNull()
    expect(api.chat.regenerateTitle).toHaveBeenCalledTimes(2)
  })

  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  it('shows messages, tools and reasoning, and streams new text', async () => {
    page = {
      running: true,
      older: null,
      messages: [
        { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
        {
          kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true,
          parts: [
            { kind: 'reasoning', text: 'Looking at auth.ts' },
            { kind: 'tool', id: 'call_1', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: '1: export {}' },
          ],
        },
      ],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Fix the login'))
    expect(api.chat.subscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('Read src/auth.ts')
    expect(view.querySelector('[data-testid="chat-reasoning"]')?.textContent).toContain('Thought')
    // Expanding a tool shows its input and output.
    await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_1"] button')!.click())
    expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('export {}')
    expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull()

    await act(async () => {
      useInboxChat.getState().applyEvent({ type: 'delta', threadId: 'ses_one', messageId: 'msg_3', part: 'text', ordinal: 0, delta: 'Streaming ' })
      useInboxChat.getState().applyEvent({ type: 'delta', threadId: 'ses_one', messageId: 'msg_3', part: 'text', ordinal: 0, delta: 'answer' })
    })
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-message-msg_3"]')?.textContent).toContain('Streaming answer'))
  })

  it('shows the skills a message used and the skills the agent loaded', async () => {
    const wrapped = (body: string, files: string[] = []): string =>
      `<skill_content name="demo">\n# Skill: demo\n\n${body}\n\nBase directory for this skill: /home/me/app/.claude/skills/demo\nRelative paths in this skill are relative to this base directory.\n\n<skill_files>\n${files.map((file) => `<file>${file}</file>`).join('\n')}\n</skill_files>\n</skill_content>`
    page.messages = [
      { kind: 'user', id: 'msg_1', time: 1, text: 'use $demo please', skills: [{ id: 'demo', name: 'Demo skill' }] },
      {
        kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true,
        parts: [
          { kind: 'tool', id: 'call_skill', name: 'skill', status: 'completed', input: '{"id":"demo"}', output: wrapped('Reply with PINEAPPLE.', ['/home/me/app/.claude/skills/demo/scripts/run.sh']) },
          { kind: 'tool', id: 'call_missing', name: 'skill', status: 'error', input: '{"id":"nope"}', error: 'Skill not found: nope' },
          { kind: 'tool', id: 'call_loading', name: 'skill', status: 'running', input: '{"id":"later"}' },
        ],
      },
      { kind: 'note', id: 'msg_3', time: 3, tone: 'info', text: 'Loaded the review skill', detail: '# Review\n\nLook at the diff.' },
    ]
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('use $demo please'))
    // The message keeps its words and shows which skill they brought in.
    expect(view.querySelector('[data-testid="chat-skill-demo"]')?.textContent).toBe('Demo skill')
    expect(view.querySelector('[data-testid="chat-message-msg_1"]')?.textContent).toContain('use $demo please')

    // Three steps in a row are folded into one line; opening it shows the steps.
    const group = view.querySelector<HTMLElement>('[data-testid="chat-activity"]')!
    expect(group.textContent).toContain('Loading 3 skills')
    expect(view.querySelector('[data-testid="chat-tool-call_skill"]')).toBeNull()
    await act(async () => group.querySelector<HTMLButtonElement>(':scope > button')!.click())
    const loaded = view.querySelector('[data-testid="chat-tool-call_skill"]')!
    expect(loaded.textContent).toContain('Loaded the demo skill')
    expect(loaded.textContent).not.toContain('PINEAPPLE')
    await act(async () => loaded.querySelector('button')!.click())
    expect(loaded.textContent).toContain('Instructions')
    expect(loaded.textContent).toContain('Reply with PINEAPPLE.')
    expect(loaded.textContent).toContain('/home/me/app/.claude/skills/demo/scripts/run.sh')
    // OpenCode's wrapper and its note about the directory are not for reading.
    expect(loaded.textContent).not.toContain('skill_content')
    expect(loaded.textContent).not.toContain('Base directory')

    expect(view.querySelector('[data-testid="chat-tool-call_missing"]')?.textContent).toContain('Could not load the nope skill — Skill not found: nope')
    expect(view.querySelector('[data-testid="chat-tool-call_loading"]')?.textContent).toContain('Loading the later skill')

    // A skill the user brought in by other means arrives as a note with its text.
    const note = view.querySelector('[data-testid="chat-message-msg_3"]')!
    expect(note.textContent).toContain('Loaded the review skill')
    await act(async () => note.querySelector('button')!.click())
    expect(note.textContent).toContain('Look at the diff.')
  })

  it('renders expanded reasoning as read-only Markdown', async () => {
    page.messages = [{
      kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true,
      parts: [{ kind: 'reasoning', text: [
        '## Plan',
        '',
        'Check **authentication**, *sessions* and ~~old logic~~ in `auth.ts`.',
        '',
        '- Inspect login',
        '- Inspect logout',
        '',
        '1. Read the code',
        '2. Check the tests',
        '',
        '> Preserve existing sessions.',
        '',
        '```ts',
        'const valid = true',
        '```',
        '',
        '| Check | State |',
        '| --- | --- |',
        '| Login | Pending |',
        '',
        '- [x] Read the request',
        '- [ ] Verify the fix',
      ].join('\n') }],
    }]
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-reasoning"]')).not.toBeNull())
    const reasoning = view.querySelector<HTMLElement>('[data-testid="chat-reasoning"]')!
    const toggle = reasoning.querySelector('button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(reasoning.querySelector('.chat-markdown')).toBeNull()

    await act(async () => toggle.click())
    const prose = reasoning.querySelector<HTMLElement>('[aria-label="Assistant reasoning"]')!
    expect(prose.getAttribute('contenteditable')).toBe('false')
    expect(prose.querySelector('h2')?.textContent).toBe('Plan')
    expect(prose.querySelector('strong')?.textContent).toBe('authentication')
    expect(prose.querySelector('em')?.textContent).toBe('sessions')
    expect(prose.querySelector('s')?.textContent).toBe('old logic')
    expect(prose.querySelector('p code')?.textContent).toBe('auth.ts')
    expect(prose.querySelectorAll('ul:not([data-type="taskList"]) > li')).toHaveLength(2)
    expect(prose.querySelectorAll('ol > li')).toHaveLength(2)
    expect(prose.querySelector('blockquote')?.textContent).toBe('Preserve existing sessions.')
    expect(prose.querySelector('pre code.language-ts')?.textContent).toBe('const valid = true')
    expect(prose.querySelector('table')?.textContent).toContain('LoginPending')
    expect(prose.querySelectorAll('ul[data-type="taskList"] input')).toHaveLength(2)

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(reasoning.querySelector('.chat-markdown')).toBeNull()
  })

  it('formats reasoning deltas while expanded and shows the latest Markdown when reopened', async () => {
    page.running = true
    page.messages = [{
      kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: false,
      parts: [{ kind: 'reasoning', text: '**Inspect' }],
    }]
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-reasoning"]')).not.toBeNull())
    const reasoning = view.querySelector<HTMLElement>('[data-testid="chat-reasoning"]')!
    const toggle = reasoning.querySelector('button')!
    expect(toggle.textContent).toContain('Thinking')
    // Streamed chunks accumulate from the start, alongside the fetched snapshot.
    await act(async () => useInboxChat.getState().applyEvent({
      type: 'delta', threadId: 'ses_one', messageId: 'msg_2', part: 'reasoning', ordinal: 0,
      delta: '**Inspect',
    }))
    await act(async () => toggle.click())

    await act(async () => useInboxChat.getState().applyEvent({
      type: 'delta', threadId: 'ses_one', messageId: 'msg_2', part: 'reasoning', ordinal: 0,
      delta: ' authentication**\n\n- Read `auth.ts`',
    }))
    await vi.waitFor(() => {
      expect(reasoning.querySelector('strong')?.textContent).toBe('Inspect authentication')
      expect(reasoning.querySelector('li code')?.textContent).toBe('auth.ts')
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    await act(async () => toggle.click())
    await act(async () => useInboxChat.getState().applyEvent({
      type: 'delta', threadId: 'ses_one', messageId: 'msg_2', part: 'reasoning', ordinal: 0,
      delta: '\n- Run **tests**',
    }))
    await act(async () => toggle.click())
    expect(reasoning.querySelectorAll('li')).toHaveLength(2)
    expect(reasoning.querySelector('li strong')?.textContent).toBe('tests')
  })

  it('keeps unsafe HTML and image embeds out of reasoning and opens only web links', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      page.messages = [{
        kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true,
        parts: [{ kind: 'reasoning', text: [
          '<script>alert(1)</script>',
          '',
          '<iframe src="https://example.com/embed"></iframe>',
          '',
          '<img src="https://example.com/tracker" onerror="alert(1)">',
          '',
          '<p onclick="alert(1)">Check this safely.</p>',
          '',
          '![Remote image](https://example.com/tracker.png)',
          '',
          '[Script](javascript:alert%281%29) [Data](data:text/html,unsafe)',
          '',
          '[Email](mailto:test@example.com) [Local](file:///tmp/private) [Relative](./auth.ts)',
          '',
          '[**Documentation**](https://example.com/docs)',
        ].join('\n') }],
      }]
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-reasoning"]')).not.toBeNull())
      const reasoning = view.querySelector<HTMLElement>('[data-testid="chat-reasoning"]')!
      await act(async () => reasoning.querySelector('button')!.click())
      expect(reasoning.querySelector('script, iframe, img, object, embed, style, [onclick], [onerror]')).toBeNull()
      expect(reasoning.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull()
      expect(open).not.toHaveBeenCalled()

      for (const link of Array.from(reasoning.querySelectorAll<HTMLAnchorElement>('a:not([href^="https:"])'))) {
        const event = new Event('click', { bubbles: true, cancelable: true })
        await act(async () => { link.dispatchEvent(event) })
        expect(event.defaultPrevented).toBe(true)
      }
      expect(open).not.toHaveBeenCalled()

      const link = reasoning.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]')!
      expect(link.target).toBe('_blank')
      expect(link.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
      // A click on formatted text inside the link follows the same checked route.
      const event = new Event('click', { bubbles: true, cancelable: true })
      await act(async () => { link.querySelector('strong')!.dispatchEvent(event) })
      expect(event.defaultPrevented).toBe(true)
      expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
    } finally {
      open.mockRestore()
    }
  })

  it('shows parallel subagents as cards with their task and result', async () => {
    const input = (description: string) => JSON.stringify({ agent: 'explore', description, prompt: `Look at ${description}.\nDo not edit files.` })
    page = {
      running: true, older: null,
      messages: [{
        kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: false,
        parts: [
          { kind: 'text', text: 'Launching two subagents.' },
          { kind: 'tool', id: 'call_a', name: 'subagent', status: 'running', input: input('structure'), subagent: { sessionId: 'ses_a', model: { ...options.defaultModel!, variant: 'high' } } },
          { kind: 'tool', id: 'call_b', name: 'subagent', status: 'completed', input: input('logic'), output: '<subagent sessionID="ses_c" state="completed">\nThe **core** loop is in `main.ts`.\n</subagent>' },
        ],
      }],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-subagents"]')).not.toBeNull())
    expect(view.querySelectorAll('[data-testid="chat-subagents"]')).toHaveLength(1)
    expect(view.querySelector('[data-testid="chat-subagents"]')?.textContent).toContain('2 subagents · 1 working')
    const running = view.querySelector<HTMLElement>('[data-testid="chat-subagent-call_a"]')!
    expect(running.textContent).toContain('structure')
    expect(running.textContent).toContain('Working')
    expect(running.textContent).not.toContain('"agent"')
    const model = running.querySelector('[aria-label="Model: Flint Free · high"]')!
    expect(model.textContent).toBe('Flint Free · high')
    expect(model.getAttribute('title')).toBe('opencode/free-1#high')
    await act(async () => running.querySelector('button')!.click())
    expect(running.textContent).toContain('Flint Free · high')
    const done = view.querySelector<HTMLElement>('[data-testid="chat-subagent-call_b"]')!
    expect(done.textContent).toContain('Done')
    expect(done.textContent).not.toContain('core loop')
    await act(async () => done.querySelector('button')!.click())
    expect(done.textContent).toContain('Do not edit files.')
    await vi.waitFor(() => expect(done.textContent).toContain('The core loop is in main.ts.'))
    expect(done.textContent).not.toContain('sessionID')
  })

  it('shows raw model IDs when unlisted and leaves unavailable subagent models explicit', async () => {
    page = {
      running: true, older: null,
      messages: [{
        kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: false,
        parts: [
          { kind: 'tool', id: 'call_known', name: 'subagent', status: 'running', input: '{}', subagent: { sessionId: 'ses_child', model: { id: 'custom-model', providerId: 'custom' } } },
          { kind: 'tool', id: 'call_unknown', name: 'subagent', status: 'running', input: '{}', subagent: { sessionId: 'ses_unknown' } },
          { kind: 'tool', id: 'call_starting', name: 'subagent', status: 'pending', input: '' },
        ],
      }],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[aria-label="Model: custom-model"]')).not.toBeNull())
    expect(view.querySelector('[aria-label="Model: custom-model"]')?.getAttribute('title')).toBe('custom/custom-model')
    const unknown = view.querySelector('[data-testid="chat-subagent-call_unknown"]')!
    expect(unknown.textContent).toContain('Model unavailable')
    expect(unknown.textContent).not.toContain('Flint Free')
    expect(view.querySelector('[data-testid="chat-subagent-call_starting"]')?.textContent).not.toContain('Model unavailable')
  })

  it('stops a running thread and sends follow-ups with a changed agent only', async () => {
    page = {
      running: true, older: null,
      messages: [{ kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [] }],
    }
    const view = await render()
    await vi.waitFor(() => expect(button(view, 'Stop')).toBeTruthy())
    await act(async () => button(view, 'Stop').click())
    expect(api.chat.interrupt).toHaveBeenCalledWith({ threadId: 'ses_one' })

    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build'))
    await type(messageInput(view), 'Thanks')
    // This mock still reports the thread as working after the Stop, so the follow-up is a steering one.
    await act(async () => button(view, 'Steer').click())
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledWith({ threadId: 'ses_one', text: 'Thanks', attachmentIds: [], draftRevision: 1, delivery: 'steer' }))
  })

  describe('file changes', () => {
    const model = options.defaultModel!
    const patch = [
      'Index: /home/me/app/src/auth.ts', '='.repeat(67), '--- /home/me/app/src/auth.ts', '+++ /home/me/app/src/auth.ts',
      '@@ -8,5 +8,5 @@', ' export function total(items: string[]) {', '-  return items.length', '+  return items.size', ' }', ' ', ' export const limit = 3', '',
    ].join('\n')
    type Tool = Extract<ChatMessagesPage['messages'][number], { kind: 'assistant' }>['parts'][number]
    const assistant = (...parts: Tool[]): ChatMessagesPage['messages'][number] =>
      ({ kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts })
    const edit = (overrides: Record<string, unknown> = {}): Tool => ({
      kind: 'tool', id: 'call_1', name: 'edit', status: 'completed',
      input: JSON.stringify({ filePath: '/home/me/app/src/auth.ts', oldString: '  return items.length', newString: '  return items.size' }),
      output: 'Edited auth.ts (1 replacement)',
      patches: [{ path: '/home/me/app/src/auth.ts', patch }],
      ...overrides,
    } as Tool)
    const card = (view: HTMLElement): HTMLElement | null => view.querySelector('[data-testid="chat-diff"]')
    const rows = (view: HTMLElement): { kind: string | null; text: string }[] =>
      Array.from(view.querySelectorAll('.file-diff-row')).map((row) => ({ kind: row.getAttribute('data-kind'), text: row.querySelector('.file-diff-code')?.textContent ?? '' }))

    it.each(['completed', 'running'] as const)('follows the code preview font in %s tools and newly expanded details', async (status) => {
      const stored = localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)
      const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { check: (query: string) => query.includes('Fira Code') || query.includes('JetBrains Mono') },
      })
      // happy-dom does not apply cascade layers; load the actual font rule outside its layer.
      const css = readFileSync(join(__dirname, '../src/renderer/index.css'), 'utf8')
      const rule = css.match(/\.inbox-code-font,\s*\.file-diff\s*\{[^}]+\}/)?.[0]
      expect(rule).toBeTruthy()
      const style = document.createElement('style')
      style.textContent = `:root { --font-mono: monospace; }\n${rule}`
      document.head.append(style)
      try {
        saveTerminalSettings({ ...getTerminalSettings(), family: 'JetBrains Mono', codeFamily: 'Fira Code' })
        page = { running: status === 'running', older: null, messages: [assistant(
          edit({ status }),
          { kind: 'tool', id: 'call_write', name: 'write', status, existed: false, input: JSON.stringify({ filePath: '/home/me/app/new.ts', content: 'export const a = 1\n' }) },
          { kind: 'tool', id: 'call_read', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: 'file contents' },
          edit({ id: 'call_failed', status: 'error', error: 'Edit failed' }),
        )] }
        const view = await render()
        await vi.waitFor(() => expect(card(view)).not.toBeNull())
        const diff = view.querySelector('.file-diff-code')!
        await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_read"] button')!.click())
        const codeNodes = (): Element[] => Array.from(view.querySelectorAll(
          '.file-diff-code, .file-diff-gutter, .file-diff-sign, .inbox-code-font',
        ))
        expect(codeNodes().length).toBeGreaterThan(10)
        expect(view.querySelector('[data-testid="chat-tool-call_read"] pre')).not.toBeNull()
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('Fira Code')

        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), codeFamily: 'JetBrains Mono' }))
        expect(view.querySelector('.file-diff-code')).toBe(diff)
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')

        await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_failed"] button')!.click())
        const details = Array.from(view.querySelectorAll('[data-testid="chat-tool-call_failed"] pre'))
        expect(details.length).toBeGreaterThan(0)
        for (const node of details) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')

        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), family: 'Fira Code' }))
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')
        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), codeFamily: 'monospace' }))
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toBe('monospace')
      } finally {
        style.remove()
        if (fonts) Object.defineProperty(document, 'fonts', fonts)
        else delete (document as { fonts?: unknown }).fonts
        if (stored === null) localStorage.removeItem(TERMINAL_SETTINGS_STORAGE_KEY)
        else localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, stored)
      }
    })

    it('draws a finished edit as a numbered diff instead of raw JSON', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Edited src/auth.ts')
      expect(view.querySelector('.file-diff[data-quiet]')).toBeNull()
      expect(card(view)?.querySelector('[data-testid="chat-diff-stats"]')?.textContent).toBe('+1−1')
      expect(rows(view)).toEqual([
        { kind: 'context', text: 'export function total(items: string[]) {' },
        { kind: 'del', text: '  return items.length' },
        { kind: 'add', text: '  return items.size' },
        { kind: 'context', text: '}' },
        { kind: 'context', text: '' },
        { kind: 'context', text: 'export const limit = 3' },
      ])
      // The numbers: a deleted line has its old number, the others their new one.
      expect(Array.from(view.querySelectorAll('.file-diff-gutter')).map((cell) => cell.textContent)).toEqual(['8', '9', '9', '10', '11', '12'])
      expect(view.textContent).not.toContain('oldString')
      expect(view.textContent).not.toContain('Index:')
    })

    it('marks the words that changed within a line', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      const marked = Array.from(view.querySelectorAll('.file-diff-row')).map((row) =>
        Array.from(row.querySelectorAll('.file-diff-emphasis')).map((span) => span.textContent).join(''))
      expect(marked).toEqual(['', 'length', 'size', '', '', ''])
    })

    it('colors the code by its language once that has loaded', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('.file-diff-row[data-kind="del"]')?.innerHTML).toContain('--color-syntax-keyword'))
      // Colors never change the text.
      expect(rows(view)[1]!.text).toBe('  return items.length')
    })

    it('shows an edit that waits for permission with the change it asks for', async () => {
      page = { running: true, older: null, messages: [assistant(edit({ status: 'running', patches: undefined, output: undefined }))] }
      requests = { permissions: [{ id: 'per_1', action: 'edit', resources: ['src/auth.ts'] }], forms: [] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Editing src/auth.ts')
      expect(rows(view)).toEqual([{ kind: 'del', text: '  return items.length' }, { kind: 'add', text: '  return items.size' }])
      // Without OpenCode's diff there are no line numbers.
      expect(view.querySelector('.file-diff-gutter')).toBeNull()
    })

    it('folds the diff away from its header', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      const header = card(view)!.querySelector('button')!
      expect(header.getAttribute('aria-expanded')).toBe('true')
      await act(async () => header.click())
      expect(header.getAttribute('aria-expanded')).toBe('false')
      expect(view.querySelector('.file-diff-row')).toBeNull()
      expect(card(view)?.textContent).toContain('src/auth.ts')
      await act(async () => header.click())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(6)
    })

    it('shows a written file as additions, and says whether it replaced one', async () => {
      const write = (existed: boolean | undefined): Tool => ({
        kind: 'tool', id: 'call_2', name: 'write', status: 'completed',
        input: JSON.stringify({ filePath: '/home/me/app/NOTES.md', content: '# Notes\n\nHello\n' }),
        ...(existed === undefined ? {} : { existed }),
      } as Tool)
      page = { running: false, older: null, messages: [assistant(write(false))] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Created NOTES.md')
      expect(card(view)?.querySelector('[data-testid="chat-diff-stats"]')?.textContent).toBe('+3')
      expect(rows(view).map((row) => row.kind)).toEqual(['add', 'add', 'add'])
      // A whole file is tinted lightly; an edit's changed lines are not.
      expect(view.querySelector('.file-diff[data-quiet]')).not.toBeNull()
      expect(Array.from(view.querySelectorAll('.file-diff-gutter')).map((cell) => cell.textContent)).toEqual(['1', '2', '3'])

      page = { running: false, older: null, messages: [assistant(write(true))] }
      await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
      await vi.waitFor(() => expect(card(view)?.getAttribute('aria-label')).toBe('Overwrote NOTES.md'))
    })

    it('keeps the plain row, with the reason, for an edit that failed', async () => {
      page = { running: false, older: null, messages: [assistant(edit({ status: 'error', patches: undefined, output: undefined, error: 'Found 2 matches for oldString' }))] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-tool-call_1"]')).not.toBeNull())
      expect(card(view)).toBeNull()
      expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('Found 2 matches for oldString')
    })

    it('shortens a long diff and shows the rest on request', async () => {
      const body = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n')
      const write: Tool = { kind: 'tool', id: 'call_3', name: 'write', status: 'completed', input: JSON.stringify({ filePath: '/home/me/app/long.txt', content: body }), existed: false }
      page = { running: false, older: null, messages: [assistant(write)] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(28)
      expect(button(view, 'Show 32 more lines')).toBeTruthy()
      await act(async () => button(view, 'Show 32 more lines').click())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(60)
      expect(() => button(view, 'Show 32 more lines')).toThrow()
    })

    it('leaves other tools as they were', async () => {
      page = { running: false, older: null, messages: [assistant({ kind: 'tool', id: 'call_4', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: 'x' })] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-tool-call_4"]')).not.toBeNull())
      expect(card(view)).toBeNull()
      expect(view.querySelector('[data-testid="chat-tool-call_4"]')?.textContent).toContain('Read src/auth.ts')
    })
  })

  describe('time worked', () => {
    const model = options.defaultModel!
    const user = (id: string, time: number): ChatMessagesPage['messages'][number] => ({ kind: 'user', id, time, text: `Ask ${id}` })
    const step = (id: string, time: number, completedAt?: number): ChatMessagesPage['messages'][number] => ({
      kind: 'assistant', id, time, agent: 'build', model, completed: completedAt !== undefined, parts: [{ kind: 'text', text: `Answer ${id}` }],
      ...(completedAt !== undefined ? { completedAt } : {}),
    })
    const durations = (view: HTMLElement): string[] =>
      Array.from(view.querySelectorAll('[data-testid="chat-turn-duration"]')).map((item) => item.textContent ?? '')

    it('says how long each finished turn took, under its answer and above the next question', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })], selectedInboxThreadId: 'ses_one' })
      page = {
        running: false, older: null,
        messages: [
          user('u1', 1_000), step('a1', 1_010, 6_000), step('a2', 6_020, 91_000),
          user('u2', 200_000), step('a3', 200_010, 203_400),
        ],
      }
      const view = await render()
      await vi.waitFor(() => expect(durations(view)).toHaveLength(2))
      expect(durations(view)).toEqual(['Worked for 1m 30s', 'Worked for 3s'])
      expect(view.querySelector('[data-testid="chat-turn-duration"]')?.getAttribute('title')).toBe('1 minute 30 seconds')
      expect(view.querySelector('[data-testid="chat-working"]')).toBeNull()

      const order = Array.from(view.querySelectorAll('[data-testid^="chat-message-"], [data-testid="chat-turn-duration"]'))
        .map((item) => item.getAttribute('data-testid') === 'chat-turn-duration' ? 'time' : item.getAttribute('data-testid'))
      expect(order).toEqual(['chat-message-u1', 'chat-message-a1', 'chat-message-a2', 'time', 'chat-message-u2', 'chat-message-a3', 'time'])
    })

    it('adds how fast the model generated when OpenCode\'s numbers give it, and leaves it out when they do not', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })], selectedInboxThreadId: 'ses_one' })
      const timed = (id: string, time: number, streamedAt: number, completedAt: number, output: number): ChatMessagesPage['messages'][number] => ({
        kind: 'assistant', id, time, agent: 'build', model, completed: true, completedAt, streamedAt,
        parts: [{ kind: 'text', text: `Answer ${id}` }], tokens: { input: 5, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      })
      page = {
        running: false, older: null,
        messages: [
          user('u1', 1_000), timed('a1', 1_010, 3_010, 8_000, 106), timed('a2', 8_020, 9_020, 9_100, 100),
          user('u2', 20_000), step('a3', 20_010, 21_000),
        ],
      }
      const view = await render()
      await vi.waitFor(() => expect(durations(view)).toHaveLength(2))
      // (106 + 100) tokens over 2 s + 1 s of generating; the 5 s the first step spent on tools do not count.
      expect(durations(view)).toEqual(['Worked for 8s·68.7 tok/s', 'Worked for 1s'])
      const rates = view.querySelectorAll('[data-testid="chat-turn-rate"]')
      expect(rates).toHaveLength(1)
      expect(rates[0]!.getAttribute('title')).toContain('tokens per second')
    })

    it('counts the turn in progress from when the thread began working, not from the service clock', async () => {
      // The service's clock is far off; the count must not follow it.
      useWorkspace.setState({
        inboxThreads: [thread({ status: 'working', workingSince: Date.now() - 90_000 })], selectedInboxThreadId: 'ses_one',
      })
      page = { running: true, older: null, messages: [user('u1', 5), step('a1', 6, 50), step('a2', 60)] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull())
      expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toMatch(/^Working for 1m (30|31|32)s$/)
      // Its only motion is the light along its rule: no spinner, which would clash with the ones on the rows above.
      const working = view.querySelector('[data-testid="chat-working"]')!
      expect(working.querySelector('.animate-spin')).toBeNull()
      expect(working.querySelector('.working-rule')).not.toBeNull()
      expect(working.querySelector('svg')).not.toBeNull()
      // The unfinished turn has no finished-turn line yet.
      expect(durations(view)).toEqual([])
      // The same count is not repeated in the header, which only names the state.
      expect(view.querySelector('[data-testid="inbox-thread-view"] [data-testid="inbox-status-chip"]')?.textContent).toBe('Working')
    })

    it('counts from the question when the thread has no clock of its own, and keeps the previous turn\'s time', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })], selectedInboxThreadId: 'ses_one' })
      const sent = Date.now() - 20_000
      page = { running: true, older: null, messages: [user('u1', 1_000), step('a1', 1_010, 5_000), user('u2', sent)] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull())
      expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toMatch(/^Working for (19|20|21|22)s$/)
      expect(durations(view)).toEqual(['Worked for 4s'])
    })

    it('starts at zero when nothing says when the work began, and turns into the finished line when it ends', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })], selectedInboxThreadId: 'ses_one' })
      page = { running: true, older: null, messages: [] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toBe('Working for 0s'))

      page = { running: false, older: null, messages: [user('u1', 1_000), step('a1', 1_010, 66_000)] }
      await act(async () => {
        useInboxChat.getState().applyEvent({ type: 'running', threadId: 'ses_one', running: false })
      })
      await vi.waitFor(() => expect(durations(view)).toEqual(['Worked for 1m 5s']))
      expect(view.querySelector('[data-testid="chat-working"]')).toBeNull()
    })
  })

  describe('context usage', () => {
    const windowed: ChatOptions = {
      ...options,
      models: [
        { id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free', contextLimit: 200_000, outputLimit: 64_000 },
        { id: 'small-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Small', contextLimit: 160_000 },
      ],
    }
    const step = (tokens: { input: number; output: number; cacheRead: number }, completed = true): ChatMessagesPage['messages'][number] => ({
      kind: 'assistant', id: `msg_${tokens.input}`, time: 2, agent: 'build', model: options.defaultModel!, completed, parts: [],
      ...(completed ? { tokens: { reasoning: 0, cacheWrite: 0, ...tokens } } : {}),
    })
    const meter = (view: HTMLElement): HTMLElement | null => view.querySelector('[data-testid="chat-context-meter"]')
    afterEach(() => { api.chat.options.mockImplementation(async () => options) })
    /** Radix opens its menus on a pointer press; the keyboard route is what happy-dom supports reliably. */
    const open = async (trigger: Element): Promise<void> => {
      await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    }

    it('waits for a finished step, then shows how full the window is', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: true, older: null, messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'Fix it' }, step({ input: 1, output: 1, cacheRead: 1 }, false)] }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Fix it'))
      expect(meter(view)).toBeNull()

      page = {
        running: false, older: null,
        usage: { cost: 0.42, tokens: { input: 5000, output: 900, reasoning: 100, cacheRead: 400_000, cacheWrite: 0 } },
        messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'Fix it' }, step({ input: 2000, output: 1000, cacheRead: 147_000 })],
      }
      await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 150K of 200K tokens used (75%)')
      expect(meter(view)?.getAttribute('data-tone')).toBe('warn')
      expect(meter(view)?.textContent).toBe('150K')

      await open(meter(view)!)
      const details = await vi.waitFor(() => {
        const found = document.querySelector('[data-testid="chat-context-details"]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(details.textContent).toContain('150K')
      expect(details.textContent).toContain('of 200K tokens')
      expect(details.textContent).toContain('75%')
      expect(details.textContent).toContain('Cache read147K')
      expect(details.textContent).toContain('New input2K')
      expect(details.textContent).toContain('Output1K')
      expect(details.textContent).not.toContain('Cache write')
      expect(details.textContent).toContain('Thread total406K')
      expect(details.textContent).toContain('Reported cost$0.42')
      expect(details.textContent).toContain('Flint Free · 200K window · 64K max reply')
    })

    it('measures against the model chosen in the composer', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: false, older: null, messages: [step({ input: 2000, output: 1000, cacheRead: 117_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K of 200K tokens used (60%)')
      expect(meter(view)?.getAttribute('data-tone')).toBe('normal')

      // The same conversation in a smaller window is fuller, before anything is sent.
      await open(view.querySelector('[data-testid="chat-model-picker"]')!)
      const small = await vi.waitFor(() => {
        const found = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === 'Small')
        expect(found).toBeDefined()
        return found!
      })
      await act(async () => small.click())
      await vi.waitFor(() => expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K of 160K tokens used (75%)'))
      expect(meter(view)?.getAttribute('data-tone')).toBe('warn')
    })

    it('shows only the count when the model reports no window', async () => {
      page = { running: false, older: null, messages: [step({ input: 2000, output: 1000, cacheRead: 117_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K tokens used')
      expect(meter(view)?.getAttribute('data-tone')).toBe('normal')
      await open(meter(view)!)
      await vi.waitFor(() => expect(document.querySelector('[data-testid="chat-context-details"]')?.textContent).toContain('window size unknown'))
    })

    it('turns red when the window is nearly full', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: false, older: null, messages: [step({ input: 1000, output: 1000, cacheRead: 183_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)?.getAttribute('data-tone')).toBe('danger'))
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 185K of 200K tokens used (93%)')
    })
  })

  it('answers permission requests and questions inline', async () => {
    requests = {
      permissions: [{ id: 'per_1', action: 'read', resources: ['.env'] }],
      forms: [{
        id: 'frm_1', title: 'Questions', unsupported: false,
        fields: [{ key: 'q0', type: 'string', title: 'Beverage', required: false, custom: true,
          description: 'Would you like tea or coffee?',
          options: [{ value: 'Tea', label: 'Tea', description: 'A nice cup of tea' }, { value: 'Coffee', label: 'Coffee', description: 'A cup of coffee' }] }],
      }],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).not.toBeNull())
    expect(view.textContent).toContain('Permission: Read a file')
    expect(view.textContent).toContain('.env')
    await act(async () => button(view, 'Allow once').click())
    expect(api.chat.replyPermission).toHaveBeenCalledWith({ threadId: 'ses_one', requestId: 'per_1', decision: 'once' })
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).toBeNull())

    const question = view.querySelector<HTMLElement>('[data-testid="chat-question-frm_1"]')!
    await act(async () => button(question, 'Send answer').click())
    expect(question.textContent).toContain('Answer “Beverage”.')
    expect(question.textContent).toContain('Would you like tea or coffee?')
    expect(question.querySelector('[data-testid="chat-option-Tea"]')?.textContent).toContain('A nice cup of tea')
    expect(question.querySelector('[data-testid="chat-option-Coffee"]')?.textContent).toContain('A cup of coffee')
    await act(async () => question.querySelector<HTMLButtonElement>('[data-testid="chat-option-Tea"]')!.click())
    await act(async () => button(question, 'Send answer').click())
    expect(api.chat.replyForm).toHaveBeenCalledWith({ threadId: 'ses_one', formId: 'frm_1', answer: { q0: 'Tea' } })
  })

  it('refetches when the service reports changes and unsubscribes on leave', async () => {
    const view = await render()
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(1))
    await act(async () => {
      useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' })
      useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' })
      useInboxChat.getState().applyEvent({ type: 'requests', threadId: 'ses_one' })
    })
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(api.chat.requests).toHaveBeenCalledTimes(2)
    expect(view.textContent).toContain('No messages yet.')
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    expect(api.chat.unsubscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
  })
})

describe('Inbox staged revert', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })
  const reply = (id: string, text: string): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [{ kind: 'text', text }],
  })
  const conversation = [user('msg_1', 'First request'), reply('msg_2', 'First answer'), user('msg_3', 'Second request'), reply('msg_4', 'Second answer')]
  // The stub takes no arguments in its type, but the store passes the request.
  const pageRequestsWithCursor = (): unknown[] =>
    (api.chat.messages.mock.calls as unknown as Array<[{ threadId: string; cursor?: string }?]>).filter(([request]) => request?.cursor)
  const refetch = async (): Promise<void> => {
    await act(async () => useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }))
  }

  it('hides the messages from the revert on, says what it restored, and shows them again once it is gone', async () => {
    page = {
      running: false,
      older: null,
      messages: conversation,
      revert: {
        messageId: 'msg_3',
        files: [
          { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
          { path: 'b.txt', status: 'deleted', additions: 0, deletions: 1 },
        ],
      },
    }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('First answer'))
    expect(view.textContent).not.toContain('Second request')
    expect(view.textContent).not.toContain('Second answer')
    expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted · 2 files restored')
    const files = view.querySelector('[data-testid="chat-revert-files"]')!.textContent!
    expect(files).toContain('Restoredsrc/a.ts+2−1')
    expect(files).toContain('Removedb.txt−1')
    expect(view.querySelector('[data-testid="chat-revert"]')?.textContent).toContain('Sending a message now removes the reverted messages for good.')

    // A reply that does not say whether a revert is staged leaves things as they are.
    page = { running: false, older: null, messages: conversation }
    await refetch()
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull()
    expect(view.textContent).not.toContain('Second request')

    // Redone: the messages were never dropped, so they are back with the next read.
    page = { running: false, older: null, messages: conversation, revert: null }
    await refetch()
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    expect(view.textContent).toContain('Second request')
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
  })

  it('shows the banner alone when the revert reaches the start, and names a partial reply honestly', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_1', files: [] } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.textContent).not.toContain('First request')
    expect(view.textContent).not.toContain('No messages yet.')
    expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('2 messages reverted')
    // No files, so there is nothing to fold open.
    expect(view.querySelector('[data-testid="chat-revert-files"]')).toBeNull()

    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_4', files: [] } }
    await refetch()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('The conversation reverted'))
    expect(view.textContent).toContain('Second request')
    expect(view.textContent).not.toContain('Second answer')
  })

  it('folds a long file list and counts the files it leaves out', async () => {
    const files = Array.from({ length: 24 }, (_, index) => ({ path: `src/f${index}.ts`, status: 'modified' as const, additions: 1, deletions: 0 }))
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.querySelector('[data-testid="chat-revert-files"]')).toBeNull()
    await act(async () => button(view, 'Show files').click())
    expect(view.querySelectorAll('[data-testid="chat-revert-files"] li')).toHaveLength(21)
    expect(view.querySelector('[data-testid="chat-revert-files"]')?.textContent).toContain('and 4 more')
  })

  it('redoes the revert from the note: the messages come back at once and the note goes', async () => {
    const reverted = { messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified' as const, additions: 2, deletions: 1 }] }
    page = { running: false, older: null, messages: conversation, revert: reverted }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.textContent).not.toContain('Second request')
    // After the redo OpenCode reports no revert, which the next refetch confirms.
    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => button(view, 'Redo').click())
    expect(api.chat.redo).toHaveBeenCalledTimes(1)
    expect(api.chat.redo).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
    expect(view.textContent).toContain('Second answer')
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
  })

  it('keeps the note and the hidden messages when a redo fails, and lets you try again', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    api.chat.redo.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:redo': Error: OpenCode is still working on this thread. Stop it, then redo."))
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    await act(async () => button(view, 'Redo').click())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"] [role="alert"]')?.textContent)
      .toBe('OpenCode is still working on this thread. Stop it, then redo.'))
    expect(view.textContent).not.toContain('Second request')
    expect(button(view, 'Redo').disabled).toBe(false)

    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => button(view, 'Redo').click())
    expect(api.chat.redo).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
  })

  it('shows that it is redoing and ignores a second click meanwhile', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    let finish!: () => void
    api.chat.redo.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    await act(async () => button(view, 'Redo').click())
    const pending = button(view, 'Redoing…')
    expect(pending.disabled).toBe(true)
    await act(async () => pending.click())
    expect(api.chat.redo).toHaveBeenCalledTimes(1)
    expect(view.textContent).not.toContain('Second request')
    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => finish())
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
  })

  it('loads earlier pages until a message before the revert is in view, once per page', async () => {
    const newest: ChatMessagesPage = {
      running: false,
      older: 'cursor-1',
      messages: [user('msg_5', 'Third request'), reply('msg_6', 'Third answer')],
      revert: { messageId: 'msg_5', files: [] },
    }
    const earlier: ChatMessagesPage = { running: false, older: null, messages: conversation }
    api.chat.messages.mockImplementation(async (request?: { cursor?: string }) => (request?.cursor ? earlier : newest))
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
      expect(view.textContent).not.toContain('Third request')
      expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted')
      const older = pageRequestsWithCursor()
      expect(older).toEqual([[{ threadId: 'ses_one', cursor: 'cursor-1' }]])
    } finally {
      api.chat.messages.mockImplementation(async () => page)
    }
  })

  it('stops loading when an earlier page fails, instead of asking again and again', async () => {
    const newest: ChatMessagesPage = {
      running: false,
      older: 'cursor-1',
      messages: [user('msg_5', 'Third request')],
      revert: { messageId: 'msg_5', files: [] },
    }
    api.chat.messages.mockImplementation(async (request?: { cursor?: string }) => {
      if (request?.cursor) throw new Error('Earlier page unavailable')
      return newest
    })
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toContain('Earlier page unavailable'))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
      const older = pageRequestsWithCursor()
      expect(older).toHaveLength(1)
    } finally {
      api.chat.messages.mockImplementation(async () => page)
    }
  })

  describe('reverting to a message', () => {
    const open = async (view: HTMLElement, id: string): Promise<HTMLElement> => {
      await act(async () => (view.querySelector(`[data-testid="chat-revert-to-${id}"]`) as HTMLButtonElement).click())
      // The dialog is in a portal.
      return document.body.querySelector('[data-testid="chat-revert-dialog"]') as HTMLElement
    }
    const dialogButton = (dialog: HTMLElement, label: string): HTMLButtonElement => button(dialog, label)
    const withPicture = (id: string, text: string, size: number): ChatMessage => ({
      kind: 'user', id, time: 1, text, attachments: [{ id: 'att_1', name: 'shot.png', mime: 'image/png', size }],
    })
    const checkbox = (dialog: HTMLElement): HTMLInputElement => dialog.querySelector('input[type="checkbox"]') as HTMLInputElement
    const showConversation = async (): Promise<HTMLElement> => {
      page = { running: false, older: null, messages: conversation }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
      return view
    }

    it('offers the revert on the user\'s own messages only', async () => {
      const view = await showConversation()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_1"]')).not.toBeNull()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_3"]')?.getAttribute('aria-label')).toBe('Revert to before this message')
      expect(view.querySelector('[data-testid="chat-revert-to-msg_2"]')).toBeNull()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_4"]')).toBeNull()
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
    })

    it('asks first: shows the message, how much goes, and restoring files as the default', async () => {
      const view = await showConversation()
      const dialog = await open(view, 'msg_1')
      expect(dialog.textContent).toContain('Revert to before this message?')
      expect(dialog.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('First request')
      expect(dialog.textContent).toContain('These 2 messages and the agent\'s replies will be hidden')
      expect(checkbox(dialog).checked).toBe(true)
      expect(dialog.textContent).toContain('You can redo this until you send a message.')
      // Nothing is said about work in progress or attachments when there is none.
      expect(dialog.textContent).not.toContain('still working')
      expect(dialog.textContent).not.toContain('Attachments on this message')

      await act(async () => dialogButton(dialog, 'Cancel').click())
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(api.chat.revert).not.toHaveBeenCalled()
      const single = await open(view, 'msg_3')
      expect(single.textContent).toContain('This message and the agent\'s replies will be hidden')
      expect(single.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('Second request')
    })

    it('reverts, hides the messages, and puts the text in the box above what is there', async () => {
      const draft = draftStore('Something half written')
      api.chat.revert.mockResolvedValueOnce({ messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] })
      const view = await showConversation()
      const input = messageInput(view)
      await vi.waitFor(() => expect(input.state.doc.toString()).toBe('Something half written'))

      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      expect(api.chat.revert).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_3' })
      expect(api.chat.draft).toHaveBeenCalledWith({ key: 'thread:ses_one', action: 'prepend', text: 'Second request' })
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()

      expect(view.textContent).toContain('First answer')
      expect(view.textContent).not.toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted · 1 file restored')
      await vi.waitFor(() => expect(input.state.doc.toString()).toBe('Second request\n\nSomething half written'))
      expect(draft.saved()).toBe('Second request\n\nSomething half written')
      // Ready for changes: focused, with the caret at the end of the restored text.
      await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
      expect(input.state.selection.main.from).toBe('Second request'.length)
      expect(input.state.selection.main.to).toBe('Second request'.length)
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('leaves the files alone when the box is unticked', async () => {
      draftStore('')
      const view = await showConversation()
      const dialog = await open(view, 'msg_1')
      await act(async () => checkbox(dialog).click())
      expect(checkbox(dialog).checked).toBe(false)
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1', files: false })
      await vi.waitFor(() => expect(messageInput(view).state.doc.toString()).toBe('First request'))
      // The revert reached the start, so only the note is left of the conversation.
      expect(view.textContent).not.toContain('First answer')
    })

    it('keeps the dialog open with the reason when the revert fails, and does not touch the box', async () => {
      const draft = draftStore('Keep me')
      api.chat.revert.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:revert': Error: OpenCode is still stopping this thread. Try again in a moment."))
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent)
        .toBe('OpenCode is still stopping this thread. Try again in a moment.'))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBe(dialog)
      expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
      expect(draft.saved()).toBe('Keep me')
      expect(view.textContent).toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()

      // Asking again works, and the error is gone while it does.
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(2)
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(view.textContent).not.toContain('Second answer')
    })

    it('ignores a second click while the revert is under way', async () => {
      draftStore('')
      let finish!: (value: ChatRevert) => void
      api.chat.revert.mockImplementationOnce(() => new Promise<ChatRevert>((resolve) => { finish = resolve }))
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(dialogButton(dialog, 'Revert').disabled).toBe(true)
      expect(dialogButton(dialog, 'Cancel').disabled).toBe(true)
      expect(checkbox(dialog).disabled).toBe(true)
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      await act(async () => finish({ messageId: 'msg_3', files: [] }))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
    })

    it('says that a working agent is stopped first, and that attachments are not put back', async () => {
      page = {
        running: true,
        older: null,
        messages: [withPicture('msg_1', 'See picture', 2048), reply('msg_2', 'Looking')],
      }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Looking'))
      const dialog = await open(view, 'msg_1')
      expect(dialog.textContent).toContain('The agent is still working and will be stopped first.')
      expect(dialog.textContent).toContain('Attachments on this message are not put back.')
    })

    it('says so when the message could not be put back in the box, though the conversation is reverted', async () => {
      draftStore('')
      api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
        if (request.action === 'prepend') throw new Error("Error invoking remote method 'chat:draft': Error: The text is too long to add to this draft.")
        return { text: '', revision: 1, attachments: [] }
      }) as never)
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull()
      expect(view.textContent).not.toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-notice"]')?.textContent)
        .toBe('The conversation was reverted, but the message could not be put back in the box: The text is too long to add to this draft.')
      expect(messageInput(view).state.doc.toString()).toBe('')

      // Redoing clears the notice along with the note.
      await act(async () => button(view, 'Redo').click())
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('puts nothing in the box for a message without text', async () => {
      draftStore('')
      page = { running: false, older: null, messages: [withPicture('msg_1', '', 10), reply('msg_2', 'Seen')] }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Seen'))
      const dialog = await open(view, 'msg_1')
      expect(dialog.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('A message without text')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('closes the question when another thread is opened', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two', title: 'Other' })] })
      const view = await showConversation()
      await open(view, 'msg_3')
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).not.toBeNull()
      await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(api.chat.revert).not.toHaveBeenCalled()
    })
  })
})


describe('Inbox fork from a message', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })
  const reply = (id: string, text: string): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [{ kind: 'text', text }],
  })
  const conversation = [user('msg_1', 'First request'), reply('msg_2', 'First answer'), user('msg_3', 'Second request'), reply('msg_4', 'Second answer')]
  const showConversation = async (): Promise<HTMLElement> => {
    page = { running: false, older: null, messages: conversation }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    return view
  }
  const forkButton = (view: HTMLElement, id: string): HTMLButtonElement | null =>
    view.querySelector(`[data-testid="chat-fork-from-${id}"]`)

  it('offers the fork beside the revert on the user\'s own messages only', async () => {
    const view = await showConversation()
    for (const id of ['msg_1', 'msg_3']) {
      expect(forkButton(view, id)?.getAttribute('aria-label')).toBe('Fork from before this message')
      expect(forkButton(view, id)?.getAttribute('title')).toBe('Fork from here')
      const revert = view.querySelector(`[data-testid="chat-revert-to-${id}"]`)!
      expect(revert).not.toBeNull()
      expect(forkButton(view, id)!.parentElement).toBe(revert.parentElement)
    }
    expect(forkButton(view, 'msg_2')).toBeNull()
    expect(forkButton(view, 'msg_4')).toBeNull()
  })

  it('forks from before the message at once, opens the new thread and puts the message in its box', async () => {
    const draft = draftStore('')
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    // Nothing is deleted, so there is nothing to ask.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_3' })
    expect(api.chat.draft).toHaveBeenCalledWith({ key: 'thread:ses_fork', action: 'prepend', text: 'Second request' })
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id).sort()).toEqual(['ses_fork', 'ses_one'])
    await vi.waitFor(() => expect(api.chat.subscribe).toHaveBeenCalledWith({ threadId: 'ses_fork' }))

    const input = messageInput(view)
    await vi.waitFor(() => expect(input.state.doc.toString()).toBe('Second request'))
    expect(draft.saved('thread:ses_fork')).toBe('Second request')
    // Ready for changes: focused, with the caret after the restored text.
    await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
    expect(input.state.selection.main.from).toBe('Second request'.length)
    expect(input.state.selection.main.to).toBe('Second request'.length)
    // The box took the instruction, so a thread opened later is not told again.
    expect(useInboxChat.getState().draftReloads.ses_fork).toBeUndefined()
    expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
  })

  it('leaves the original thread as it was', async () => {
    draftStore('Half written follow-up')
    const view = await showConversation()
    await vi.waitFor(() => expect(messageInput(view).state.doc.toString()).toBe('Half written follow-up'))
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'thread:ses_one', action: 'prepend' }))
    expect(api.chat.revert).not.toHaveBeenCalled()
    expect(api.chat.interrupt).not.toHaveBeenCalled()
    // Back in the original, its messages are all there and its box still holds what was typed.
    await act(async () => useWorkspace.getState().selectInboxThread('ses_one'))
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    await vi.waitFor(() => expect(messageInput(view).state.doc.toString()).toBe('Half written follow-up'))
  })

  it('opens the fork without touching its box for a message that has no text', async () => {
    draftStore('')
    page = { running: false, older: null, messages: [{ kind: 'user', id: 'msg_1', time: 1, text: '', attachments: [{ id: 'att_1', name: 'shot.png', mime: 'image/png', size: 10 }] }, reply('msg_2', 'Seen')] }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Seen'))
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1' })
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('shows that it is forking and ignores a second click meanwhile', async () => {
    draftStore('')
    let finish!: (result: ChatForkResult) => void
    api.chat.fork.mockImplementationOnce(() => new Promise<ChatForkResult>((resolve) => { finish = resolve }))
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(view.querySelector('[data-testid="chat-fork-status"]')?.textContent).toContain('Forking thread…')
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    await act(async () => finish({ thread: forkedThread() }))
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
  })

  it('says why the fork failed, stays in the thread, and clears the message when tried again', async () => {
    draftStore('')
    api.chat.fork.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:fork': Error: That message is no longer in the conversation."))
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-fork-error"]')?.textContent).toBe('That message is no longer in the conversation.'))
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_one'])
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
    expect(view.textContent).toContain('Second answer')

    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(api.chat.fork).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('opens the fork and says so when the message could not be put in its box', async () => {
    draftStore('')
    api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
      if (request.action === 'prepend') throw new Error("Error invoking remote method 'chat:draft': Error: The text is too long to add to this draft.")
      return { text: '', revision: 1, attachments: [] }
    }) as never)
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-notice"]')?.textContent)
      .toBe('The thread was forked, but the message could not be put in its box: The text is too long to add to this draft.'))
    expect(messageInput(view).state.doc.toString()).toBe('')
  })

  it('forks from a message that a revert leaves visible, and offers nothing on the ones it hides', async () => {
    draftStore('')
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(forkButton(view, 'msg_3')).toBeNull()
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1' })
  })
})


describe('Inbox /fork command', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })
  const reply = (id: string, text: string): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [{ kind: 'text', text }],
  })
  const showConversation = async (): Promise<HTMLElement> => {
    page = { running: false, older: null, messages: [user('msg_1', 'First request'), reply('msg_2', 'First answer')] }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('First answer'))
    return view
  }
  const run = async (view: HTMLElement, value = '/fork'): Promise<void> => {
    const box = messageInput(view)
    await setMessageText(box, value)
    await pressMessageKey(box, 'Enter')
  }
  const boxAlert = (view: HTMLElement): string | undefined =>
    Array.from(view.querySelectorAll('[role="alert"]')).map((element) => element.textContent ?? '').find((value) => value.includes('/fork') || value.includes('fork'))

  it('forks the whole conversation and opens the new thread, without sending anything', async () => {
    const draft = draftStore('')
    const view = await showConversation()
    await run(view)
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    // No message ID: the whole conversation, as the sidebar's Fork thread does.
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(api.chat.send).not.toHaveBeenCalled()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id).sort()).toEqual(['ses_fork', 'ses_one'])
    // The command is not left behind in either box, and the new box is empty.
    expect(draft.saved()).toBe('')
    expect(draft.saved('thread:ses_fork')).toBe('')
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull())
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
  })

  it('leaves the caret in the new thread\'s box, so typing goes on there', async () => {
    draftStore('')
    const view = await showConversation()
    await run(view)
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    const input = messageInput(view)
    await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
    expect(input.state.doc.toString()).toBe('')
    // The box took the instruction, so a thread opened later is not told again.
    expect(useInboxChat.getState().draftReloads.ses_fork).toBeUndefined()
  })

  it('puts the text of the unfinished turn in the new box when the fork was cut before it', async () => {
    const draft = draftStore('')
    api.chat.fork.mockImplementationOnce(async () => ({ thread: forkedThread(), text: 'Still working on this' }))
    const view = await showConversation()
    await run(view)
    expect(api.chat.draft).toHaveBeenCalledWith({ key: 'thread:ses_fork', action: 'prepend', text: 'Still working on this' })
    expect(draft.saved('thread:ses_fork')).toBe('Still working on this')
    await vi.waitFor(() => expect(messageInput(view).state.doc.toString()).toBe('Still working on this'))
  })

  it('shows that it is forking, and a second /fork meanwhile makes no second fork and gets its text back', async () => {
    draftStore('')
    let finish!: (result: ChatForkResult) => void
    api.chat.fork.mockImplementationOnce(() => new Promise<ChatForkResult>((resolve) => { finish = resolve }))
    const view = await showConversation()
    await run(view)
    expect(view.querySelector('[data-testid="chat-fork-status"]')?.textContent).toContain('Forking thread…')
    await run(view)
    await vi.waitFor(() => expect(boxAlert(view)).toBe('A fork is still being made.'))
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    expect(messageInput(view).state.doc.toString()).toBe('/fork')
    await act(async () => finish({ thread: forkedThread() }))
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
  })

  it('says why it failed under the box, which gets the command back, and stays in the thread', async () => {
    const draft = draftStore('')
    api.chat.fork.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:fork': Error: This OpenCode service does not support forking. Update OpenCode and try again."))
    const view = await showConversation()
    await run(view)
    await vi.waitFor(() => expect(boxAlert(view)).toBe('This OpenCode service does not support forking. Update OpenCode and try again.'))
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
    // Told once, in the one place the command was given.
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
    expect(messageInput(view).state.doc.toString()).toBe('/fork')
    expect(draft.saved()).toBe('/fork')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_one'])

    // Enter again tries again, and the reason goes.
    await pressMessageKey(messageInput(view), 'Enter')
    expect(api.chat.fork).toHaveBeenCalledTimes(2)
    expect(boxAlert(view)).toBeUndefined()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('is listed with the other commands when a slash is typed, and a fork from a message still works beside it', async () => {
    draftStore('')
    const view = await showConversation()
    await setMessageText(messageInput(view), '/')
    expect(Array.from(view.querySelectorAll('[data-testid="slash-picker"] [role="option"]')).map((option) => option.getAttribute('data-testid')))
      .toEqual(['slash-option-btw', 'slash-option-fork', 'slash-option-compact', 'slash-option-goal'])
    await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-fork-from-msg_1"]')!.click())
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1' })
  })

  it('does not fork for /fork with text after it, which is not a fork request', async () => {
    draftStore('')
    const view = await showConversation()
    await run(view, '/fork and fix the login')
    await vi.waitFor(() => expect(boxAlert(view)).toBe('/fork takes nothing after it.'))
    expect(api.chat.fork).not.toHaveBeenCalled()
    expect(api.chat.send).not.toHaveBeenCalled()
    expect(messageInput(view).state.doc.toString()).toBe('/fork and fix the login')
  })
})


describe('Inbox compaction', () => {
  const windowed: ChatOptions = {
    ...options,
    models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free', contextLimit: 200_000, outputLimit: 64_000 }],
  }
  beforeEach(() => {
    api.chat.options.mockResolvedValue(windowed)
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    draftStore('')
  })
  afterEach(() => { api.chat.options.mockImplementation(async () => options) })

  const user: ChatMessage = { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' }
  const step = (input: number, id = `msg_s${input}`): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [],
    tokens: { input, output: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  })
  type Note = Extract<ChatMessage, { kind: 'note' }>
  const running: Note = { kind: 'note', id: 'msg_c1', time: 3, tone: 'info', text: 'Compacting the conversation…', compaction: { status: 'running', reason: 'manual' } }
  const done: Note = {
    kind: 'note', id: 'msg_c1', time: 3, tone: 'info', text: 'Conversation compacted', detail: '## Objective\n- Fix the login',
    compaction: { status: 'completed', reason: 'manual', summaryTokens: 724 },
  }
  const failed: Note = {
    kind: 'note', id: 'msg_c1', time: 3, tone: 'error', text: 'Could not compact the conversation: Nothing to compact yet',
    compaction: { status: 'failed', reason: 'manual' },
  }
  const meter = (view: HTMLElement): HTMLElement | null => view.querySelector('[data-testid="chat-context-meter"]')
  const action = (): HTMLElement | null => document.querySelector('[data-testid="chat-context-compact"]')
  const open = async (view: HTMLElement): Promise<HTMLElement> => {
    await act(async () => { meter(view)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    return vi.waitFor(() => {
      const found = action()
      expect(found).not.toBeNull()
      return found!
    })
  }
  const show = async (messages: ChatMessage[], extra: Partial<ChatMessagesPage> = {}): Promise<HTMLElement> => {
    page = { running: false, older: null, messages, ...extra }
    const view = await render()
    await vi.waitFor(() => expect(meter(view)).not.toBeNull())
    return view
  }
  const run = async (view: HTMLElement, value = '/compact'): Promise<void> => {
    const box = messageInput(view)
    await setMessageText(box, value)
    await pressMessageKey(box, 'Enter')
  }
  const disabled = (element: HTMLElement): boolean => element.hasAttribute('data-disabled')
  /** What is said under the box, as opposed to in the conversation above it. */
  const boxAlert = (view: HTMLElement): string | undefined =>
    Array.from(view.querySelectorAll('[role="alert"]')).find((alert) => !alert.closest('[data-testid="chat-transcript"]'))?.textContent ?? undefined

  describe('from the context menu', () => {
    it('offers Compact conversation under the breakdown, and asks for it without touching the conversation', async () => {
      const view = await show([user, step(9000)])
      const item = await open(view)
      expect(item.textContent).toContain('Compact conversation')
      expect(item.textContent).toContain('Summarize it to free up context.')
      expect(disabled(item)).toBe(false)
      // Under the breakdown, in the same menu.
      expect(document.querySelector('[data-testid="chat-context-details"]')!.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      await act(async () => item.click())
      expect(api.chat.compact).toHaveBeenCalledTimes(1)
      expect(api.chat.compact).toHaveBeenCalledWith({ threadId: 'ses_one' })
      expect(api.chat.send).not.toHaveBeenCalled()
      expect(api.chat.fork).not.toHaveBeenCalled()
      // The menu closes, and nothing is shown as an error.
      await vi.waitFor(() => expect(action()).toBeNull())
      expect(view.querySelector('[data-testid="chat-compact-error"]')).toBeNull()
    })

    it('says that it waits for the agent when the agent is working, and then shows that it is waiting', async () => {
      const view = await show([user, step(9000)], { running: true })
      const item = await open(view)
      expect(item.textContent).toContain('The agent is working. It compacts when the agent finishes.')
      await act(async () => item.click())
      expect(api.chat.compact).toHaveBeenCalledOnce()
      expect(view.querySelector('[data-testid="chat-compaction-held"]')).toBeNull()
      // The service now holds it, which the next read of the conversation says.
      page = { ...page, compactionHeld: true }
      await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-compaction-held"]')?.textContent).toContain('It starts when the agent finishes.'))
      const again = await open(view)
      expect(disabled(again)).toBe(true)
      expect(again.textContent).toContain('Compaction waiting')
    })

    it('shows that it is compacting, with the action switched off, while the work runs', async () => {
      const view = await show([user, step(9000), running], { running: true })
      const note = view.querySelector('[data-compaction="running"]')
      expect(note?.textContent).toBe('Compacting the conversation…')
      expect(note?.getAttribute('role')).toBe('status')
      const item = await open(view)
      expect(disabled(item)).toBe(true)
      expect(item.textContent).toContain('Compacting…')
      expect(item.textContent).toContain('Summarizing the conversation.')
      await act(async () => item.click())
      expect(api.chat.compact).not.toHaveBeenCalled()
    })

    it('ignores a note that says running when the thread is not working, as the service may have stopped', async () => {
      const view = await show([user, step(9000), running], { running: false })
      const item = await open(view)
      expect(disabled(item)).toBe(false)
      expect(item.textContent).toContain('Compact conversation')
    })

    it('says why under the conversation when the service would not take the request, and lets it be asked again', async () => {
      api.chat.compact.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:compact': Error: This OpenCode service cannot compact conversations. Update OpenCode and try again."))
      const view = await show([user, step(9000)])
      const first = await open(view)
      await act(async () => first.click())
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-compact-error"]')?.textContent)
        .toBe('This OpenCode service cannot compact conversations. Update OpenCode and try again.'))
      await vi.waitFor(() => expect(action()).toBeNull())
      const second = await open(view)
      await act(async () => second.click())
      expect(api.chat.compact).toHaveBeenCalledTimes(2)
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-compact-error"]')).toBeNull())
    })
  })

  describe('with /compact', () => {
    it('asks for it from the box, empties the box and sends nothing', async () => {
      const view = await show([user, step(9000)])
      await run(view)
      expect(api.chat.compact).toHaveBeenCalledOnce()
      expect(api.chat.compact).toHaveBeenCalledWith({ threadId: 'ses_one' })
      expect(api.chat.send).not.toHaveBeenCalled()
      expect(messageInput(view).state.doc.toString()).toBe('')
      expect(boxAlert(view)).toBeUndefined()
    })

    it('is found by /summarize too, and by a word of its description', async () => {
      const view = await show([user, step(9000)])
      await run(view, '/summarize')
      expect(api.chat.compact).toHaveBeenCalledOnce()
      await setMessageText(messageInput(view), '/summ')
      expect(Array.from(view.querySelectorAll('[data-testid="slash-picker"] [role="option"]')).map((option) => option.getAttribute('data-testid'))).toEqual(['slash-option-compact'])
    })

    it('gives the command back with the reason under the box when the service would not take it', async () => {
      api.chat.compact.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:compact': Error: Session not found: ses_one"))
      const view = await show([user, step(9000)])
      await run(view)
      await vi.waitFor(() => expect(boxAlert(view)).toBe('Session not found: ses_one'))
      expect(messageInput(view).state.doc.toString()).toBe('/compact')
      // Told once, where it was asked.
      expect(view.querySelector('[data-testid="chat-compact-error"]')).toBeNull()
    })

    it('refuses while a compaction runs or waits, rather than ask for a second one that would fail', async () => {
      const working = await show([user, step(9000), running], { running: true })
      await run(working)
      await vi.waitFor(() => expect(boxAlert(working)).toBe('The conversation is already being compacted.'))
      expect(messageInput(working).state.doc.toString()).toBe('/compact')
      expect(api.chat.compact).not.toHaveBeenCalled()
    })

    it('refuses while one waits for the agent', async () => {
      const view = await show([user, step(9000)], { running: true, compactionHeld: true })
      await run(view)
      await vi.waitFor(() => expect(boxAlert(view)).toBe('A compaction is already waiting for the agent to finish.'))
      expect(api.chat.compact).not.toHaveBeenCalled()
    })

    it('refuses with nothing finished to summarize, and with nothing new since the last compaction', async () => {
      page = { running: false, older: null, messages: [user] }
      const fresh = await render()
      await vi.waitFor(() => expect(fresh.textContent).toContain('Fix the login'))
      expect(meter(fresh)).toBeNull()
      await run(fresh)
      await vi.waitFor(() => expect(boxAlert(fresh)).toBe('There is nothing to compact yet.'))
      expect(api.chat.compact).not.toHaveBeenCalled()
    })

    it('refuses straight after a compaction, when there is nothing new to summarize', async () => {
      const view = await show([user, step(9000), done])
      await run(view)
      await vi.waitFor(() => expect(boxAlert(view)).toBe('The conversation was just compacted. It has nothing new to compact yet.'))
      expect(api.chat.compact).not.toHaveBeenCalled()
    })

    it('does not ask twice when it is pressed again before the first request is answered', async () => {
      let answer!: () => void
      api.chat.compact.mockImplementationOnce(() => new Promise<void>((resolve) => { answer = resolve }))
      const view = await show([user, step(9000)])
      await run(view)
      await run(view)
      await vi.waitFor(() => expect(boxAlert(view)).toBe('A compaction is already being asked for.'))
      expect(api.chat.compact).toHaveBeenCalledOnce()
      await act(async () => answer())
    })
  })

  describe('in the conversation', () => {
    it('says compacted, instead of a stale count, until the next reply tells the new size', async () => {
      const view = await show([user, step(149_500), done])
      expect(meter(view)?.textContent).toBe('Compacted')
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: compacted. Its new size shows after the next reply')
      expect(meter(view)?.getAttribute('data-tone')).toBe('normal')
      const item = await open(view)
      const details = document.querySelector('[data-testid="chat-context-details"]')!
      expect(details.querySelector('[data-testid="chat-context-compacted"]')?.textContent).toBe('Compacted')
      expect(details.textContent).toContain('The new size shows after the next reply.')
      expect(details.textContent).toContain('Before compacting150K')
      expect(details.textContent).toContain('Summaryabout 724')
      // The breakdown of the old step is not shown as if it still held.
      expect(details.querySelector('[data-testid="chat-context-composition"]')).toBeNull()
      expect(details.textContent).not.toContain('Cache read')
      expect(disabled(item)).toBe(true)
      expect(item.textContent).toContain('Just compacted. Nothing new to compact yet.')
    })

    it('measures again from the first reply after the compaction, and offers compacting again', async () => {
      const view = await show([user, step(149_500), done, { kind: 'user', id: 'msg_2', time: 4, text: 'Go on' }, step(12_000)])
      expect(meter(view)?.textContent).toBe('12.5K')
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 12.5K of 200K tokens used (6%)')
      const item = await open(view)
      expect(disabled(item)).toBe(false)
      expect(document.querySelector('[data-testid="chat-context-details"]')?.textContent).not.toContain('Compacted')
    })

    it('does not change the count for a compaction that failed or is still running', async () => {
      const failing = await show([user, step(9000), failed])
      expect(meter(failing)?.textContent).toBe('9.5K')
      expect(failing.querySelector('[data-testid="chat-message-msg_c1"]')?.textContent).toContain('Could not compact the conversation: Nothing to compact yet')
      const item = await open(failing)
      expect(disabled(item)).toBe(false)
    })

    it('shows the summary as Markdown when the note is opened', async () => {
      const view = await show([user, step(9000), done])
      const note = view.querySelector('[data-compaction="completed"]')!
      expect(note.textContent).toContain('Conversation compacted')
      expect(note.textContent).toContain('summary of about 724 tokens')
      expect(view.querySelector('[data-testid="chat-compaction-summary"]')).toBeNull()
      await act(async () => note.querySelector<HTMLButtonElement>('button')!.click())
      const summary = await vi.waitFor(() => {
        const found = view.querySelector('[data-testid="chat-compaction-summary"]')
        expect(found).not.toBeNull()
        return found!
      })
      await vi.waitFor(() => expect(summary.querySelector('h2')?.textContent).toBe('Objective'))
      expect(summary.querySelector('li')?.textContent).toBe('Fix the login')
    })
  })
})


describe('Inbox draft reload', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    useInboxChat.setState({ draftReloads: {} })
  })

  it('takes a reload that was set before the box appeared, then lets go of it', async () => {
    draftStore('Added text and the rest')
    useInboxChat.setState({ draftReloads: { ses_one: { id: 4, caret: 10 } } })
    const view = await render()
    const input = messageInput(view)
    await vi.waitFor(() => expect(input.state.doc.toString()).toBe('Added text and the rest'))
    await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
    expect(input.state.selection.main.from).toBe(10)
    expect(useInboxChat.getState().draftReloads.ses_one).toBeUndefined()
  })

  it('waits for the box to switch on before taking focus, however slowly the draft loads', async () => {
    draftStore('Existing text')
    // The first read, which the box needs before it can be used, is the slow one.
    const answer = api.chat.draft.getMockImplementation()! as unknown as (request: ChatDraftRequest) => Promise<ChatDraft>
    let loads = 0
    api.chat.draft.mockImplementation((async (request: ChatDraftRequest) => {
      if (request.action === 'load' && loads++ === 0) await new Promise((resolve) => setTimeout(resolve, 120))
      return answer(request)
    }) as never)
    useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret: 4 } } })
    const view = await render()
    const input = messageInput(view)
    // Until then the box is switched off, and a box that is off cannot take focus.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(input.state.readOnly).toBe(true)
    expect(document.activeElement).not.toBe(input.contentDOM)
    await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
    expect(input.state.readOnly).toBe(false)
    expect(input.state.doc.toString()).toBe('Existing text')
    expect(input.state.selection.main.from).toBe(4)
  })

  it('takes the next reload as well, even when it has the number the last one had', async () => {
    draftStore('Hello world')
    const view = await render()
    const input = messageInput(view)
    await vi.waitFor(() => expect(input.state.doc.toString()).toBe('Hello world'))
    for (const caret of [5, 2]) {
      input.contentDOM.blur()
      expect(document.activeElement).not.toBe(input.contentDOM)
      await act(async () => useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret } } }))
      await vi.waitFor(() => expect(document.activeElement).toBe(input.contentDOM))
      expect(input.state.selection.main.from).toBe(caret)
      expect(useInboxChat.getState().draftReloads.ses_one).toBeUndefined()
    }
  })

  it('does not let go of a newer reload than the one that was taken', () => {
    useInboxChat.setState({ draftReloads: { ses_one: { id: 2, caret: 4 }, ses_two: { id: 1, caret: 0 } } })
    useInboxChat.getState().clearDraftReload('ses_one', 1)
    expect(useInboxChat.getState().draftReloads.ses_one).toEqual({ id: 2, caret: 4 })
    useInboxChat.getState().clearDraftReload('ses_one', 2)
    expect(useInboxChat.getState().draftReloads).toEqual({ ses_two: { id: 1, caret: 0 } })
    useInboxChat.getState().clearDraftReload('ses_three', 1)
    expect(useInboxChat.getState().draftReloads).toEqual({ ses_two: { id: 1, caret: 0 } })
  })
})
