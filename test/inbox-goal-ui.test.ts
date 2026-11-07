// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatGoal, ChatGoalRequest, ChatMessage, ChatMessagesPage, ChatOptions, ChatRequests, InboxFolder, InboxThread } from '../src/shared/types'
import { GOAL_REVIEW_DELAY_MS, GOAL_WAIT_DELAY_MS } from '../src/renderer/components/inbox/ChatGoalCard'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxAside } from '../src/renderer/store/inbox-aside'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }

function thread(id = 'ses_one'): InboxThread {
  return {
    id, title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model, status: 'idle',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: 'Fixed it.' }] },
]

const goal = (patch: Partial<ChatGoal> = {}): ChatGoal => ({
  id: 'goal-1', objective: 'Make every test in the repository pass', status: 'active', rounds: 0, maxRounds: 50, updatedAt: 1_793_000_000_000, ...patch,
})

let page: ChatMessagesPage
let current: ChatGoal | null
let requests: ChatRequests
const setGoal = vi.fn(async (_request: ChatGoalRequest): Promise<void> => undefined)
const readGoal = vi.fn(async (_request: { threadId: string }): Promise<ChatGoal | null> => current)
const send = vi.fn(async (_request: unknown) => null)
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(async (): Promise<ChatOptions> => ({ agents: [{ id: 'build', name: 'build' }], models: [], defaultModel: model, defaultAgent: 'build', skills: [] })),
    messages: vi.fn(async (): Promise<ChatMessagesPage> => page),
    send,
    interrupt: vi.fn(async () => undefined),
    goal: readGoal,
    setGoal,
    mcp: vi.fn(async () => ({ servers: [] })),
    requests: vi.fn(async () => requests),
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
  await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-transcript"]')).not.toBeNull())
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
  return container
}

