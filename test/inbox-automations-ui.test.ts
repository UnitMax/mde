// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationSaveRequest, InboxAutomation } from '../src/shared/automations'
import type { ChatOptions, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { InboxAutomationsButton } from '../src/renderer/components/inbox/InboxAutomationsButton'
import { automationScheduleInSentence, automationTimeLabel, automationTitle, formSchedule, scheduleForm } from '../src/renderer/lib/automations'
import { automationThreadToast } from '../src/renderer/lib/toasts'
import { resetInboxAutomationsFollowing, useInboxAutomations } from '../src/renderer/store/inbox-automations'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, setMessageText } from './helpers/chat-input'

const model = { id: 'model-1', providerId: 'provider-1' }
const options: ChatOptions = { agents: [{ id: 'build', name: 'Build' }], models: [{ ...model, name: 'Test Model', providerName: 'Test' }], defaultModel: model, defaultAgent: 'build', skills: [] }
const folder = { id: 'fld_app', name: 'app', directory: '/home/me/app', target: { kind: 'native' as const }, createdAt: 1, lastUsedAt: 1 }
const thread = (patch: Partial<InboxThread> = {}): InboxThread => ({ id: 'ses_one', title: 'Check the build', directory: folder.directory, target: folder.target, branch: 'main', model, status: 'completed', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: folder.id, ...patch })
const NOW = new Date(2026, 10, 16, 8, 0).getTime()
const automation = (patch: Partial<InboxAutomation> = {}): InboxAutomation => ({
  id: 'aut_one', folderId: folder.id, text: 'Check the build\nand say what broke', agent: 'build', model,
  schedule: { kind: 'daily', time: 540 }, enabled: true, createdAt: NOW, nextRunAt: new Date(2026, 10, 16, 9, 0).getTime(), runs: 0, ...patch,
})

let listeners: Array<(list: InboxAutomation[]) => void> = []
let attachments: Array<{ id: string; name: string; mime: string; size: number }> = []
const api = {
  inbox: { setRead: vi.fn(async () => null), setComposer: vi.fn(async (value) => value), gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })), remove: vi.fn(async () => {}) },
  chat: {
    options: vi.fn(async () => options),
    draft: vi.fn(async (request) => ({ text: request.text ?? '', revision: 1, attachments })),
    drafts: vi.fn(async () => ({ drafts: [], threads: [] })),
    create: vi.fn(async () => thread()),
    messages: vi.fn(async () => ({ messages: [], older: null, running: false })),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    mcp: vi.fn(async () => ({ servers: [], supported: true })),
    subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}), send: vi.fn(async () => null),
  },
  automations: {
    list: vi.fn(async (): Promise<InboxAutomation[]> => []),
    save: vi.fn(async (request: AutomationSaveRequest): Promise<InboxAutomation> => automation({ ...request, id: request.id ?? 'aut_new', mode: request.mode === 'terminal' ? 'terminal' : undefined, permissionMode: undefined }) as InboxAutomation),
    remove: vi.fn(async () => {}),
    setEnabled: vi.fn(async ({ id, enabled }: { id: string; enabled: boolean }) => automation({ id, enabled })),
    run: vi.fn(async ({ id }: { id: string }) => automation({ id, runs: 1, lastRunAt: NOW, lastThreadId: 'ses_one' })),
    onChanged: vi.fn((listener: (list: InboxAutomation[]) => void) => { listeners.push(listener); return () => {} }),
  },
}

