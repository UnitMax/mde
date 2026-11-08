// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { useWorkspace } from '../src/renderer/store/workspace'
import { defaultSessionTab } from '../src/renderer/terminal/tabs'
import { TERMINAL_CARD_GAP_PX, TERMINAL_RESIZE_GAP_PX, type SessionTerminalLayout } from '../src/renderer/terminal/layout'
import {
  getTerminalSettings,
  saveTerminalSettings,
  TERMINAL_SETTINGS_STORAGE_KEY
} from '../src/renderer/terminal/terminal-settings'
import type { Session } from '../src/shared/types'
import { testLayout } from './helpers/terminal-layout'

// xterm.js needs a real browser. The pane only needs something with a screen to put in its host.
vi.mock('../src/renderer/terminal/sessions', () => {
  const fake = (terminalId: string) => ({
    terminalId,
    term: { focus: vi.fn(), reset: vi.fn(), paste: vi.fn(), dispose: vi.fn() },
    container: document.createElement('div'),
    themeId: 'dark',
  })
  return {
    attachSession: vi.fn((terminalId: string, host: HTMLElement) => {
      const session = fake(terminalId)
      host.append(session.container)
      return session
    }),
    detachSession: vi.fn(),
    disposeSession: vi.fn(),
    applyTerminalSettings: vi.fn(),
    fitSession: () => ({ cols: 80, rows: 24 }),
    getSession: (terminalId: string) => fake(terminalId),
  }
})

const session: Session = { id: 'ses-1', name: 'My session', kind: 'native', createdAt: '' }
let root: Root
let container: HTMLDivElement
const render = (element: ReactElement): Promise<void> => act(async () => root.render(element))

function layoutOf(count: number, ratio = 0.5): SessionTerminalLayout {
  return testLayout(Array.from({ length: count }, (_, index) => ({ terminalId: `pane-${index + 1}` })), ratio)
}

function view(layout: SessionTerminalLayout, overrides: Record<string, unknown> = {}): ReactElement {
  return createElement(TerminalView, {
    session,
    activeTab: defaultSessionTab(session.id),
    terminalLayout: layout,
    embedded: true,
    onSplitPane: vi.fn(),
    onLayoutResize: vi.fn(),
    onPaneOrderChange: vi.fn(),
    onClosePane: vi.fn(),
    onPaneFocus: vi.fn(),
    onPaneTitleChange: vi.fn(),
    ...overrides,
  })
}

const grid = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="terminal-grid"]')!
const panes = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="terminal-pane"]'))
const activeIds = (): string[] =>
  panes().flatMap((pane, index) => (pane.dataset.active === 'true' ? [`pane-${index + 1}`] : []))
