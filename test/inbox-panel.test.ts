// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const setRead = vi.fn(async () => null)

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'feature/login',
    model: { id: 'model-1', providerId: 'provider-1' },
    status: 'completed',
    createdAt: 1,
    lastActivityAt: Date.now() - 5 * 60_000,
    readAt: 0,
    archived: false,
    ...overrides
  }
}

async function render(element: Parameters<Root['render']>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', {
    inbox: { setRead, setArchived: vi.fn(async () => null), remove: vi.fn(async () => undefined) }
  })
  setRead.mockClear()
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    opencodeTuiEnabled: true,
    inboxThreads: [],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'inbox',
    settingsDialog: { open: false, section: 'appearance' }
  })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Inbox', () => {
  it('is locked until status reporting is on, and opens OpenCode settings from there', async () => {
    useWorkspace.setState({ opencodeTuiEnabled: false, inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-locked"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    const main = await render(createElement(InboxThreadView))
    const button = Array.from(main.querySelectorAll('button')).find((item) => item.textContent?.includes('Open OpenCode settings'))
    await act(async () => button!.click())
    expect(useWorkspace.getState().settingsDialog).toEqual({ open: true, section: 'opencode' })
  })

  it('explains where threads come from while empty', async () => {
    const panel = await render(createElement(InboxPanel))
    expect(panel.textContent).toContain('No threads yet.')
    expect(panel.textContent).toContain('2.1.0')
  })

  it('lists threads like mail and opens the selected one', async () => {
    useWorkspace.setState({
      inboxThreads: [
        thread(),
        thread({ id: 'ses_two', title: 'Old work', readAt: Date.now(), lastActivityAt: Date.now() - 2 * 3_600_000, status: 'idle' })
      ]
    })
    const panel = await render(createElement(InboxPanel))
    const rows = panel.querySelectorAll('[data-testid^="inbox-thread-ses_"]')
    expect(Array.from(rows).map((row) => row.getAttribute('data-testid'))).toEqual(['inbox-thread-ses_one', 'inbox-thread-ses_two'])
    const first = rows[0] as HTMLElement
    expect(first.dataset.unread).toBe('true')
    expect(first.textContent).toContain('Fix login')
    expect(first.textContent).toContain('5m ago')
    expect(first.textContent).toContain('app')
    expect(first.textContent).toContain('feature/login')
    expect(first.textContent).toContain('model-1')
    expect(first.textContent).toContain('Done')
    expect((rows[1] as HTMLElement).dataset.unread).toBeUndefined()
    expect(rows[1]!.textContent).toContain('2h ago')

    await act(async () => first.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(setRead).toHaveBeenCalledWith({ id: 'ses_one', read: true })

    const main = await render(createElement(InboxThreadView))
    expect(main.textContent).toContain('Fix login')
    expect(main.textContent).toContain('/home/me/app (Ubuntu)')
    expect(main.textContent).toContain('Conversation view coming soon')
  })

  it('filters and searches the list', async () => {
    useWorkspace.setState({
      inboxThreads: [
        thread(),
        thread({ id: 'ses_two', title: 'Question', status: 'attention', attentionReason: 'question', branch: null })
      ]
    })
    const panel = await render(createElement(InboxPanel))
    const filter = (label: string) => Array.from(panel.querySelectorAll('button')).find((item) => item.textContent === label)!
    await act(async () => filter('Needs input').click())
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).not.toBeNull()
    await act(async () => filter('All').click())

    const search = panel.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'feature')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).toBeNull()
  })
})