let root: Root
let container: HTMLDivElement
const render = () => act(async () => root.render(createElement('div', null, createElement(InboxAutomationsButton), createElement(InboxThreadView))))
const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.body.querySelector<T>(selector)
const all = (selector: string) => Array.from(document.body.querySelectorAll<HTMLElement>(selector))
const text = (selector: string) => q(selector)?.textContent?.replace(/\s+/g, ' ').trim()
const click = (selector: string) => act(async () => q(selector)!.click())
const picker = () => q('[data-testid="automation-picker"]')!
/** Radix opens its menus on a keyboard press in happy-dom. */
const choose = async (testId: string) => {
  await act(async () => { picker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await click(`[data-testid="${testId}"]`)
}
const type = (selector: string, value: string) => act(async () => {
  const input = q<HTMLInputElement | HTMLTextAreaElement>(selector)!
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.clear()
  listeners = []
  attachments = []
  resetInboxAutomationsFollowing()
  api.automations.list.mockResolvedValue([])
  api.automations.run.mockImplementation(async ({ id }: { id: string }) => automation({ id, runs: 1, lastRunAt: NOW, lastThreadId: 'ses_one' }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.stubGlobal('api', api)
  useWorkspace.setState({ activeWorkspaceView: 'inbox', platform: { platform: 'darwin', isWindows: false }, inboxThreads: [], selectedInboxThreadId: null, statuses: {}, exits: {}, terminalDirectories: {} })
  useInboxChat.setState({ folders: [folder], composer: { folderId: folder.id }, foldersLoaded: true, threads: {}, options: {}, recent: [], titleRegenerations: {}, draftReloads: {} })
  useInboxDrafts.setState({ page: { id: 'drf_page', opened: false }, drafts: [], threadDrafts: [] })
  useInboxAutomations.setState({ automations: [], loaded: false, manager: { open: false } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('automation words', () => {
  it('names an automation by the first line of its message', () => {
    expect(automationTitle('> quoted\n\n  Check the build  \nmore')).toBe('quoted')
    expect(automationTitle('\n\nCheck the build')).toBe('Check the build')
    expect(automationTitle('x'.repeat(200))).toHaveLength(80)
  })

  it('says a moment from now', () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
    expect(automationTimeLabel(at(16, 8, 12), NOW)).toBe('in 12 minutes')
    expect(automationTimeLabel(at(16, 14), NOW)).toBe('today at 14:00')
    expect(automationTimeLabel(at(17, 9), NOW)).toBe('tomorrow at 9:00')
    expect(automationTimeLabel(at(23, 9, 5), NOW)).toBe('Mon 23 Nov at 9:05')
    expect(automationTimeLabel(at(16, 7, 55), NOW)).toBe('5 minutes ago')
    expect(automationTimeLabel(at(15, 9), NOW)).toBe('yesterday at 9:00')
    expect(automationTimeLabel(NOW, NOW)).toBe('in a moment')
  })

  it('puts a schedule into a sentence', () => {
    expect(automationScheduleInSentence({ kind: 'interval', minutes: 60 })).toBe('every hour')
    expect(automationScheduleInSentence({ kind: 'daily', time: 540, days: [1, 2, 3, 4, 5] })).toBe('weekdays at 9:00')
    expect(automationScheduleInSentence({ kind: 'daily', time: 540, days: [1, 3] })).toBe('on Mon and Wed at 9:00')
  })

  it('turns the form into a schedule and back, and says what is wrong with it', () => {
    expect(formSchedule(scheduleForm({ kind: 'interval', minutes: 90 }))).toEqual({ schedule: { kind: 'interval', minutes: 90 } })
    expect(scheduleForm({ kind: 'interval', minutes: 2880 })).toMatchObject({ kind: 'interval', amount: '2', unit: 'days' })
    expect(formSchedule(scheduleForm({ kind: 'daily', time: 545, days: [5, 1] }))).toEqual({ schedule: { kind: 'daily', time: 545, days: [1, 5] } })
    expect(formSchedule({ ...scheduleForm(null), kind: 'interval', amount: '2', unit: 'minutes' })).toEqual({ problem: 'The shortest is every 5 minutes.' })
    expect(formSchedule({ ...scheduleForm(null), kind: 'interval', amount: '', unit: 'hours' })).toEqual({ problem: 'Enter a whole number.' })
    expect(formSchedule({ ...scheduleForm(null), kind: 'interval', amount: '60', unit: 'days' })).toEqual({ problem: 'The longest is every 28 days.' })
    expect(formSchedule({ ...scheduleForm(null), time: '' })).toEqual({ problem: 'Enter a time of day.' })
    expect(formSchedule({ ...scheduleForm(null), days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ schedule: { kind: 'daily', time: 540 } })
  })

  it('has a toast for a thread an automation just started, and for no other', () => {
    expect(automationThreadToast(thread({ automationId: 'aut_one', createdAt: NOW }), NOW, { project: 'app' })).toMatchObject({ label: 'Automation started a thread', title: 'Check the build', detail: 'app' })
    expect(automationThreadToast(thread({ createdAt: NOW }), NOW)).toBeNull()
    expect(automationThreadToast(thread({ automationId: 'aut_one', createdAt: NOW - 60 * 60_000 }), NOW)).toBeNull()
  })
})

describe('making an automation on the New thread page', () => {
  it('starts a thread once unless a schedule is chosen', async () => {
    await render()
    expect(picker().textContent).toBe('Run once')
    expect(picker().hasAttribute('data-scheduled')).toBe(false)
    expect(q('[data-testid="inbox-automation-hint"]')).toBeNull()
    await setMessageText(messageInput(container), 'Check the build')
    await click('[data-testid="chat-send"]')
    expect(api.chat.create).toHaveBeenCalledWith(expect.objectContaining({ text: 'Check the build' }))
    expect(api.automations.save).not.toHaveBeenCalled()
  })

  it('saves an automation instead of starting a thread, clears the page, and says when it first runs', async () => {
    await render()
    await choose('automation-preset-daily')
    expect(picker().textContent).toBe('Every day at 9:00')
    expect(picker().hasAttribute('data-scheduled')).toBe(true)
    expect(text('[data-testid="inbox-automation-hint"]')).toBe('Sending saves an automation: a new thread starts every day at 9:00, first today at 9:00.')
    expect(text('h1')).toContain('What should run in')
    const send = q('[data-testid="chat-send"]')!
    expect(send.getAttribute('aria-label')).toBe('Schedule')
    await setMessageText(messageInput(container), 'Check the build')
    await click('[data-testid="chat-send"]')
    expect(api.chat.create).not.toHaveBeenCalled()
    expect(api.automations.save).toHaveBeenCalledWith({ folderId: folder.id, text: 'Check the build', agent: 'build', model, schedule: { kind: 'daily', time: 540 } })
    expect(api.chat.draft).toHaveBeenCalledWith({ key: 'draft:drf_page', action: 'clear' })
    expect(text('[data-testid="inbox-automation-saved"]')).toBe('Automation saved. It first runs today at 9:00. Show it')
    // The next page starts a thread once again.
    expect(useInboxDrafts.getState().page.id).not.toBe('drf_page')
    expect(picker().textContent).toBe('Run once')
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    api.automations.list.mockResolvedValue([automation({ id: 'aut_new', text: 'Check the build' })])
    await click('[data-testid="inbox-automation-saved-open"]')
    expect(q('[data-testid="automation-editor"]')).not.toBeNull()
  })

  it('goes back to running once', async () => {
    await render()
    await choose('automation-preset-1h')
    expect(picker().textContent).toBe('Every hour')
    await choose('automation-once')
    expect(picker().textContent).toBe('Run once')
    expect(text('h1')).toContain('What should we build in')
  })

  it('makes a schedule that is not a preset', async () => {
    await render()
    await choose('automation-custom')
    expect(q('[data-testid="automation-custom-dialog"]')).not.toBeNull()
    await click('[data-testid="automation-kind-interval"]')
    await type('[data-testid="automation-amount"]', '3')
    expect(text('[data-testid="automation-schedule-problem"]')).toBeUndefined()
    await click('[data-testid="automation-unit-minutes"]')
    expect(text('[data-testid="automation-schedule-problem"]')).toBe('The shortest is every 5 minutes.')
    expect(q<HTMLButtonElement>('[data-testid="automation-custom-apply"]')!.disabled).toBe(true)
    await click('[data-testid="automation-kind-daily"]')
    await click('[data-testid="automation-day-1"]')
    await click('[data-testid="automation-day-4"]')
    expect(text('[data-testid="automation-schedule-summary"]')).toBe('Mon and Thu at 9:00 · first run today at 9:00')
    await click('[data-testid="automation-custom-apply"]')
    expect(q('[data-testid="automation-custom-dialog"]')).toBeNull()
    expect(picker().textContent).toBe('Mon and Thu at 9:00')
    await setMessageText(messageInput(container), 'Plan the week')
    await click('[data-testid="chat-send"]')
    expect(api.automations.save).toHaveBeenCalledWith(expect.objectContaining({ schedule: { kind: 'daily', time: 540, days: [1, 4] } }))
  })

  it('refuses attached files, and keeps what was written', async () => {
    attachments = [{ id: 'att_1', name: 'shot.png', mime: 'image/png', size: 10 }]
    await render()
    await choose('automation-preset-1h')
    await setMessageText(messageInput(container), 'Look at this picture')
    await click('[data-testid="chat-send"]')
    expect(api.automations.save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('An automation cannot carry attached files.')
    expect(useInboxDrafts.getState().page.id).toBe('drf_page')
  })
})

describe('the automations dialog', () => {
  it('opens from the toolbar, empty at first', async () => {
    await render()
    const button = q('[data-testid="inbox-automations-button"]')!
    expect(button.getAttribute('aria-label')).toBe('Automations')
    await act(async () => button.click())
    expect(q('[data-testid="inbox-automations-empty"]')).not.toBeNull()
  })

  it('lists them with their schedule and next run, and follows what the main process says', async () => {
    api.automations.list.mockResolvedValue([automation(), automation({ id: 'aut_two', text: 'Tidy the branches', enabled: false, schedule: { kind: 'interval', minutes: 240 }, lastError: 'OpenCode is not running.' })])
    await render()
    expect(q('[data-testid="inbox-automations-button"]')!.getAttribute('aria-label')).toBe('Automations (1 on)')
    await click('[data-testid="inbox-automations-button"]')
    const rows = all('[data-testid="automation-row"]')
    expect(rows.map((row) => row.querySelector('[data-testid="automation-row-open"]')!.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Check the buildapp · Every day at 9:00 · Next run today at 9:00',
      'Tidy the branchesapp · Every 4 hours · Paused',
    ])
    expect(rows[1]!.querySelector('[data-testid="automation-error"]')!.textContent).toBe('OpenCode is not running.')
    expect(text('[data-testid="inbox-automations-count"]')).toContain('1 on, 1 paused')
    // The default permissions are not named; a chosen mode is, once the list brings one.
    expect(q('[data-testid="automation-permission"]')).toBeNull()
    await act(async () => listeners[0]!([automation({ permissionMode: 'read-only' })]))
    expect(text('[data-testid="automation-permission"]')).toBe('Read-only')
    expect(q('[data-testid="automation-row-open"]')!.textContent).toContain('Next run today at 9:00')
    // A run in the main process arrives as a new list.
    await act(async () => listeners[0]!([automation({ runs: 1, lastRunAt: NOW, lastThreadId: 'ses_one', nextRunAt: new Date(2026, 10, 17, 9, 0).getTime() })]))
    expect(all('[data-testid="automation-row"]')).toHaveLength(1)
    expect(text('[data-testid="automation-next"]')).toBe('Next run tomorrow at 9:00')
    expect(q('[data-testid="automation-row"]')!.textContent).toContain('Last run just now · 1 run')
  })

  it('pauses, runs now and opens the thread a run started', async () => {
    api.automations.list.mockResolvedValue([automation()])
    useWorkspace.setState({ inboxThreads: [thread()] })
    await render()
    await click('[data-testid="inbox-automations-button"]')
    await click('[data-testid="automation-enabled"]')
    expect(api.automations.setEnabled).toHaveBeenCalledWith({ id: 'aut_one', enabled: false })
    expect(text('[data-testid="automation-next"]')).toBe('Paused')
    await click('[data-testid="automation-run"]')
    expect(api.automations.run).toHaveBeenCalledWith({ id: 'aut_one' })
    await click('[data-testid="automation-open-thread-aut_one"]')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(q('[data-testid="inbox-automations"]')).toBeNull()
  })

  it('shows why a run could not be started', async () => {
    api.automations.list.mockResolvedValue([automation()])
    api.automations.run.mockRejectedValueOnce(new Error('OpenCode is not running.'))
    await render()
    await click('[data-testid="inbox-automations-button"]')
    await click('[data-testid="automation-run"]')
    expect(text('[data-testid="automation-error"]')).toContain('OpenCode is not running.')
  })

  it('edits the message and the schedule and keeps how it runs', async () => {
    api.automations.list.mockResolvedValue([automation({ mode: 'terminal', permissionMode: 'read-only', worktree: { base: 'main' } })])
    await render()
    await click('[data-testid="inbox-automations-button"]')
    await click('[data-testid="automation-edit"]')
    expect(text('[data-testid="automation-runs-with"]')).toBe('app · build · model-1 · Read-only · Terminal · new worktree from main')
    await type('[data-testid="automation-text"]', 'Check the build and the tests')
    await click('[data-testid="automation-days-weekdays"]')
    await click('[data-testid="automation-save"]')
    expect(api.automations.save).toHaveBeenCalledWith({
      id: 'aut_one', folderId: folder.id, text: 'Check the build and the tests', agent: 'build', model, mode: 'terminal', permissionMode: 'read-only', worktree: { base: 'main' },
      schedule: { kind: 'daily', time: 540, days: [1, 2, 3, 4, 5] },
    })
    // Back at the list.
    expect(q('[data-testid="automation-editor"]')).toBeNull()
    expect(q('[data-testid="inbox-automation-list"]')).not.toBeNull()
  })

  it('will not save an empty message', async () => {
    api.automations.list.mockResolvedValue([automation()])
    await render()
    await click('[data-testid="inbox-automations-button"]')
    await click('[data-testid="automation-row-open"]')
    await type('[data-testid="automation-text"]', '   ')
    expect(q<HTMLButtonElement>('[data-testid="automation-save"]')!.disabled).toBe(true)
  })

  it('deletes after asking', async () => {
    api.automations.list.mockResolvedValue([automation()])
    await render()
    await click('[data-testid="inbox-automations-button"]')
    await click('[data-testid="automation-remove"]')
    expect(api.automations.remove).not.toHaveBeenCalled()
    await click('[data-testid="automation-remove-confirm"]')
    expect(api.automations.remove).toHaveBeenCalledWith({ id: 'aut_one' })
    expect(q('[data-testid="inbox-automations-empty"]')).not.toBeNull()
  })
})

describe('a thread an automation started', () => {
  it('says so in its header and leads to the automation while it exists', async () => {
    api.automations.list.mockResolvedValue([automation()])
    useWorkspace.setState({ inboxThreads: [thread({ automationId: 'aut_one' })], selectedInboxThreadId: 'ses_one' })
    await render()
    const mark = q('[data-testid="inbox-started-by-automation"]')!
    expect(mark.textContent).toBe('Started by an automation')
    expect(mark.tagName).toBe('BUTTON')
    await act(async () => mark.click())
    expect(q('[data-testid="automation-editor"]')).not.toBeNull()
  })

  it('only says so once the automation is gone', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ automationId: 'aut_gone' })], selectedInboxThreadId: 'ses_one' })
    await render()
    expect(q('[data-testid="inbox-started-by-automation"]')!.tagName).toBe('SPAN')
  })
})
