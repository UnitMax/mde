// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalPaneHeader } from '../src/renderer/components/TerminalPaneHeader'
import { MAX_TERMINAL_COUNT } from '../src/renderer/terminal/layout'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { OpenCodeTuiInstanceStatus, Session } from '../src/shared/types'
import { testLayout } from './helpers/terminal-layout'
import {
  choosePaneMenuItem,
  closePaneMenu,
  openPaneMenu,
  paneMenuItem,
  paneMenuOffers,
  paneMenuTrigger
} from './helpers/terminal-pane-menu'

const terminalFocus = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/terminal/sessions', () => ({
  getSession: () => ({ term: { focus: terminalFocus } })
}))
vi.mock('../src/renderer/components/TerminalGitInfo', () => ({ TerminalGitInfo: () => null }))

const session: Session = {
  id: 'ses-1', projectId: 'p', name: 'Project', kind: 'native', path: '/home/me/app', createdAt: ''
}
const wslSession: Session = { ...session, kind: 'wsl', distro: 'Debian' }
const ID = 'pane-1'

let root: Root
let container: HTMLDivElement

type HeaderProps = ComponentProps<typeof TerminalPaneHeader>

function paneIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `pane-${index + 1}`)
}

function props(overrides: Partial<HeaderProps> & { paneCount?: number; title?: string } = {}): HeaderProps {
  const { paneCount = 2, title, ...rest } = overrides
  const panes = paneIds(paneCount).map((terminalId) => ({ terminalId, ...(terminalId === ID && title ? { title } : {}) }))
  const terminalLayout = testLayout(panes)
  return {
    session,
    pane: terminalLayout.panes[0]!,
    terminalLayout,
    focused: false,
    isFullscreen: false,
    onToggleFullscreen: vi.fn(),
    onTitleChange: vi.fn(),
    onOpenCodeSessions: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    onSplit: vi.fn(),
    ...rest
  } as HeaderProps
}

const render = (next: HeaderProps): Promise<void> => act(async () => root.render(createElement(TerminalPaneHeader, next)))
const q = (testId: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const bar = (): HTMLElement => q('terminal-pane-title-bar')!
const titleText = (): HTMLElement => q('terminal-pane-title')!
const renameInput = (): HTMLInputElement | null => q('terminal-pane-title-input') as HTMLInputElement | null

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const pressKey = (target: Element, key: string): Promise<void> =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })

describe('TerminalPaneHeader', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    terminalFocus.mockReset()
    useWorkspace.setState({
      platform: { platform: 'linux', isWindows: false },
      wslAvailable: false,
      statuses: {},
      terminalDirectories: {},
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
  })

  describe('title', () => {
    it('is readable text, named after the terminal\'s folder until it is renamed', async () => {
      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app/server' } })
      await render(props())
      expect(titleText().textContent).toBe('server')
      expect(titleText().className).toContain('text-xs')
      expect(titleText().className).toContain('text-fg')
      expect(titleText().className).not.toContain('text-fg-muted')
      expect(titleText().title).toContain('/home/me/app/server')
      expect(bar().getAttribute('aria-label')).toBe('server')

      await render(props({ title: 'API' }))
      expect(titleText().textContent).toBe('API')
    })

    it('says terminal while the folder is unknown and follows the folder once it is reported', async () => {
      await render(props())
      expect(titleText().textContent).toBe('terminal')
      await act(async () => useWorkspace.getState().setTerminalDirectory({ terminalId: ID, directory: '/srv/www' }))
      expect(titleText().textContent).toBe('www')
    })

    it('keeps the OpenCode label for an agent pane', async () => {
      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app' } })
      const openCodeInstance = { terminalId: ID, status: 'working', title: 'Validate tax rules' } as OpenCodeTuiInstanceStatus
      await render(props({ openCodeInstance }))
      expect(titleText().textContent).toBe('Validate tax rules')
      expect(q('terminal-opencode-status')?.getAttribute('data-status')).toBe('working')
    })
  })

  describe('focus cue', () => {
    it('marks the focused pane with an accent border only when there is another pane', async () => {
      await render(props({ focused: true, paneCount: 2 }))
      expect(bar().getAttribute('data-focused')).toBe('true')
      expect(bar().className).toContain('border-accent/50')

      await render(props({ focused: false, paneCount: 2 }))
      expect(bar().className).not.toContain('border-accent')

      await render(props({ focused: true, paneCount: 1 }))
      expect(bar().getAttribute('data-focused')).toBe('true')
      expect(bar().className).not.toContain('border-accent')
    })

    it('keeps the actions out of the title\'s way until wanted, but always shows them in fullscreen', async () => {
      await render(props())
      const actions = q('terminal-pane-actions')!
      expect(actions.className).toContain('opacity-0')
      expect(actions.className).toContain('group-hover/header:opacity-100')
      expect(actions.className).toContain('group-data-[focused=true]/header:opacity-100')
      expect(actions.className).toContain('has-[[data-state=open]]:opacity-100')
      // The overlay must let clicks and double-clicks through to the title beneath it.
      expect(actions.className).toContain('pointer-events-none')

      await render(props({ isFullscreen: true }))
      expect(q('terminal-pane-actions')!.className).toMatch(/(^|\s)opacity-100(\s|$)/)
      expect(q('terminal-fullscreen-indicator')).not.toBeNull()
    })
  })

  describe('buttons', () => {
    it('toggles fullscreen and closes the pane, and offers no close for the last pane', async () => {
      const next = props()
      await render(next)
      await act(async () => q(`terminal-fullscreen-toggle-${ID}`)!.click())
      expect(next.onToggleFullscreen).toHaveBeenCalledOnce()
      await act(async () => q(`terminal-close-${ID}`)!.click())
      expect(next.onClose).toHaveBeenCalledOnce()

      await render(props({ paneCount: 1 }))
      expect(q(`terminal-close-${ID}`)).toBeNull()
      expect(q(`terminal-fullscreen-toggle-${ID}`)).not.toBeNull()
    })

    it('has just three buttons, whatever the platform', async () => {
      useWorkspace.setState({
        platform: { platform: 'win32', isWindows: true }, wslAvailable: true,
        statuses: { [ID]: 'running' }, terminalDirectories: { [ID]: '/home/me' }
      })
      await render(props({ session: wslSession }))
      expect(bar().querySelectorAll('button')).toHaveLength(3)
    })
  })

  describe('actions menu', () => {
    it('lists only the actions that apply, so a plain Linux shell gets Rename, Split and Restart', async () => {
      await render(props())
      await openPaneMenu(ID)
      const labels = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim())
      expect(labels).toEqual(['Rename…', 'Split right', 'Split down', 'Restart terminal'])
    })

    it('offers OpenCode sessions with its shortcut where agents are supported', async () => {
      const next = props({ session: wslSession })
      useWorkspace.setState({ platform: { platform: 'win32', isWindows: true } })
      await render(next)
      await openPaneMenu(ID)
      expect(paneMenuItem(`terminal-opencode-sessions-${ID}`)?.textContent).toContain('Ctrl+Shift+O')
      await closePaneMenu()
      await choosePaneMenuItem(ID, `terminal-opencode-sessions-${ID}`)
      expect(next.onOpenCodeSessions).toHaveBeenCalledOnce()
    })

    it('offers VS Code and File Explorer only for a WSL session on Windows, once the folder is known', async () => {
      const openTerminalInVsCode = vi.fn()
      const revealTerminal = vi.fn()
      Object.defineProperty(window, 'api', { configurable: true, value: { paths: { openTerminalInVsCode, revealTerminal } } })

      await render(props({ session: wslSession }))
      expect(await paneMenuOffers(ID, `terminal-open-vscode-${ID}`)).toBe(false)

      useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, wslAvailable: true })
      await render(props({ session: wslSession }))
      await openPaneMenu(ID)
      expect(paneMenuItem(`terminal-open-vscode-${ID}`)?.hasAttribute('data-disabled')).toBe(true)
      await closePaneMenu()

      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app' } })
      await render(props({ session: wslSession }))
      await choosePaneMenuItem(ID, `terminal-open-vscode-${ID}`)
      expect(openTerminalInVsCode).toHaveBeenCalledWith(ID)
      await choosePaneMenuItem(ID, `terminal-reveal-${ID}`)
      expect(revealTerminal).toHaveBeenCalledWith(ID)

      await render(props())
      expect(await paneMenuOffers(ID, `terminal-open-vscode-${ID}`)).toBe(false)
    })

    it('splits to the right and downward, and stops offering it at the pane limit', async () => {
      const next = props()
      await render(next)
      await choosePaneMenuItem(ID, `terminal-split-right-${ID}`)
      expect(next.onSplit).toHaveBeenLastCalledWith('right')
      await choosePaneMenuItem(ID, `terminal-split-down-${ID}`)
      expect(next.onSplit).toHaveBeenLastCalledWith('bottom')

      await render(props({ paneCount: MAX_TERMINAL_COUNT }))
      expect(await paneMenuOffers(ID, `terminal-split-right-${ID}`)).toBe(false)
      expect(await paneMenuOffers(ID, `terminal-split-down-${ID}`)).toBe(false)
    })

    it('asks for a restart rather than restarting itself', async () => {
      const next = props()
      await render(next)
      await choosePaneMenuItem(ID, `terminal-restart-${ID}`)
      expect(next.onRestart).toHaveBeenCalledOnce()
    })

    it('returns to the terminal when dismissed, but leaves focus to whatever a choice opens', async () => {
      await render(props())
      await openPaneMenu(ID)
      await closePaneMenu()
      expect(terminalFocus).toHaveBeenCalledOnce()

      terminalFocus.mockClear()
      await choosePaneMenuItem(ID, `terminal-restart-${ID}`)
      expect(terminalFocus).not.toHaveBeenCalled()
    })
  })

  describe('menu focus', () => {
    it('never hands focus back to the ⋯ button, which would race the title input\'s own focus', async () => {
      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app' } })
      await render(props())
      const handBack = vi.spyOn(paneMenuTrigger(ID)!, 'focus')

      await openPaneMenu(ID)
      await closePaneMenu()
      await choosePaneMenuItem(ID, `terminal-rename-${ID}`)
      await vi.waitFor(() => expect(document.activeElement).toBe(renameInput()))
      await pressKey(renameInput()!, 'Escape')
      await choosePaneMenuItem(ID, `terminal-restart-${ID}`)

      expect(handBack).not.toHaveBeenCalled()
    })
  })

  describe('renaming', () => {
    it('renames from the menu and keeps the input focused instead of committing on the menu\'s focus change', async () => {
      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app' } })
      const next = props()
      await render(next)
      await choosePaneMenuItem(ID, `terminal-rename-${ID}`)
      await vi.waitFor(() => expect(document.activeElement).toBe(renameInput()))
      expect(renameInput()?.value).toBe('app')
      expect(next.onTitleChange).not.toHaveBeenCalled()
      expect(terminalFocus).not.toHaveBeenCalled()

      await typeInto(renameInput()!, '  API  ')
      await pressKey(renameInput()!, 'Enter')
      expect(next.onTitleChange).toHaveBeenCalledExactlyOnceWith('API')
      expect(renameInput()).toBeNull()
    })

    it('gives the input the whole bar while renaming, then brings the actions back', async () => {
      await render(props({ isFullscreen: true }))
      expect(q('terminal-pane-actions')!.className).not.toContain('invisible')
      await act(async () => titleText().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
      expect(q('terminal-pane-actions')!.className).toContain('invisible')
      expect(q('terminal-fullscreen-indicator')?.parentElement?.className).toBe('hidden')
      await pressKey(renameInput()!, 'Escape')
      expect(q('terminal-pane-actions')!.className).not.toContain('invisible')
      expect(q('terminal-fullscreen-indicator')?.parentElement?.className).toBe('contents')
    })

    it('renames by double-clicking the title and cancels with Escape', async () => {
      const next = props({ title: 'API' })
      await render(next)
      await act(async () => titleText().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
      expect(renameInput()?.value).toBe('API')

      await typeInto(renameInput()!, 'Other')
      await pressKey(renameInput()!, 'Escape')
      expect(renameInput()).toBeNull()
      expect(next.onTitleChange).not.toHaveBeenCalled()
      expect(titleText().textContent).toBe('API')
    })

    it('stores nothing when the name is left as the derived default, so the title keeps following the folder', async () => {
      useWorkspace.setState({ terminalDirectories: { [ID]: '/home/me/app' } })
      const next = props()
      await render(next)
      await act(async () => titleText().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
      await pressKey(renameInput()!, 'Enter')
      expect(next.onTitleChange).toHaveBeenCalledExactlyOnceWith(null)
    })

    it('clears a custom title when it is emptied', async () => {
      const next = props({ title: 'API' })
      await render(next)
      await act(async () => titleText().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
      await typeInto(renameInput()!, '   ')
      await pressKey(renameInput()!, 'Enter')
      expect(next.onTitleChange).toHaveBeenCalledExactlyOnceWith(null)
    })
  })
})