const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const text = (id: string): string => byId(id)?.textContent ?? ''
const card = (): HTMLElement | null => byId('chat-goal')
const click = (id: string) => act(async () => { byId(id)!.click() })
/** Tells the store what the service's event stream would. */
const tell = (next: ChatGoal | null) => act(async () => { useInboxChat.getState().applyEvent({ type: 'goal', threadId: 'ses_one', goal: next }) })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  setGoal.mockClear()
  readGoal.mockClear()
  send.mockClear()
  current = null
  requests = { permissions: [], forms: [] }
  page = { messages: conversation, older: null, running: false, pending: [] }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
  useInboxAside.setState({ asides: {} })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the goal card', () => {
  // A goal that is going has an agent that is working on it.
  beforeEach(() => {
    page = { messages: [conversation[0]!], older: null, running: true, pending: [] }
  })

  it('is not there when the thread has no goal, and appears when one is set', async () => {
    await render()
    expect(readGoal).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(card()).toBeNull()
    await tell(goal())
    expect(card()).not.toBeNull()
    await tell(null)
    expect(card()).toBeNull()
  })

  it('shows the goal OpenCode already has when the thread is opened, directly above the box and outside the conversation', async () => {
    current = goal({ rounds: 3, reason: 'The typecheck still fails.' })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    const section = card()!
    expect(section.getAttribute('role')).toBe('region')
    expect(section.getAttribute('aria-label')).toBe('Goal')
    expect(section.dataset.status).toBe('active')
    expect(text('chat-goal-objective')).toBe('Make every test in the repository pass')
    expect(text('chat-goal-status')).toBe('Working toward the goal')
    expect(text('chat-goal-round')).toBe('Round 4')
    expect(byId('chat-goal-round')!.title).toBe('3 of 50 follow-up rounds used. OpenCode pauses the goal when they run out.')
    expect(text('chat-goal-reason')).toBe('Last checkThe typecheck still fails.')
    expect(section.parentElement!.contains(byId('chat-composer'))).toBe(true)
    expect(byId('chat-transcript')!.contains(section)).toBe(false)
  })

  it('offers Pause and Clear while the goal runs, and nothing to resume', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    expect(byId('chat-goal-pause')?.textContent).toContain('Pause')
    expect(byId('chat-goal-clear')?.getAttribute('aria-label')).toBe('Clear goal')
    expect(byId('chat-goal-resume')).toBeNull()
    expect(byId('chat-goal-sweep')).not.toBeNull()
  })

  it('follows the goal as the service reports it: paused, then resumed, then met, then dismissed', async () => {
    current = goal({ rounds: 2 })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())

    await tell(goal({ rounds: 2, status: 'paused', reason: 'Paused by the user' }))
    expect(card()!.dataset.status).toBe('paused')
    expect(text('chat-goal-status')).toBe('Paused by you')
    expect(text('chat-goal-round')).toBe('Stopped in round 3')
    // The person knows they paused it: no reason is repeated back.
    expect(byId('chat-goal-reason')).toBeNull()
    expect(byId('chat-goal-resume')?.textContent).toContain('Resume')
    expect(byId('chat-goal-pause')).toBeNull()
    expect(byId('chat-goal-sweep')).toBeNull()

    await tell(goal({ rounds: 5, status: 'paused', reason: 'Reached the limit of 50 rounds' }))
    expect(text('chat-goal-status')).toBe('Paused')
    expect(text('chat-goal-reason')).toBe('WhyReached the limit of 50 rounds')

    await tell(goal({ rounds: 2, status: 'active' }))
    expect(text('chat-goal-status')).toBe('Working toward the goal')
    expect(byId('chat-goal-resume')).toBeNull()

    await tell(goal({ rounds: 2, status: 'complete', reason: 'All 12 tests pass in the last run.' }))
    expect(card()!.dataset.status).toBe('complete')
    expect(text('chat-goal-status')).toBe('Goal met')
    expect(text('chat-goal-round')).toBe('Met in 3 rounds')
    expect(text('chat-goal-reason')).toBe('EvidenceAll 12 tests pass in the last run.')
    expect(byId('chat-goal-clear')?.textContent).toContain('Dismiss')
    expect(byId('chat-goal-pause')).toBeNull()
  })

  it('says "in 1 round" for a goal met at once', async () => {
    current = goal({ status: 'complete', rounds: 0 })
    await render()
    await vi.waitFor(() => expect(text('chat-goal-round')).toBe('Met in 1 round'))
  })

  it('asks OpenCode to pause, resume and clear, and is busy until it has answered', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    let release!: () => void
    setGoal.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    await click('chat-goal-pause')
    expect(setGoal).toHaveBeenCalledExactlyOnceWith({ threadId: 'ses_one', action: 'pause' })
    // One request at a time: both buttons wait.
    expect((byId('chat-goal-pause') as HTMLButtonElement).disabled).toBe(true)
    expect((byId('chat-goal-clear') as HTMLButtonElement).disabled).toBe(true)
    await click('chat-goal-pause')
    expect(setGoal).toHaveBeenCalledOnce()
    await act(async () => release())
    expect((byId('chat-goal-pause') as HTMLButtonElement).disabled).toBe(false)

    await tell(goal({ status: 'paused', reason: 'Paused by the user' }))
    await click('chat-goal-resume')
    expect(setGoal).toHaveBeenLastCalledWith({ threadId: 'ses_one', action: 'resume' })
    await click('chat-goal-clear')
    expect(setGoal).toHaveBeenLastCalledWith({ threadId: 'ses_one', action: 'clear' })
  })

  it('shows OpenCode’s reason on the card when it refuses, and clears it on the next try', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    setGoal.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:goal-set': Error: No active goal to pause."))
    await click('chat-goal-pause')
    expect(byId('chat-goal-error')?.getAttribute('role')).toBe('alert')
    expect(text('chat-goal-error')).toBe('No active goal to pause.')
    await click('chat-goal-pause')
    expect(byId('chat-goal-error')).toBeNull()
  })

  it('keeps a click on the card from taking the caret out of the message box', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    for (const id of ['chat-goal-pause', 'chat-goal-clear']) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      byId(id)!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('shows a long objective in three lines and opens it in full on request', async () => {
    const long = `Port the settings screen to the new form library.\n${'Keep every existing behavior and test. '.repeat(8)}`
    current = goal({ objective: long })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    const objective = byId('chat-goal-objective')!
    expect(objective.className).toContain('line-clamp-3')
    expect(byId('chat-goal-toggle')?.textContent).toBe('Show all')
    expect(byId('chat-goal-toggle')?.getAttribute('aria-expanded')).toBe('false')
    await click('chat-goal-toggle')
    expect(byId('chat-goal-objective')!.className).not.toContain('line-clamp-3')
    expect(byId('chat-goal-toggle')?.textContent).toBe('Show less')
    expect(byId('chat-goal-objective')!.textContent).toBe(long)
    await click('chat-goal-toggle')
    expect(byId('chat-goal-objective')!.className).toContain('line-clamp-3')
  })

  it('offers no toggle for a short objective', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    expect(byId('chat-goal-toggle')).toBeNull()
  })

  it('warns when the agent made no progress, and when only a few rounds are left', async () => {
    current = goal({ rounds: 46, stalls: 1 })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    expect(text('chat-goal-stalled')).toContain('No progress in the last round')
    expect(text('chat-goal-limit')).toBe('4 rounds left before OpenCode pauses the goal.')
    await tell(goal({ rounds: 49, stalls: 0 }))
    expect(byId('chat-goal-stalled')).toBeNull()
    expect(text('chat-goal-limit')).toBe('1 round left before OpenCode pauses the goal.')
    await tell(goal({ rounds: 20, stalls: 1, status: 'paused', reason: 'Not making progress: nothing changed' }))
    // Warnings belong to a goal that is going; a paused one says why in its own words.
    expect(byId('chat-goal-stalled')).toBeNull()
    expect(byId('chat-goal-limit')).toBeNull()
  })

  it('tells the person that the agent is finishing a step when a goal paused while it was busy', async () => {
    current = goal({ status: 'paused', reason: 'Paused by the user' })
    page = { ...page, running: true }
    await render()
    await vi.waitFor(() => expect(byId('chat-goal-finishing')).not.toBeNull())
    expect(text('chat-goal-finishing')).toContain('finishing its current step')
    await tell(goal({ status: 'complete' }))
    expect(byId('chat-goal-finishing')).toBeNull()
  })

  it('belongs to the goal: another goal in the same thread starts from a clean card', async () => {
    current = goal({ objective: 'First' })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    setGoal.mockRejectedValueOnce(new Error('No active goal to pause.'))
    await click('chat-goal-pause')
    expect(byId('chat-goal-error')).not.toBeNull()
    await tell(goal({ id: 'goal-2', objective: 'Second' }))
    expect(text('chat-goal-objective')).toBe('Second')
    expect(byId('chat-goal-error')).toBeNull()
  })
})

