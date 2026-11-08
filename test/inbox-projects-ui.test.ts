// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { InboxProjectsDialog } from '../src/renderer/components/inbox/InboxProjectsDialog'
import { ProjectIcon } from '../src/renderer/components/inbox/ProjectIcon'
import { getInboxTitleIcons, INBOX_TITLE_ICONS_STORAGE_KEY, saveInboxTitleIcons } from '../src/renderer/lib/inbox-settings'
import { INBOX_FOLDER_SYMBOLS } from '../src/shared/inbox-folder-icons'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type {
  ChatDraftSummary,
  InboxAddFolderRequest,
  InboxFolder,
  InboxFolderIcon,
  InboxFolderSymbol,
  InboxThread,
  InboxUpdateFolderRequest,
} from '../src/shared/types'

function folder(id: string, name: string, overrides: Partial<InboxFolder> = {}): InboxFolder {
  return { id, name, directory: `/home/me/${name}`, target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1, ...overrides }
}

function thread(id: string, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id, title: `Thread ${id}`, directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: 1, lastActivityAt: Date.now() - 60_000, readAt: Date.now(), archived: false, status: 'completed',
    ...overrides,
  }
}

const worktree = { repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-abc/ab12cd34', branch: 'mde/ab12cd34', base: 'main' }
const app = folder('fld_app', 'app')
const docs = folder('fld_docs', 'docs', { icon: { kind: 'symbol', id: 'book', color: 'teal' } })
const tree = folder('fld_tree', 'app · mde/ab12cd34', { directory: worktree.root, worktree })

describe('ProjectIcon', () => {
  const markup = (icon?: InboxFolderIcon, size?: 'sm' | 'md' | 'lg'): string =>
    renderToStaticMarkup(createElement(ProjectIcon, { icon, size }))

  it('draws a different picture for every built-in icon, and the plain folder when there is none', () => {
    // Without its own marker, so only what is drawn is compared: a wrong id-to-drawing mapping shows up as a repeat.
    const drawn = (id: InboxFolderSymbol): string => markup({ kind: 'symbol', id }).replace(/ data-icon="[^"]*"/, '')
    expect(new Set(INBOX_FOLDER_SYMBOLS.map((option) => drawn(option.id))).size).toBe(INBOX_FOLDER_SYMBOLS.length)
    expect(markup(undefined).replace(/ data-icon="[^"]*"/, '')).toBe(drawn('folder'))
    expect(markup(undefined)).not.toBe(markup({ kind: 'symbol', id: 'rocket' }))
  })

  it('tints a built-in icon with its colour only, and sizes the box', () => {
    expect(markup({ kind: 'symbol', id: 'bug' })).not.toContain('style=')
    expect(markup({ kind: 'symbol', id: 'bug', color: 'red' })).toContain('style="color:#ef4444"')
    expect(markup({ kind: 'symbol', id: 'bug' }, 'sm')).toContain('h-3 w-3')
    expect(markup({ kind: 'symbol', id: 'bug' }, 'lg')).toContain('h-5 w-5')
  })

  it('shows an emoji as text that assistive technology skips, and never as markup', () => {
    const html = markup({ kind: 'emoji', emoji: '🚀' })
    expect(html).toContain('>🚀</span>')
    expect(html).toContain('aria-hidden="true"')
    expect(markup({ kind: 'emoji', emoji: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('Inbox project manager', () => {
  let root: Root
  let container: HTMLDivElement
  const addFolder = vi.fn()
  const updateFolder = vi.fn()
  const removeFolder = vi.fn()

  const q = (testId: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const all = (testId: string): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const click = async (element: Element | null): Promise<void> => {
    if (!element) throw new Error('Nothing to click')
    await act(async () => (element as HTMLElement).click())
  }
  const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const button = (label: string): HTMLButtonElement => {
    const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
    )
    if (!found) throw new Error(`No button ${label}`)
    return found
  }
  const names = (): string[] => all('inbox-project-name').map((item) => item.textContent ?? '')
  const row = (name: string): HTMLElement => {
    const found = all('inbox-project-row').find((item) => item.querySelector('[data-testid="inbox-project-name"]')?.textContent === name)
    if (!found) throw new Error(`No project ${name}`)
    return found
  }
  const rowIcon = (name: string): string | null | undefined => row(name).querySelector('[data-testid="project-icon"]')?.getAttribute('data-icon')
  const preview = (): HTMLElement => q('project-icon-picker')!.querySelector<HTMLElement>('[data-testid="project-icon"]')!
  const nameField = (): HTMLInputElement => document.body.querySelector<HTMLInputElement>('#inbox-project-name')!
  const open = async (): Promise<void> => {
    await act(async () => root.render(createElement(InboxProjectsDialog, { open: true, onOpenChange })))
  }
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('api', { inbox: { addFolder, updateFolder, removeFolder }, paths: { browse: vi.fn(async () => null), resolve: vi.fn() } })
    addFolder.mockReset().mockImplementation(async (request: InboxAddFolderRequest) => ({
      ...folder('fld_new', request.name ?? 'new', { directory: request.path }),
      ...(request.icon ? { icon: request.icon } : {}),
    }))
    updateFolder.mockReset().mockImplementation(async (request: InboxUpdateFolderRequest) => {
      const current = useInboxChat.getState().folders.find((item) => item.id === request.id)!
      const { icon: _icon, ...rest } = current
      return { ...rest, ...(request.name ? { name: request.name } : {}), ...(request.icon ? { icon: request.icon } : request.icon === undefined && current.icon ? { icon: current.icon } : {}) }
    })
    removeFolder.mockReset().mockResolvedValue(undefined)
    onOpenChange.mockReset()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [
        thread('ses_a'),
        thread('ses_b'),
        thread('ses_c', { folderId: 'fld_docs', directory: '/home/me/docs' }),
        // In a worktree of app: it belongs to app, not to the worktree's entry.
        thread('ses_d', { folderId: 'fld_tree', directory: worktree.root, worktree }),
      ],
      selectedInboxThreadId: null,
      activeWorkspaceView: 'inbox',
    })
    useInboxChat.setState({ folders: [docs, tree, app], composer: { folderId: 'fld_app' }, foldersLoaded: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('lists the projects by name with where they are and how many threads each has, and leaves out worktrees', async () => {
    await open()
    expect(names()).toEqual(['app', 'docs'])
    expect(row('app').textContent).toContain('/home/me/app · 3 threads')
    expect(row('docs').textContent).toContain('/home/me/docs · 1 thread')
    expect(document.body.textContent).not.toContain('ab12cd34 ·')
    expect(document.body.textContent).toContain('Worktrees that MDE made for threads are not listed here.')
    // The icon each project has; the plain folder for one without.
    expect(rowIcon('app')).toBe('folder')
    expect(rowIcon('docs')).toBe('book')
    expect(row('docs').querySelector<HTMLElement>('[data-testid="project-icon"]')!.style.color).not.toBe('')
  })

  it('says so when there are no projects, and offers to add one', async () => {
    useInboxChat.setState({ folders: [] })
    await open()
    expect(q('inbox-projects-empty')?.textContent).toContain('No projects yet')
    expect(q('inbox-project-add')).not.toBeNull()
    expect(document.body.textContent).not.toContain('are not listed here')
  })

  it('names the WSL distro of a project that lives in one', async () => {
    useInboxChat.setState({ folders: [folder('fld_wsl', 'api', { directory: '/home/me/api', target: { kind: 'wsl', distro: 'Ubuntu-24.04' } })] })
    await open()
    expect(row('api').textContent).toContain('/home/me/api · Ubuntu-24.04')
  })

  describe('editing', () => {
    it('shows the name, the folder it cannot change and the icon it has, and saves a new name and icon', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      expect(q('inbox-project-edit')).not.toBeNull()
      expect(nameField().value).toBe('docs')
      const folderField = document.body.querySelector<HTMLInputElement>('#inbox-project-folder')!
      expect(folderField.value).toBe('/home/me/docs')
      expect(folderField.readOnly).toBe(true)
      expect(q('project-symbol-book')?.getAttribute('aria-pressed')).toBe('true')
      expect(q('project-color-teal')?.getAttribute('aria-pressed')).toBe('true')

      await type(nameField(), '  Documentation ')
      await click(q('project-symbol-rocket'))
      // The tint it had goes with it to the next icon, and can be changed with the icon chosen.
      expect(preview().getAttribute('data-icon')).toBe('rocket')
      await click(q('project-color-blue'))
      await click(button('Save'))

      expect(updateFolder).toHaveBeenCalledTimes(1)
      expect(updateFolder).toHaveBeenCalledWith({ id: 'fld_docs', name: 'Documentation', icon: { kind: 'symbol', id: 'rocket', color: 'blue' } })
      // Back at the list, with the change in place and the order by name kept.
      expect(q('inbox-project-edit')).toBeNull()
      expect(names()).toEqual(['app', 'Documentation'])
      expect(rowIcon('Documentation')).toBe('rocket')
      expect(useInboxChat.getState().folders.map((item) => item.id)).toEqual(['fld_docs', 'fld_tree', 'fld_app'])
    })

    it('gives a project an emoji, and a single emoji only', async () => {
      await open()
      await click(row('app').querySelector('[data-testid="inbox-project-edit-button"]'))
      await click(q('project-icon-tab-emoji'))
      const input = q('project-emoji-input') as HTMLInputElement
      await type(input, 'rocket')
      expect(document.body.textContent).toContain('Use a single emoji.')
      expect(preview().getAttribute('data-icon')).toBe('folder')
      await type(input, '🚀🚀')
      expect(document.body.textContent).toContain('Use a single emoji.')
      await type(input, '🛠️')
      expect(document.body.textContent).not.toContain('Use a single emoji.')
      expect(preview().getAttribute('data-icon')).toBe('emoji')
      expect(preview().textContent).toBe('🛠️')
      await click(button('Save'))
      expect(updateFolder).toHaveBeenCalledWith({ id: 'fld_app', name: 'app', icon: { kind: 'emoji', emoji: '🛠️' } })
      expect(row('app').querySelector('[data-testid="project-icon"]')?.textContent).toBe('🛠️')
    })

    it('picks an emoji from the suggestions', async () => {
      await open()
      await click(row('app').querySelector('[data-testid="inbox-project-edit-button"]'))
      await click(q('project-icon-tab-emoji'))
      await click(button('Emoji 🚀'))
      await click(button('Save'))
      expect(updateFolder).toHaveBeenCalledWith({ id: 'fld_app', name: 'app', icon: { kind: 'emoji', emoji: '🚀' } })
    })

    it('takes the icon away with the folder icon button, and a tint away with No color', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      await click(q('project-color-none'))
      await click(button('Save'))
      expect(updateFolder).toHaveBeenLastCalledWith({ id: 'fld_docs', name: 'docs', icon: { kind: 'symbol', id: 'book' } })

      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      expect(q('project-icon-reset')?.hasAttribute('disabled')).toBe(false)
      await click(q('project-icon-reset'))
      expect(preview().getAttribute('data-icon')).toBe('folder')
      expect(q('project-icon-reset')?.hasAttribute('disabled')).toBe(true)
      await click(button('Save'))
      expect(updateFolder).toHaveBeenLastCalledWith({ id: 'fld_docs', name: 'docs', icon: null })
      expect(rowIcon('docs')).toBe('folder')
    })

    it('cannot be saved without a name, and Cancel and Back save nothing', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      await type(nameField(), '   ')
      expect(button('Save').disabled).toBe(true)
      await type(nameField(), 'Changed')
      await click(button('Cancel'))
      expect(q('inbox-project-edit')).toBeNull()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      expect(nameField().value).toBe('docs')
      await click(q('inbox-projects-back'))
      expect(q('inbox-project-edit')).toBeNull()
      expect(updateFolder).not.toHaveBeenCalled()
      expect(names()).toEqual(['app', 'docs'])
    })

    it('shows what went wrong and stays in the form so it can be tried again', async () => {
      updateFolder.mockRejectedValueOnce(new Error("Error invoking remote method 'inbox:folders-update': Error: That project is no longer in the Inbox."))
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      await type(nameField(), 'Renamed')
      await click(button('Save'))
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('That project is no longer in the Inbox.')
      expect(q('inbox-project-edit')).not.toBeNull()
      expect(nameField().value).toBe('Renamed')
      await click(button('Save'))
      expect(q('inbox-project-edit')).toBeNull()
      expect(names()).toContain('Renamed')
    })

    it('goes back to the list when the project it was editing is removed from under it', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
      await act(async () => useInboxChat.setState({ folders: [app] }))
      expect(q('inbox-project-edit')).toBeNull()
      expect(names()).toEqual(['app'])
    })
  })

  describe('adding', () => {
    const addForm = async (): Promise<void> => {
      await open()
      await click(q('inbox-project-add'))
    }

    it('adds a folder with the name and icon chosen for it, and shows it in the list', async () => {
      await addForm()
      expect(document.body.textContent).toContain('Add a project')
      await type(document.body.querySelector<HTMLInputElement>('#inbox-folder-path')!, '/home/me/web')
      // The folder's own name is what the name field offers until another is typed.
      expect(document.body.querySelector<HTMLInputElement>('#inbox-folder-name')!.placeholder).toBe('web')
      await type(document.body.querySelector<HTMLInputElement>('#inbox-folder-name')!, 'Website')
      await click(q('project-symbol-web'))
      await click(q('project-color-green'))
      await click(button('Add project'))

      expect(addFolder).toHaveBeenCalledWith({
        kind: 'native', path: '/home/me/web', name: 'Website', icon: { kind: 'symbol', id: 'web', color: 'green' },
      })
      // Back at the list, which now has it.
      expect(q('inbox-project-list')).not.toBeNull()
      expect(names()).toContain('Website')
      expect(rowIcon('Website')).toBe('web')
    })

    it('sends no name or icon when none was chosen, so the folder keeps its own name', async () => {
      await addForm()
      await type(document.body.querySelector<HTMLInputElement>('#inbox-folder-path')!, '/home/me/plain')
      await click(button('Add project'))
      expect(addFolder).toHaveBeenCalledWith({ kind: 'native', path: '/home/me/plain' })
    })

    it('stays in the form with the reason when the folder cannot be added', async () => {
      addFolder.mockRejectedValueOnce(new Error('That folder does not exist.'))
      await addForm()
      await type(document.body.querySelector<HTMLInputElement>('#inbox-folder-path')!, '/home/me/nowhere')
      await click(button('Add project'))
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('That folder does not exist.')
      expect((document.body.querySelector('#inbox-folder-path') as HTMLInputElement).value).toBe('/home/me/nowhere')
      expect(q('inbox-project-list')).toBeNull()
    })

    it('goes back to the list without adding when it is cancelled', async () => {
      await addForm()
      await click(button('Cancel'))
      expect(q('inbox-project-list')).not.toBeNull()
      expect(addFolder).not.toHaveBeenCalled()
    })
  })

  describe('removing', () => {
    it('asks first, says what stays, and removes the project once confirmed', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-remove-button"]'))
      const confirm = document.body.querySelector('[role="alertdialog"]')!
      expect(confirm.textContent).toContain('Remove “docs” from the Inbox?')
      expect(confirm.textContent).toContain('Its threads stay in the Inbox')
      expect(removeFolder).not.toHaveBeenCalled()
      await click(q('inbox-project-remove-confirm'))
      await settle()
      expect(removeFolder).toHaveBeenCalledWith({ id: 'fld_docs' })
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
      expect(names()).toEqual(['app'])
    })

    it('keeps the project when it is cancelled', async () => {
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-remove-button"]'))
      await click(button('Cancel'))
      await settle()
      expect(removeFolder).not.toHaveBeenCalled()
      expect(names()).toEqual(['app', 'docs'])
    })

    it('shows the reason and keeps asking when the removal fails', async () => {
      removeFolder.mockRejectedValueOnce(new Error('Disk is read-only.'))
      await open()
      await click(row('docs').querySelector('[data-testid="inbox-project-remove-button"]'))
      await click(q('inbox-project-remove-confirm'))
      await settle()
      expect(document.body.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe('Disk is read-only.')
      expect(names()).toEqual(['app', 'docs'])
    })
  })

  it('starts at the list again each time it is opened', async () => {
    await open()
    await click(row('docs').querySelector('[data-testid="inbox-project-edit-button"]'))
    expect(q('inbox-project-edit')).not.toBeNull()
    await act(async () => root.render(createElement(InboxProjectsDialog, { open: false, onOpenChange })))
    await open()
    expect(q('inbox-project-edit')).toBeNull()
    expect(names()).toEqual(['app', 'docs'])
  })
})

describe('Inbox sidebar with projects', () => {
  let root: Root
  let container: HTMLDivElement
  const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const render = async (): Promise<void> => { await act(async () => root.render(createElement(InboxPanel))) }

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', {
      inbox: { changes: vi.fn(), setRead: vi.fn(async () => null), setArchived: vi.fn(async () => null), remove: vi.fn(), folders: vi.fn(), setComposer: vi.fn(async (value: unknown) => value) },
      chat: { drafts: vi.fn(async () => ({ drafts: [], threads: [] })), draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })) },
    })
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [
        thread('ses_a'),
        thread('ses_c', { folderId: 'fld_docs', directory: '/home/me/docs' }),
        thread('ses_d', { folderId: 'fld_tree', directory: worktree.root, worktree }),
        thread('ses_gone', { folderId: 'fld_removed', directory: '/home/me/removed' }),
      ],
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ workingSection: false, workingCollapsed: false, draftsCollapsed: false })
    useInboxDrafts.setState({ drafts: [], page: { id: 'drf_page', opened: false } })
    useInboxChat.setState({
      folders: [folder('fld_app', 'app', { icon: { kind: 'emoji', emoji: '🚀' } }), docs, tree],
      composer: { folderId: 'fld_app' },
      foldersLoaded: true,
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  const project = (id: string): { icon: Element | null; label: string | undefined } => ({
    icon: q(`inbox-thread-${id}`)?.querySelector('[data-testid="project-icon"]') ?? null,
    label: q(`inbox-thread-project-${id}`)?.textContent ?? undefined,
  })

  it('shows each thread’s project with its icon, in place of the plain folder', async () => {
    await render()
    expect(project('ses_a').label).toBe('app')
    expect(project('ses_a').icon?.getAttribute('data-icon')).toBe('emoji')
    expect(project('ses_a').icon?.textContent).toBe('🚀')
    expect(project('ses_c').label).toBe('docs')
    expect(project('ses_c').icon?.getAttribute('data-icon')).toBe('book')
  })

  it('shows the project’s name rather than the folder’s, so a rename is seen', async () => {
    useInboxChat.setState({ folders: [folder('fld_app', 'Main application'), docs, tree] })
    await render()
    expect(project('ses_a').label).toBe('Main application')
  })

  it('gives a thread in a worktree the name and icon of the project the worktree was cut from', async () => {
    await render()
    expect(project('ses_d').label).toBe('app')
    expect(project('ses_d').icon?.getAttribute('data-icon')).toBe('emoji')
  })

  it('falls back to the folder’s own name and the plain folder once the project was removed', async () => {
    await render()
    expect(project('ses_gone').label).toBe('removed')
    expect(project('ses_gone').icon?.getAttribute('data-icon')).toBe('folder')
    await act(async () => useInboxChat.setState({ folders: [docs, tree] }))
    expect(project('ses_a').label).toBe('app')
    expect(project('ses_a').icon?.getAttribute('data-icon')).toBe('folder')
    // The worktree thread loses its project with it.
    expect(project('ses_d').icon?.getAttribute('data-icon')).toBe('folder')
  })

  it('opens the project manager from the button beside the Inbox settings', async () => {
    await render()
    expect(document.body.querySelector('[data-testid="inbox-projects"]')).toBeNull()
    const button = q('inbox-projects-button')!
    expect(button.getAttribute('aria-label')).toBe('Projects')
    // It sits next to the settings gear, after the filters.
    expect(button.nextElementSibling).toBe(q('inbox-settings'))
    await act(async () => button.click())
    expect(document.body.querySelector('[data-testid="inbox-projects"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-testid="inbox-project-row"]')).toHaveLength(2)
  })
})

