// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BesideFilePane } from '../src/renderer/components/inbox/BesideFilePane'
import {
  clampInboxBesideFileShare,
  getInboxBesideFileShare,
  INBOX_BESIDE_FILE_DEFAULT_SHARE,
  INBOX_BESIDE_FILE_MAX_SHARE,
  INBOX_BESIDE_FILE_MIN_SHARE,
  INBOX_BESIDE_FILE_SHARE_STORAGE_KEY,
} from '../src/renderer/lib/inbox-settings'
import { useWorkspace } from '../src/renderer/store/workspace'

describe('the share of a file beside the chat', () => {
  beforeEach(() => localStorage.clear())

  it('is half until it is set, and stays within its bounds', () => {
    expect(getInboxBesideFileShare()).toBe(INBOX_BESIDE_FILE_DEFAULT_SHARE)
    expect(clampInboxBesideFileShare(0)).toBe(INBOX_BESIDE_FILE_MIN_SHARE)
    expect(clampInboxBesideFileShare(1)).toBe(INBOX_BESIDE_FILE_MAX_SHARE)
    expect(clampInboxBesideFileShare(Number.NaN)).toBe(INBOX_BESIDE_FILE_DEFAULT_SHARE)
    localStorage.setItem(INBOX_BESIDE_FILE_SHARE_STORAGE_KEY, '0.35')
    expect(getInboxBesideFileShare()).toBe(0.35)
    localStorage.setItem(INBOX_BESIDE_FILE_SHARE_STORAGE_KEY, 'wide')
    expect(getInboxBesideFileShare()).toBe(INBOX_BESIDE_FILE_DEFAULT_SHARE)
  })
})

describe('the pane beside the chat', () => {
  let root: Root
  let container: HTMLDivElement
  const handle = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-beside-file-resize"]')!
  const pane = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-beside-file"]')!
  const key = (name: string, init: KeyboardEventInit = {}): Promise<void> =>
    act(async () => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })) })

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(BesideFilePane, null, createElement('p', null, 'file'))))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('takes its share of the width, changed from the keyboard and kept', async () => {
    expect(pane().style.width).toBe('50%')
    expect(pane().textContent).toBe('file')
    await key('ArrowLeft')
    expect(pane().style.width).toBe('52%')
    await key('ArrowRight', { shiftKey: true })
    expect(pane().style.width).toBe('42%')
    expect(localStorage.getItem(INBOX_BESIDE_FILE_SHARE_STORAGE_KEY)).toBe('0.42')
    await key('End')
    expect(handle().getAttribute('aria-valuenow')).toBe('80')
    await act(async () => { handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(pane().style.width).toBe('50%')
  })
})

describe('where a file opens', () => {
  beforeEach(() => useWorkspace.setState({ openFiles: {}, besideFiles: {} }))

  it('keeps its place when another file opens, moves when asked, and starts over the chat once closed', () => {
    const files = useWorkspace.getState()
    files.openFile('t1', 'a.md', true)
    files.openFile('t1', 'b.md')
    expect(useWorkspace.getState()).toMatchObject({ openFiles: { t1: 'b.md' }, besideFiles: { t1: true } })
    files.placeFile('t1', false)
    expect(useWorkspace.getState().besideFiles).toEqual({})
    files.placeFile('t2', true)
    expect(useWorkspace.getState().besideFiles).toEqual({})
    files.placeFile('t1', true)
    files.closeFile('t1')
    files.openFile('t1', 'a.md')
    expect(useWorkspace.getState()).toMatchObject({ openFiles: { t1: 'a.md' }, besideFiles: {} })
  })
})