describe('what the goal is doing, as the card says it', () => {
  it('says the agent is working while a step goes, then that the reviewer is checking, once that has lasted a moment', async () => {
    current = goal()
    page = { messages: conversation, older: null, running: true, pending: [] }
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    // The last step is done and the thread is still busy: the reviewer reads the conversation. Not for a blink, though.
    expect(card()!.dataset.phase).toBe('working')
    expect(text('chat-goal-status')).toBe('Working toward the goal')
    await vi.waitFor(() => expect(card()!.dataset.phase).toBe('reviewing'), { timeout: GOAL_REVIEW_DELAY_MS * 4 })
    expect(text('chat-goal-status')).toBe('Checking whether the goal is met…')
    expect(byId('chat-goal-sweep')).not.toBeNull()
  })

  it('goes back to working as soon as a new step starts', async () => {
    current = goal()
    page = { messages: conversation, older: null, running: true, pending: [] }
    await render()
    await vi.waitFor(() => expect(card()!.dataset.phase).toBe('reviewing'), { timeout: GOAL_REVIEW_DELAY_MS * 4 })
    page = {
      ...page,
      messages: [...conversation, { kind: 'assistant', id: 'msg_3', time: 3, agent: 'build', model, completed: false, parts: [] }],
    }
    await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
    await vi.waitFor(() => expect(card()!.dataset.phase).toBe('working'))
  })

  it('says the agent waits for an answer when a permission or a question is open', async () => {
    current = goal()
    page = { messages: conversation, older: null, running: true, pending: [] }
    requests = { permissions: [{ id: 'per_1', action: 'bash', resources: ['npm test'] }], forms: [] }
    await render()
    await vi.waitFor(() => expect(card()!.dataset.phase).toBe('attention'))
    expect(text('chat-goal-status')).toBe('Waiting for your answer')
  })

  it('says it waits for background work when nothing has run for a while, and not before', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    // Just opened, or just set: the thread has not said it is running yet, which is not waiting.
    expect(card()!.dataset.phase).toBe('working')
    expect(text('chat-goal-status')).toBe('Working toward the goal')
    await vi.waitFor(() => expect(card()!.dataset.phase).toBe('waiting'), { timeout: GOAL_WAIT_DELAY_MS * 3 })
    expect(text('chat-goal-status')).toBe('Waiting for background work')
    expect(byId('chat-goal-sweep')).toBeNull()
  })

  it('does not say it waits when the thread starts running before the moment is up', async () => {
    current = goal()
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    // The service says so, in its events and in the next read.
    page = { ...page, running: true }
    await act(async () => { useInboxChat.getState().applyEvent({ type: 'running', threadId: 'ses_one', running: true }) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, GOAL_WAIT_DELAY_MS + 200)) })
    // Busy with a finished step is the reviewer's turn; either way it is not waiting.
    expect(card()!.dataset.phase).not.toBe('waiting')
  })
})

