// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTabStrip } from '../src/renderer/components/SessionTabStrip'
import type { Session, SessionTab } from '../src/shared/types'

type StripProps = ComponentProps<typeof SessionTabStrip>

const tab = (id: string, name = id): SessionTab => ({
  id,
  name,
  layout: { tree: { type: 'pane', paneId: 'pane-1' }, panes: [{ id: 'pane-1' }] },
}) as SessionTab

function props(names: string[], activeIndex = 0, overrides: Partial<StripProps> = {}): StripProps {
  const tabs = names.map((name, index) => tab(`t${index}`, name))
  const session: Session = { id: 'ses-1', name: 'Project', kind: 'native', createdAt: '', tabs, activeTabId: tabs[activeIndex]!.id }
  return {
    session,
    activeTab: tabs[activeIndex]!,
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onRenameStart: vi.fn(),
    onRename: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

let root: Root
let container: HTMLDivElement

const render = (next: StripProps): Promise<void> => act(async () => root.render(createElement(SessionTabStrip, next)))
const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const list = (): HTMLElement => container.querySelector<HTMLElement>('[role="tablist"]')!
const tabs = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
const renameInput = (): HTMLInputElement | null => q('session-tab-rename-input') as HTMLInputElement | null
const click = (target: Element): Promise<void> => act(async () => { (target as HTMLElement).click() })
const key = (target: Element, name: string): Promise<void> =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function startRename(index: number): Promise<void> {
  await act(async () => {
    tabs()[index]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  })
}

/** happy-dom does no layout: each tab is 120 px wide at 130 px steps, in a strip 400 px wide holding `scrollWidth`. */
function stubLayout(scrollWidth: number): () => void {
  const stub = (name: string, get: (element: HTMLElement) => number): void => {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) { return get(this) },
    })
  }
  const isList = (element: HTMLElement): boolean => element.getAttribute('role') === 'tablist'
  stub('offsetLeft', (element) => Array.from(element.parentElement?.children ?? []).indexOf(element) * 130)
  stub('offsetWidth', () => 120)
  stub('clientWidth', (element) => (isList(element) ? 400 : 0))
  stub('scrollWidth', (element) => (isList(element) ? scrollWidth : 0))
  return () => ['offsetLeft', 'offsetWidth', 'clientWidth', 'scrollWidth'].forEach((name) => Reflect.deleteProperty(HTMLElement.prototype, name))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('SessionTabStrip', () => {
  describe('tabs', () => {
    it('lists the session\'s tabs and marks the one being shown', async () => {
      await render(props(['Server', 'Logs', 'Tests'], 1))
      expect(list().getAttribute('aria-label')).toBe('Project terminal tabs')
      expect(tabs().map((item) => item.textContent)).toEqual(['Server', 'Logs', 'Tests'])
      expect(tabs().map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
      // One tab stop for the strip: the shown tab.
      expect(tabs().map((item) => item.tabIndex)).toEqual([-1, 0, -1])
      expect(tabs().map((item) => item.parentElement!.getAttribute('data-selected'))).toEqual(['false', 'true', 'false'])
    })

    it('shows a session without saved tabs as its one default tab', async () => {
      const next = props(['x'])
      await render({ ...next, session: { ...next.session, tabs: undefined } })
      expect(tabs().map((item) => item.textContent)).toEqual(['Tab 1'])
    })

    it('selects a tab by clicking it, and adds one with the plus', async () => {
      const next = props(['Server', 'Logs'])
      await render(next)
      await click(q('session-tab-t1')!)
      expect(next.onSelect).toHaveBeenCalledWith('t1')
      await click(q('session-tab-add')!)
      expect(next.onAdd).toHaveBeenCalledTimes(1)
    })
  })

  describe('closing', () => {
    it('offers a close button on every tab when there are several', async () => {
      await render(props(['Server', 'Logs', 'Tests']))
      expect(['t0', 't1', 't2'].map((id) => q(`session-tab-close-${id}`)?.getAttribute('aria-label'))).toEqual([
        'Close Server',
        'Close Logs',
        'Close Tests',
      ])
    })

    it('closes the tab it belongs to without selecting it', async () => {
      const next = props(['Server', 'Logs'], 0)
      await render(next)
      await click(q('session-tab-close-t1')!)
      expect(next.onClose).toHaveBeenCalledWith('t1')
      expect(next.onSelect).not.toHaveBeenCalled()
    })

    it('has no close button on the only tab: a session keeps one tab', async () => {
      await render(props(['Server']))
      expect(container.querySelector('[aria-label^="Close"]')).toBeNull()
      expect(tabs()).toHaveLength(1)
    })

    it('keeps the buttons of tabs that are not shown out of sight until they are used', async () => {
      await render(props(['Server', 'Logs'], 0))
      const shown = q('session-tab-close-t0')!.className
      const idle = q('session-tab-close-t1')!.className
      expect(shown).toContain('opacity-100')
      expect(idle).toContain('opacity-0')
      expect(idle).toContain('group-hover:opacity-100')
      expect(idle).toContain('group-focus-within:opacity-100')
      // Hidden or not, the button keeps its place, so that no tab changes width as the pointer crosses the strip.
      expect(idle).not.toContain('hidden')
    })
  })

  describe('renaming', () => {
    it('opens an input holding the name on a double-click, and commits the new name on Enter', async () => {
      const next = props(['Server', 'Logs'], 0)
      await render(next)
      await startRename(0)
      expect(next.onRenameStart).toHaveBeenCalledTimes(1)
      expect(renameInput()!.value).toBe('Server')
      await vi.waitFor(() => expect(document.activeElement).toBe(renameInput()))

      await typeInto(renameInput()!, '  API  ')
      await key(renameInput()!, 'Enter')
      expect(next.onRename).toHaveBeenCalledWith('t0', 'API')
      expect(renameInput()).toBeNull()
    })

    it('selects a tab that is not shown before renaming it', async () => {
      const next = props(['Server', 'Logs'], 0)
      await render(next)
      await startRename(1)
      expect(next.onSelect).toHaveBeenCalledWith('t1')
      expect(renameInput()!.value).toBe('Logs')
    })

    it('starts with F2 on the focused tab', async () => {
      const next = props(['Server', 'Logs'], 0)
      await render(next)
      await key(tabs()[0]!, 'F2')
      expect(renameInput()).not.toBeNull()
      expect(next.onRenameStart).toHaveBeenCalledTimes(1)
    })

    it('drops the change on Escape and keeps the name when it is cleared', async () => {
      const next = props(['Server', 'Logs'], 0)
      await render(next)
      await startRename(0)
      await typeInto(renameInput()!, 'Other')
      await key(renameInput()!, 'Escape')
      expect(renameInput()).toBeNull()
      expect(next.onRename).not.toHaveBeenCalled()

      await startRename(0)
      await typeInto(renameInput()!, '   ')
      await key(renameInput()!, 'Enter')
      expect(next.onRename).not.toHaveBeenCalled()
    })

    it('does not let the keys typed in the input reach the rest of the app', async () => {
      await render(props(['Server']))
      await startRename(0)
      const seen = vi.fn()
      document.addEventListener('keydown', seen)
      await key(renameInput()!, 'a')
      document.removeEventListener('keydown', seen)
      expect(seen).not.toHaveBeenCalled()
    })
  })

  describe('when there are more tabs than fit', () => {
    const names = Array.from({ length: 8 }, (_, index) => `Tab ${index + 1}`)
    let restore: () => void
    afterEach(() => restore?.())

    it('fades only the end that has more tabs beyond it', async () => {
      restore = stubLayout(1040)
      await render(props(names, 0))
      expect(list().getAttribute('data-overflow')).toBe('end')

      list().scrollLeft = 300
      await act(async () => { list().dispatchEvent(new Event('scroll')) })
      expect(list().getAttribute('data-overflow')).toBe('both')

      list().scrollLeft = 640
      await act(async () => { list().dispatchEvent(new Event('scroll')) })
      expect(list().getAttribute('data-overflow')).toBe('start')
    })

    it('has no fade when every tab fits', async () => {
      restore = stubLayout(400)
      await render(props(names.slice(0, 3), 0))
      expect(list().getAttribute('data-overflow')).toBe('none')
    })

    it('brings the tab being shown into view, clear of the fade', async () => {
      restore = stubLayout(1040)
      const scrollTo = vi.fn()
      await render(props(names, 0))
      Object.assign(list(), { scrollTo })
      // Tab 6 spans 650 to 770; with the fade on either side it needs 794 - 400.
      await render(props(names, 5))
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 394, behavior: 'smooth' })

      // Back to the first one: all the way to the start.
      list().scrollLeft = 394
      await render(props(names, 0))
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })
    })

    it('leaves the strip alone when the tab is already in view', async () => {
      restore = stubLayout(1040)
      const scrollTo = vi.fn()
      await render(props(names, 0))
      Object.assign(list(), { scrollTo })
      await render(props(names, 1))
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('turns the mouse wheel into sideways scrolling, and leaves sideways gestures to the browser', async () => {
      restore = stubLayout(1040)
      await render(props(names, 0))
      const wheel = (init: WheelEventInit): Promise<void> =>
        act(async () => { list().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })) })

      await wheel({ deltaY: 120 })
      expect(list().scrollLeft).toBe(120)
      await wheel({ deltaX: 90, deltaY: 10 })
      expect(list().scrollLeft).toBe(120)
    })
  })
})
