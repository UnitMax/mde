// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatAsideEntry } from '../src/shared/types'
import { ASIDE_HISTORY_LIMIT, asideCount, resetAsideLoads, shownAside, useInboxAside } from '../src/renderer/store/inbox-aside'

type Answer = { text: string; entry: ChatAsideEntry }
let made = 0
const entry = (question: string, answer: string): ChatAsideEntry => ({ id: `aside_${made += 1}`, question, answer, askedAt: 1_000 + made })
const answered = (question: string, text: string): Answer => ({ text, entry: entry(question, text) })
const aside = vi.fn(async (request: { threadId: string; question: string }): Promise<Answer> => answered(request.question, 'An answer'))
const asideHistory = vi.fn(async (_request: { threadId: string }): Promise<ChatAsideEntry[]> => [])
const state = () => useInboxAside.getState()
const thread = (id = 'ses_one') => state().threads[id]
const shown = (id = 'ses_one') => shownAside(thread(id))

/** A question whose answer is held until the test lets it through, so that races can be staged. */
function held(question: string): { promise: Promise<Answer>; resolve: (text: string) => void; reject: (error: Error) => void } {
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Answer>((ok, fail) => { resolve = (text) => ok(answered(question, text)); reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  made = 0
  vi.stubGlobal('api', { chat: { aside, asideHistory } })
  aside.mockReset()
  aside.mockImplementation(async (request) => answered(request.question, 'An answer'))
  asideHistory.mockReset()
  asideHistory.mockResolvedValue([])
  resetAsideLoads()
  useInboxAside.setState({ threads: {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('side questions in the store', () => {
  it('shows the question as loading while the answer is on its way, then the answer, which joins the history', async () => {
    const pending = held('Why SQLite?')
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', '  Why SQLite?  ')
    expect(shown()).toMatchObject({ question: 'Why SQLite?', status: 'loading', answer: '', error: null })
    expect(aside).toHaveBeenCalledWith({ threadId: 'ses_one', question: 'Why SQLite?' })
    pending.resolve('**Because.**')
    await asking
    expect(shown()).toMatchObject({ id: 'aside_1', question: 'Why SQLite?', status: 'done', answer: '**Because.**', error: null, askedAt: 1_001 })
    expect(thread()).toMatchObject({ pending: null, at: 0 })
    expect(thread()!.history).toHaveLength(1)
  })

  it('turns a failure into the question\'s own error state, without the IPC wrapper, and does not reject or keep it', async () => {
    aside.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:aside': Error: The OpenCode service did not answer in time."))
    await expect(state().ask('ses_one', 'Why?')).resolves.toBeUndefined()
    expect(shown()).toMatchObject({ status: 'error', error: 'The OpenCode service did not answer in time.', answer: '' })
    expect(thread()!.history).toEqual([])
  })

  it('says something even when the failure has no message', async () => {
    aside.mockRejectedValueOnce(new Error(''))
    await state().ask('ses_one', 'Why?')
    expect(shown()?.error).toBe('Could not answer the question.')
  })

  it('asks nothing for a blank question', async () => {
    await state().ask('ses_one', ' \n ')
    expect(aside).not.toHaveBeenCalled()
    expect(state().threads).toEqual({})
  })

  it('keeps a separate history for each thread', async () => {
    await state().ask('ses_one', 'First?')
    await state().ask('ses_two', 'Second?')
    expect(shown('ses_one')).toMatchObject({ question: 'First?' })
    expect(shown('ses_two')).toMatchObject({ question: 'Second?' })
    expect(asideCount(thread('ses_one'))).toBe(1)
  })

  it('shows the next question in place of the one being asked, and keeps a late answer to the old one behind it', async () => {
    const first = held('First?')
    const second = held('Second?')
    aside.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const askingFirst = state().ask('ses_one', 'First?')
    const askingSecond = state().ask('ses_one', 'Second?')
    expect(shown()).toMatchObject({ question: 'Second?', status: 'loading' })
    second.resolve('The second answer')
    await askingSecond
    first.resolve('The first answer')
    await askingFirst
    // The card stays on the newer question; the older answer is there to step back to.
    expect(shown()).toMatchObject({ question: 'Second?', status: 'done', answer: 'The second answer' })
    expect(thread()!.history.map((kept) => kept.question).sort()).toEqual(['First?', 'Second?'])
  })

  it('does not let the failure of an old question spoil the new one', async () => {
    const first = held('First?')
    aside.mockReturnValueOnce(first.promise)
    const askingFirst = state().ask('ses_one', 'First?')
    await state().ask('ses_one', 'Second?')
    first.reject(new Error('late failure'))
    await askingFirst
    expect(shown()).toMatchObject({ question: 'Second?', status: 'done', error: null })
  })

  it('closes the card without forgetting: an answer that arrives after that is kept, and the card stays closed', async () => {
    const pending = held('Why?')
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', 'Why?')
    state().dismiss('ses_one')
    expect(shown()).toBeNull()
    expect(asideCount(thread())).toBe(1)
    pending.resolve('Worth keeping')
    await asking
    expect(shown()).toBeNull()
    expect(thread()!.history).toMatchObject([{ question: 'Why?', answer: 'Worth keeping' }])
    state().open('ses_one')
    expect(shown()).toMatchObject({ question: 'Why?', answer: 'Worth keeping', status: 'done' })
  })

  it('forgets a failed question when its card is closed, and one that fails after the card was closed', async () => {
    aside.mockRejectedValueOnce(new Error('offline'))
    await state().ask('ses_one', 'Why?')
    state().dismiss('ses_one')
    expect(asideCount(thread())).toBe(0)
    state().open('ses_one')
    expect(shown()).toBeNull()

    const pending = held('Again?')
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', 'Again?')
    state().dismiss('ses_one')
    pending.reject(new Error('offline'))
    await asking
    expect(asideCount(thread())).toBe(0)
  })

  it('closes only the thread it is asked about, and closing one that is not open changes nothing', async () => {
    await state().ask('ses_one', 'One?')
    await state().ask('ses_two', 'Two?')
    const before = state().threads
    state().dismiss('ses_unknown')
    expect(state().threads).toBe(before)
    state().dismiss('ses_one')
    expect(shown('ses_one')).toBeNull()
    expect(shown('ses_two')).toMatchObject({ question: 'Two?' })
    const closed = state().threads
    state().dismiss('ses_one')
    expect(state().threads).toBe(closed)
  })

  it('can ask the same question again after a failure, which starts it afresh', async () => {
    aside.mockRejectedValueOnce(new Error('offline'))
    await state().ask('ses_one', 'Why?')
    expect(shown()?.status).toBe('error')
    await state().ask('ses_one', 'Why?')
    expect(shown()).toMatchObject({ status: 'done', answer: 'An answer', error: null })
    expect(asideCount(thread())).toBe(1)
  })

  it('steps back and forth through the history and stops at its ends', async () => {
    await state().ask('ses_one', 'One?')
    await state().ask('ses_one', 'Two?')
    await state().ask('ses_one', 'Three?')
    expect(thread()!.at).toBe(2)
    state().step('ses_one', -1)
    expect(shown()).toMatchObject({ question: 'Two?' })
    state().step('ses_one', -1)
    state().step('ses_one', -1)
    expect(shown()).toMatchObject({ question: 'One?' })
    state().step('ses_one', 5)
    expect(shown()).toMatchObject({ question: 'Three?' })
    state().dismiss('ses_one')
    state().step('ses_one', -1)
    expect(shown()).toBeNull()
  })

  it('leaves the card on an earlier question when the answer to a new one arrives', async () => {
    await state().ask('ses_one', 'One?')
    const pending = held('Two?')
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', 'Two?')
    state().step('ses_one', -1)
    pending.resolve('Second answer')
    await asking
    expect(shown()).toMatchObject({ question: 'One?' })
    expect(asideCount(thread())).toBe(2)
  })

  it('keeps only the newest answers, and the card stays on the one it shows', async () => {
    for (let index = 0; index < ASIDE_HISTORY_LIMIT + 2; index += 1) await state().ask('ses_one', `Question ${index}?`)
    expect(thread()!.history).toHaveLength(ASIDE_HISTORY_LIMIT)
    expect(thread()!.history[0]!.question).toBe('Question 2?')
    expect(shown()).toMatchObject({ question: `Question ${ASIDE_HISTORY_LIMIT + 1}?` })
  })

  it('reads a thread\'s kept history once, without opening the card', async () => {
    asideHistory.mockResolvedValueOnce([entry('Old?', 'Old answer'), entry('Older still?', 'Yes')])
    await state().load('ses_one')
    await state().load('ses_one')
    expect(asideHistory).toHaveBeenCalledOnce()
    expect(asideHistory).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(shown()).toBeNull()
    expect(asideCount(thread())).toBe(2)
    state().open('ses_one')
    expect(shown()).toMatchObject({ question: 'Older still?' })
  })

  it('puts what was answered while the history was being read after it, and tries a failed read again', async () => {
    let finish!: (entries: ChatAsideEntry[]) => void
    asideHistory.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const loading = state().load('ses_one')
    await state().ask('ses_one', 'New?')
    finish([entry('Old?', 'Old answer')])
    await loading
    expect(thread()!.history.map((kept) => kept.question)).toEqual(['Old?', 'New?'])
    expect(shown()).toMatchObject({ question: 'New?' })

    asideHistory.mockRejectedValueOnce(new Error('offline'))
    await state().load('ses_two')
    asideHistory.mockResolvedValueOnce([entry('Kept?', 'Yes')])
    await state().load('ses_two')
    expect(asideCount(thread('ses_two'))).toBe(1)
  })
})