const slot = (index: number): HTMLElement => container.querySelector<HTMLElement>(`[data-terminal-pane-slot="${index}"]`)!
const focusPane = (index: number): Promise<void> =>
  act(async () => {
    panes()[index]!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', {
    pty: { ensure: vi.fn(async () => 'running'), resize: vi.fn(async () => {}), statuses: vi.fn(async () => ({})) },
    git: { terminalInfo: vi.fn(async () => null) },
  })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false }, wslAvailable: false, distros: [],
    statuses: {}, exits: {}, terminalDirectories: {},
    settingsDialog: { open: false, section: 'appearance' },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('card terminals', () => {
  it('keeps the edge-to-edge layout by default', async () => {
    await render(view(layoutOf(2)))

    expect(grid().dataset.cards).toBe('false')
    expect(panes().map((pane) => pane.dataset.card)).toEqual(['false', 'false'])
    expect(grid().className).toContain('bg-line')
    expect((grid().firstElementChild as HTMLElement).style.inset).toMatch(/^0(px)?$/)
    expect(slot(0).style.width).toBe(`calc(50% + -${TERMINAL_RESIZE_GAP_PX / 2}px)`)
    expect(panes()[0]!.className).not.toContain('rounded-lg')
  })

  it('draws rounded cards with space around and between them when the setting is on', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    await render(view(layoutOf(2)))

    expect(grid().dataset.cards).toBe('true')
    expect(grid().className).toContain('bg-panel')
    expect(grid().className).not.toContain('bg-line')
    expect((grid().firstElementChild as HTMLElement).style.inset).toBe(`${TERMINAL_CARD_GAP_PX}px`)
    expect(slot(0).style.width).toBe(`calc(50% + -${TERMINAL_CARD_GAP_PX / 2}px)`)
    expect(slot(1).style.left).toBe(`calc(50% + ${TERMINAL_CARD_GAP_PX / 2}px)`)
    for (const pane of panes()) {
      expect(pane.dataset.card).toBe('true')
      expect(pane.className).toContain('rounded-lg')
      expect(pane.className).toContain('overflow-hidden')
    }
  })

  it('switches layout live when the setting is saved while terminals are shown', async () => {
    await render(view(layoutOf(2)))
    expect(grid().dataset.cards).toBe('false')

    await act(async () => saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true }))
    expect(grid().dataset.cards).toBe('true')

    await act(async () => saveTerminalSettings({ ...getTerminalSettings(), terminalCards: false }))
    expect(grid().dataset.cards).toBe('false')
  })

  it('highlights only the active card, following focus', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    await render(view(layoutOf(3)))
    expect(activeIds()).toEqual([])

    await focusPane(1)
    expect(activeIds()).toEqual(['pane-2'])
    expect(panes()[1]!.className).toContain('border-accent')
    expect(panes()[0]!.className).not.toContain('border-accent')
    expect(panes()[0]!.className).toContain('border-line-strong')

    await focusPane(2)
    expect(activeIds()).toEqual(['pane-3'])
  })

  it('mutes the titles of the cards that are not active', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    await render(view(layoutOf(2)))
    await focusPane(0)

    const titles = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="terminal-pane-title"]'))
    expect(titles[0]!.className).toContain('text-fg')
    expect(titles[0]!.className).not.toContain('text-fg-muted')
    expect(titles[1]!.className).toContain('text-fg-muted')
  })

  it('has nothing to single out when there is one card', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    await render(view(layoutOf(1)))
    await focusPane(0)

    expect(activeIds()).toEqual([])
    expect(panes()[0]!.dataset.card).toBe('true')
  })

  it('never highlights a pane as active in the edge-to-edge layout', async () => {
    await render(view(layoutOf(2)))
    await focusPane(0)

    expect(activeIds()).toEqual([])
  })

  it('keeps each divider centered in the gap it sits in', async () => {
    const separator = (): HTMLElement => container.querySelector<HTMLElement>('[role="separator"]')!
    const ratio = 0.25
    await render(view(layoutOf(2, ratio)))
    const edgeToEdge = TERMINAL_RESIZE_GAP_PX / 2 - ratio * TERMINAL_RESIZE_GAP_PX
    expect(separator().style.left).toBe(`calc(25% + ${edgeToEdge}px)`)

    await act(async () => saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true }))
    const carded = TERMINAL_CARD_GAP_PX / 2 - ratio * TERMINAL_CARD_GAP_PX
    expect(separator().style.left).toBe(`calc(25% + ${carded}px)`)
    // The divider is the line a hover paints: a thin rounded bar in the card layout's wider gap.
    expect(separator().querySelector('span')!.className).toContain('rounded-full')
  })

  it('moves a divider by the keyboard in steps of the usable width', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    const onLayoutResize = vi.fn()
    await render(view(layoutOf(2), { onLayoutResize }))
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      width: 1006, height: 400, left: 0, top: 0, right: 1006, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
    })

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })

    // Usable width is 1000 once the 6px gap is taken out, so a 2% step lands the divider at 52%.
    expect(onLayoutResize).toHaveBeenCalledTimes(1)
    expect(onLayoutResize.mock.calls[0]![1]).toBeCloseTo(0.52, 5)
  })
})

describe('Settings → Appearance → Card terminals', () => {
  const toggle = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-testid="terminal-cards"]')
  const show = async (): Promise<void> => {
    useWorkspace.setState({ settingsDialog: { open: true, section: 'appearance' } })
    await act(async () => root.render(createElement(SettingsDialog, { terminalIds: [] })))
  }

  it('is offered, off by default, and stores the choice for every terminal', async () => {
    await show()
    expect(toggle()?.getAttribute('role')).toBe('switch')
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')

    await act(async () => toggle()!.click())
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(getTerminalSettings().terminalCards).toBe(true)
    expect(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)!).terminalCards).toBe(true)

    await act(async () => toggle()!.click())
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(getTerminalSettings().terminalCards).toBe(false)
  })

  it('shows a stored choice when the dialog opens', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), terminalCards: true })
    await show()

    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
  })
})