describe('/goal in the message box', () => {
  it('starts a goal with the effort selected for the same model', async () => {
    const defaults = await api.chat.options()
    api.chat.options.mockResolvedValue({ ...defaults, models: [{ ...model, name: 'Reasoner', providerName: 'OpenCode', variants: ['high'] }] })
    try {
      const container = await render()
      await vi.waitFor(() => expect(byId('chat-model-picker')).not.toBeNull())
      await act(async () => byId('chat-model-picker')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      const high = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((item) => item.textContent === 'High')!
      await act(async () => high.click())
      await submit(container, '/goal finish the migration')
      expect(setGoal).toHaveBeenCalledExactlyOnceWith({ threadId: 'ses_one', action: 'set', objective: 'finish the migration', model: { ...model, variant: 'high' } })
    } finally {
      api.chat.options.mockResolvedValue(defaults)
    }
  })

  /** Types a message into the box and presses Enter. */
  async function submit(container: HTMLElement, value: string): Promise<void> {
    const box = messageInput(container)
    await setMessageText(box, value)
    await pressMessageKey(box, 'Enter')
  }

  it('sets the goal from the objective, sends nothing to the agent as a message, and empties the box', async () => {
    const container = await render()
    await submit(container, '/goal make every test pass')
    expect(setGoal).toHaveBeenCalledExactlyOnceWith({ threadId: 'ses_one', action: 'set', objective: 'make every test pass' })
    expect(send).not.toHaveBeenCalled()
    expect(messageInput(container).state.doc.toString()).toBe('')
  })

  it('pauses, resumes and clears with the words after it', async () => {
    const container = await render()
    for (const action of ['pause', 'resume', 'clear']) {
      await submit(container, `/goal ${action}`)
      expect(setGoal).toHaveBeenLastCalledWith({ threadId: 'ses_one', action })
    }
    expect(setGoal).toHaveBeenCalledTimes(3)
  })

  it('shows OpenCode’s reason under the box and gives the text back when it refuses', async () => {
    setGoal.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:goal-set': Error: No active goal to pause."))
    const container = await render()
    await submit(container, '/goal pause')
    await vi.waitFor(() => expect(container.textContent).toContain('No active goal to pause.'))
    expect(messageInput(container).state.doc.toString()).toBe('/goal pause')
  })

  it('asks for an objective when there is none, and does not ask OpenCode', async () => {
    const container = await render()
    const box = messageInput(container)
    await setMessageText(box, '/goal ')
    await pressMessageKey(box, 'Enter')
    await vi.waitFor(() => expect(container.textContent).toContain('Add an objective after /goal.'))
    expect(setGoal).not.toHaveBeenCalled()
    expect(box.state.doc.toString()).toBe('/goal ')
  })

  it('refuses an objective that OpenCode would read as an action, quoted or not, before asking', async () => {
    const container = await render()
    // `/goal "pause"` is the action to OpenCode too, so it is run as one; the objective check is for text this cannot reach.
    await submit(container, '/goal pause')
    expect(setGoal).toHaveBeenLastCalledWith({ threadId: 'ses_one', action: 'pause' })
    await submit(container, `/goal ${'x'.repeat(4001)}`)
    await vi.waitFor(() => expect(container.textContent).toContain('A goal can be at most 4,000 characters'))
    expect(setGoal).toHaveBeenCalledOnce()
  })

  it('is listed with the other commands, with its objective hint', async () => {
    const container = await render()
    await setMessageText(messageInput(container), '/go')
    const options = Array.from(container.querySelectorAll('[data-testid="slash-picker"] [role="option"]'))
    expect(options.map((option) => option.getAttribute('data-testid'))).toEqual(['slash-option-goal'])
    expect(options[0]!.textContent).toContain('/goal')
    expect(options[0]!.textContent).toContain('an objective')
  })

  it('works while the agent is busy, as a command and not as a steering message', async () => {
    page = { ...page, running: true }
    const container = await render()
    await setMessageText(messageInput(container), '/goal finish the migration')
    expect(byId('chat-send-pill')).toBeNull()
    expect((byId('chat-send') as HTMLElement).dataset.command).toBe('goal')
    await pressMessageKey(messageInput(container), 'Enter')
    expect(setGoal).toHaveBeenCalledWith({ threadId: 'ses_one', action: 'set', objective: 'finish the migration' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the goal in the chat store', () => {
  it('ignores an old read that finishes after a newer event', async () => {
    let finish!: (value: ChatGoal | null) => void
    readGoal.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await render()
    await tell(goal({ rounds: 4 }))
    await act(async () => finish(goal({ rounds: 1 })))
    expect(useInboxChat.getState().threads.ses_one?.goal?.rounds).toBe(4)
  })

  it('keeps the goal on screen when a read fails, and reads it again when the connection comes back', async () => {
    current = goal({ rounds: 1 })
    await render()
    await vi.waitFor(() => expect(card()).not.toBeNull())
    readGoal.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await useInboxChat.getState().refreshGoal('ses_one') })
    expect(card()).not.toBeNull()
    current = goal({ rounds: 7 })
    await act(async () => { useInboxChat.getState().applyEvent({ type: 'reconnected', threadId: 'ses_one' }) })
    await vi.waitFor(() => expect(text('chat-goal-round')).toBe('Round 8'))
  })

  it('does not hold a goal for a thread it does not hold', async () => {
    await render()
    useInboxChat.getState().applyEvent({ type: 'goal', threadId: 'ses_elsewhere', goal: goal() })
    expect(useInboxChat.getState().threads.ses_elsewhere).toBeUndefined()
  })

  it('remembers the agent and model a goal was set with, as a message does, and starts the thread running', async () => {
    await render()
    const other = { id: 'free-2', providerId: 'opencode' }
    await act(async () => { await useInboxChat.getState().setGoal('ses_one', { action: 'set', objective: 'Ship it', agent: 'plan', model: other }) })
    expect(useInboxChat.getState().composer).toMatchObject({ agent: 'plan', model: other })
    expect(useInboxChat.getState().threads.ses_one?.running).toBe(true)
    expect(setGoal).toHaveBeenCalledWith({ threadId: 'ses_one', action: 'set', objective: 'Ship it', agent: 'plan', model: other })
  })

  it('does not mark the thread running for a pause or a clear', async () => {
    await render()
    await act(async () => { await useInboxChat.getState().setGoal('ses_one', { action: 'pause' }) })
    expect(useInboxChat.getState().threads.ses_one?.running).toBe(false)
  })
})