describe('Inbox project icons in front of the titles', () => {
  let root: Root
  let container: HTMLDivElement
  let storedDrafts: ChatDraftSummary[]
  const scratch = folder('fld_scratch', 'scratch')
  const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const render = async (): Promise<void> => {
    await act(async () => root.render(createElement(InboxPanel)))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
  const titleIcon = (id: string): HTMLElement | null => q(`inbox-thread-title-icon-${id}`)
  /** The icon on the line with the project's name, which is where it is until the setting moves it. */
  const nameLineIcon = (id: string): Element | null => q(`inbox-thread-${id}`)?.querySelector('[data-testid="project-icon"]') ?? null
  const gear = (): HTMLElement => q('inbox-settings')!
  const menuItem = (): HTMLElement | null => document.body.querySelector('[data-testid="inbox-setting-title-icons"]')
  const openMenu = async (): Promise<void> => {
    await act(async () => { gear().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }
  const turnOn = async (): Promise<void> => { await act(async () => useInboxView.getState().setTitleIcons(true)) }

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    storedDrafts = []
    vi.stubGlobal('api', {
      inbox: { changes: vi.fn(), setRead: vi.fn(async () => null), setArchived: vi.fn(async () => null), remove: vi.fn(), folders: vi.fn(), setComposer: vi.fn(async (value: unknown) => value) },
      chat: {
        drafts: vi.fn(async () => ({ drafts: storedDrafts.map((draft) => ({ ...draft })), threads: [] })),
        draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })),
      },
    })
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [
        thread('ses_a'),
        thread('ses_unread', { readAt: 0 }),
        thread('ses_c', { folderId: 'fld_docs', directory: '/home/me/docs' }),
        thread('ses_d', { folderId: 'fld_tree', directory: worktree.root, worktree }),
        thread('ses_plain', { folderId: 'fld_scratch', directory: '/home/me/scratch' }),
        thread('ses_gone', { folderId: 'fld_removed', directory: '/home/me/removed' }),
        thread('ses_run', { folderId: 'fld_docs', directory: '/home/me/docs', status: 'working', workingSince: Date.now() - 5_000 }),
      ],
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ workingSection: false, workingCollapsed: false, draftsCollapsed: false, titleIcons: false })
    useInboxDrafts.setState({ drafts: [], page: { id: 'drf_page', opened: false } })
    useInboxChat.setState({
      folders: [folder('fld_app', 'app', { icon: { kind: 'emoji', emoji: '🚀' } }), docs, scratch, tree],
      composer: { folderId: 'fld_app' },
      foldersLoaded: true,
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is off until it is turned on, and an unknown or unreadable stored value is off too', () => {
    expect(getInboxTitleIcons()).toBe(false)
    saveInboxTitleIcons(true)
    expect(localStorage.getItem(INBOX_TITLE_ICONS_STORAGE_KEY)).toBe('on')
    expect(getInboxTitleIcons()).toBe(true)
    saveInboxTitleIcons(false)
    expect(localStorage.getItem(INBOX_TITLE_ICONS_STORAGE_KEY)).toBe('off')
    expect(getInboxTitleIcons()).toBe(false)
    localStorage.setItem(INBOX_TITLE_ICONS_STORAGE_KEY, 'yes')
    expect(getInboxTitleIcons()).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getInboxTitleIcons()).toBe(false)
    expect(() => useInboxView.getState().setTitleIcons(true)).not.toThrow()
    // The choice still holds for this session.
    expect(useInboxView.getState().titleIcons).toBe(true)
  })

  it('leaves the icon beside the project name, and nothing in front of the title, until it is turned on', async () => {
    await render()
    expect(titleIcon('ses_a')).toBeNull()
    expect(nameLineIcon('ses_a')?.getAttribute('data-icon')).toBe('emoji')
    const lines = q('inbox-thread-ses_a')!.querySelectorAll(':scope > span')
    expect(Array.from(lines).some((line) => line.classList.contains('pl-5'))).toBe(false)
  })

  it('puts each project’s icon in front of the thread title and takes it from the line below', async () => {
    await turnOn()
    await render()
    const drawn = (id: string): string | null | undefined => titleIcon(id)?.getAttribute('data-icon')
    expect(drawn('ses_a')).toBe('emoji')
    expect(titleIcon('ses_a')?.textContent).toBe('🚀')
    expect(drawn('ses_c')).toBe('book')
    // A worktree thread has its project's icon; a project without one, or one that was removed, the plain folder.
    expect(drawn('ses_d')).toBe('emoji')
    expect(drawn('ses_plain')).toBe('folder')
    expect(drawn('ses_gone')).toBe('folder')
    // In front of the title: first in its line, before the title itself.
    const line = q('inbox-thread-ses_a')!.querySelector(':scope > span')!
    expect(line.firstElementChild).toBe(titleIcon('ses_a'))
    expect(line.querySelector('.truncate')?.textContent).toBe('Thread ses_a')
    // The line with the project's name keeps the name and the branch, without the icon.
    for (const id of ['ses_a', 'ses_c', 'ses_d', 'ses_plain', 'ses_gone']) expect(nameLineIcon(id)).toBeNull()
    expect(q('inbox-thread-project-ses_a')?.textContent).toBe('app')
    expect(q('inbox-thread-project-ses_a')?.parentElement?.textContent).toContain('main')
  })

  it('keeps the icon first, ahead of the unread mark, and starts the lines below where the title does', async () => {
    await turnOn()
    await render()
    const row = q('inbox-thread-ses_unread')!
    const unread = row.querySelector('[aria-label="Unread"]')!
    expect(titleIcon('ses_unread')!.compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const lines = Array.from(row.querySelectorAll(':scope > span'))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.slice(1).every((line) => line.classList.contains('pl-5'))).toBe(true)
  })

  it('shows them on the rows of the Working section too', async () => {
    useInboxView.setState({ workingSection: true })
    await turnOn()
    await render()
    const working = q('inbox-working-section')!
    expect(working.querySelector('[data-testid="inbox-thread-title-icon-ses_run"]')?.getAttribute('data-icon')).toBe('book')
    expect(working.querySelector('[data-testid="inbox-thread-ses_run"] [data-testid="project-icon"]')).toBeNull()
  })

  it('shows them on draft rows, ahead of the pen mark, taking a worktree draft’s from its project', async () => {
    storedDrafts = [
      { id: 'drf_app', folderId: 'fld_app', preview: 'Add a dark theme', attachments: 0, updatedAt: Date.now() - 60_000 },
      { id: 'drf_tree', folderId: 'fld_tree', preview: 'Try it in a worktree', attachments: 0, updatedAt: Date.now() - 120_000 },
    ]
    await render()
    expect(q('inbox-draft-title-icon-drf_app')).toBeNull()
    expect(q('inbox-draft-drf_app')?.querySelector('[data-testid="project-icon"]')?.getAttribute('data-icon')).toBe('emoji')
    await turnOn()
    expect(q('inbox-draft-title-icon-drf_app')?.getAttribute('data-icon')).toBe('emoji')
    expect(q('inbox-draft-title-icon-drf_tree')?.getAttribute('data-icon')).toBe('emoji')
    expect(q('inbox-draft-drf_app')?.querySelector('[data-testid="project-icon"]')).toBeNull()
    const line = q('inbox-draft-drf_app')!.querySelector(':scope > span')!
    expect(line.firstElementChild).toBe(q('inbox-draft-title-icon-drf_app'))
    expect(line.children[1]?.tagName.toLowerCase()).toBe('svg')
  })

  it('is a switch in the gear menu, after Git changes and Working section, and takes effect at once', async () => {
    await render()
    await openMenu()
    const item = menuItem()!
    expect(item.getAttribute('role')).toBe('menuitemcheckbox')
    expect(item.getAttribute('aria-checked')).toBe('false')
    expect(item.textContent).toContain('Project icons')
    const order = Array.from(document.body.querySelectorAll('[role="menuitemcheckbox"]')).map((entry) => entry.getAttribute('data-testid'))
    expect(order).toEqual(['inbox-setting-changes', 'inbox-setting-working', 'inbox-setting-title-icons', 'inbox-setting-quick-switch'])

    await act(async () => item.click())
    expect(titleIcon('ses_a')).not.toBeNull()
    expect(nameLineIcon('ses_a')).toBeNull()
    expect(localStorage.getItem(INBOX_TITLE_ICONS_STORAGE_KEY)).toBe('on')

    await openMenu()
    expect(menuItem()?.getAttribute('aria-checked')).toBe('true')
    await act(async () => menuItem()!.click())
    expect(titleIcon('ses_a')).toBeNull()
    expect(nameLineIcon('ses_a')?.getAttribute('data-icon')).toBe('emoji')
    expect(localStorage.getItem(INBOX_TITLE_ICONS_STORAGE_KEY)).toBe('off')
  })
})
