// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InboxSidebarFrame } from '../src/renderer/components/inbox/InboxSidebarFrame'
import {
  clampInboxSidebarWidth,
  getInboxSidebarWidth,
  INBOX_SIDEBAR_DEFAULT_WIDTH,
  INBOX_SIDEBAR_MAX_WIDTH,
  INBOX_SIDEBAR_MIN_WIDTH,
  INBOX_SIDEBAR_WIDTH_STORAGE_KEY,
  parseStoredTerminalLayout,
} from '../src/renderer/lib/inbox-settings'
import { useInboxView } from '../src/renderer/store/inbox-view'

describe('the sidebar width setting', () => {
  beforeEach(() => localStorage.clear())

  it('is the default until it is set, and stays within the minimum and maximum', () => {
    expect(getInboxSidebarWidth()).toBe(INBOX_SIDEBAR_DEFAULT_WIDTH)
    expect(clampInboxSidebarWidth(10)).toBe(INBOX_SIDEBAR_MIN_WIDTH)
    expect(clampInboxSidebarWidth(99_999)).toBe(INBOX_SIDEBAR_MAX_WIDTH)
    expect(clampInboxSidebarWidth(400.6)).toBe(401)
    expect(clampInboxSidebarWidth(Number.NaN)).toBe(INBOX_SIDEBAR_DEFAULT_WIDTH)
  })

  it('reads back what was stored, and repairs what was hand-edited', () => {
    localStorage.setItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY, '540')
    expect(getInboxSidebarWidth()).toBe(540)
    localStorage.setItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY, 'wide')
    expect(getInboxSidebarWidth()).toBe(INBOX_SIDEBAR_DEFAULT_WIDTH)
    localStorage.setItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY, '50')
    expect(getInboxSidebarWidth()).toBe(INBOX_SIDEBAR_MIN_WIDTH)
  })
})

describe('the stored terminal layout', () => {
  it('accepts a nested tree with its divider ratios', () => {
    const tree = { type: 'split', id: 'split', axis: 'row', ratio: 0.3, first: { type: 'pane', paneId: 'a' }, second: { type: 'pane', paneId: 'b' } }
    expect(parseStoredTerminalLayout(JSON.stringify({ tree }))).toEqual({ tree })
    expect(parseStoredTerminalLayout(JSON.stringify({ tree: { ...tree, ratio: 0 } }))).toBeNull()
    expect(parseStoredTerminalLayout(JSON.stringify({ tree: { ...tree, second: tree.first } }))).toBeNull()
  })

  it('rejects malformed values and old preset layouts', () => {
    for (const raw of [null, 'null', '[]', '{', JSON.stringify({ layout: 'columns', sizes: {} })]) {
      expect(parseStoredTerminalLayout(raw)).toBeNull()
    }
  })
})

describe('the resizable sidebar frame', () => {
  let root: Root
  let container: HTMLDivElement
  const handle = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-sidebar-resize"]')!
  const frame = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-sidebar-frame"]')!
  const key = (name: string, init: KeyboardEventInit = {}): Promise<void> =>
    act(async () => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })) })
  const pointer = (type: string, x: number, init: Record<string, unknown> = {}): Promise<void> =>
    act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })
      Object.assign(event, { pointerId: 1, ...init })
      handle().dispatchEvent(event)
    })

  beforeEach(async () => {
    localStorage.clear()
    useInboxView.setState({ sidebarWidth: INBOX_SIDEBAR_DEFAULT_WIDTH })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => root.render(createElement(InboxSidebarFrame, null, createElement('p', null, 'panel'))))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('is a vertical separator at the sidebar width, with the panel inside it', () => {
    expect(handle().getAttribute('role')).toBe('separator')
    expect(handle().getAttribute('aria-orientation')).toBe('vertical')
    expect(handle().getAttribute('aria-valuenow')).toBe(String(INBOX_SIDEBAR_DEFAULT_WIDTH))
    expect(frame().style.width).toBe(`${INBOX_SIDEBAR_DEFAULT_WIDTH}px`)
    expect(frame().textContent).toBe('panel')
  })

  it('widens with the left arrow and narrows with the right, by more with Shift, and keeps the width', async () => {
    await key('ArrowLeft')
    expect(frame().style.width).toBe('276px')
    await key('ArrowLeft', { shiftKey: true })
    expect(frame().style.width).toBe('340px')
    expect(localStorage.getItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('340')
    await key('ArrowRight')
    expect(frame().style.width).toBe('324px')
  })

  it('never goes under the minimum, and Home and End go to the limits', async () => {
    await key('ArrowRight', { shiftKey: true })
    expect(frame().style.width).toBe(`${INBOX_SIDEBAR_MIN_WIDTH}px`)
    await key('End')
    expect(frame().style.width).toBe(`${INBOX_SIDEBAR_MAX_WIDTH}px`)
    await key('Home')
    expect(frame().style.width).toBe(`${INBOX_SIDEBAR_MIN_WIDTH}px`)
  })

  it('leaves other keys alone', async () => {
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    await act(async () => { handle().dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
  })

  it('follows a drag to the left, widening, and keeps the width only when the drag ends', async () => {
    await pointer('pointerdown', 1000)
    await pointer('pointermove', 900)
    expect(useInboxView.getState().sidebarWidth).toBe(360)
    expect(handle().getAttribute('data-dragging')).toBe('true')
    expect(localStorage.getItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull()
    await pointer('pointermove', 800)
    await pointer('pointerup', 800)
    expect(useInboxView.getState().sidebarWidth).toBe(460)
    expect(localStorage.getItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('460')
    expect(handle().getAttribute('data-dragging')).toBeNull()
    // A pointer that moves after the drag ended changes nothing.
    await pointer('pointermove', 100)
    expect(useInboxView.getState().sidebarWidth).toBe(460)
  })

  it('ignores a drag by another pointer and a press of another button', async () => {
    await pointer('pointerdown', 1000, { button: 2 })
    await pointer('pointermove', 500)
    expect(useInboxView.getState().sidebarWidth).toBe(INBOX_SIDEBAR_DEFAULT_WIDTH)
    await pointer('pointerdown', 1000)
    await pointer('pointermove', 500, { pointerId: 2 })
    expect(useInboxView.getState().sidebarWidth).toBe(INBOX_SIDEBAR_DEFAULT_WIDTH)
  })

  it('goes back to the default on a double-click', async () => {
    await key('End')
    await act(async () => { handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(frame().style.width).toBe(`${INBOX_SIDEBAR_DEFAULT_WIDTH}px`)
    expect(localStorage.getItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(INBOX_SIDEBAR_DEFAULT_WIDTH))
  })
})
