// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInboxAside } from '../src/renderer/store/inbox-aside'

type Answer = { text: string }
const aside = vi.fn(async (_request: { threadId: string; question: string }): Promise<Answer> => ({ text: 'An answer' }))
const state = () => useInboxAside.getState()

/** A question whose answer is held until the test lets it through, so that races can be staged. */
function held(): { promise: Promise<Answer>; resolve: (answer: Answer) => void; reject: (error: Error) => void } {
  let resolve!: (answer: Answer) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Answer>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.stubGlobal('api', { chat: { aside } })
  aside.mockReset()
  aside.mockResolvedValue({ text: 'An answer' })
  useInboxAside.setState({ asides: {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('side questions in the store', () => {
  it('shows the question as loading while the answer is on its way, then the answer', async () => {
    const pending = held()
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', '  Why SQLite?  ')
    expect(state().asides.ses_one).toMatchObject({ question: 'Why SQLite?', status: 'loading', answer: '', error: null })
    expect(aside).toHaveBeenCalledWith({ threadId: 'ses_one', question: 'Why SQLite?' })
    pending.resolve({ text: '**Because.**' })
    await asking
    expect(state().asides.ses_one).toMatchObject({ question: 'Why SQLite?', status: 'done', answer: '**Because.**', error: null })
  })

  it('turns a failure into the question\'s own error state, without the IPC wrapper, and does not reject', async () => {
    aside.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:aside': Error: The OpenCode service did not answer in time."))
    await expect(state().ask('ses_one', 'Why?')).resolves.toBeUndefined()
    expect(state().asides.ses_one).toMatchObject({ status: 'error', error: 'The OpenCode service did not answer in time.', answer: '' })
  })

  it('says something even when the failure has no message', async () => {
    aside.mockRejectedValueOnce(new Error(''))
    await state().ask('ses_one', 'Why?')
    expect(state().asides.ses_one?.error).toBe('Could not answer the question.')
  })

  it('asks nothing for a blank question', async () => {
    await state().ask('ses_one', ' \n ')
    expect(aside).not.toHaveBeenCalled()
    expect(state().asides).toEqual({})
  })

  it('keeps a separate question for each thread', async () => {
    await state().ask('ses_one', 'First?')
    aside.mockResolvedValueOnce({ text: 'Second answer' })
    await state().ask('ses_two', 'Second?')
    expect(state().asides.ses_one).toMatchObject({ question: 'First?', answer: 'An answer' })
    expect(state().asides.ses_two).toMatchObject({ question: 'Second?', answer: 'Second answer' })
  })

  it('replaces a thread\'s question with the next one, and a late answer to the old one is not shown as the new one\'s', async () => {
    const first = held()
    const second = held()
    aside.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const askingFirst = state().ask('ses_one', 'First?')
    const askingSecond = state().ask('ses_one', 'Second?')
    expect(state().asides.ses_one).toMatchObject({ question: 'Second?', status: 'loading' })
    second.resolve({ text: 'The second answer' })
    await askingSecond
    // The first answer comes in after the second and must not overwrite it.
    first.resolve({ text: 'The first answer' })
    await askingFirst
    expect(state().asides.ses_one).toMatchObject({ question: 'Second?', status: 'done', answer: 'The second answer' })
  })

  it('does not let the failure of an old question spoil the new one', async () => {
    const first = held()
    aside.mockReturnValueOnce(first.promise)
    const askingFirst = state().ask('ses_one', 'First?')
    await state().ask('ses_one', 'Second?')
    first.reject(new Error('late failure'))
    await askingFirst
    expect(state().asides.ses_one).toMatchObject({ question: 'Second?', status: 'done', error: null })
  })

  it('closes a question, and the answer that arrives after that is dropped', async () => {
    const pending = held()
    aside.mockReturnValueOnce(pending.promise)
    const asking = state().ask('ses_one', 'Why?')
    state().dismiss('ses_one')
    expect(state().asides).toEqual({})
    pending.resolve({ text: 'Too late' })
    await asking
    expect(state().asides).toEqual({})
  })

  it('closes only the thread it is asked about, and closing one that is not there changes nothing', async () => {
    await state().ask('ses_one', 'One?')
    await state().ask('ses_two', 'Two?')
    const before = state().asides
    state().dismiss('ses_unknown')
    expect(state().asides).toBe(before)
    state().dismiss('ses_one')
    expect(Object.keys(state().asides)).toEqual(['ses_two'])
  })

  it('can ask the same question again after a failure, which starts it afresh', async () => {
    aside.mockRejectedValueOnce(new Error('offline'))
    await state().ask('ses_one', 'Why?')
    expect(state().asides.ses_one?.status).toBe('error')
    await state().ask('ses_one', 'Why?')
    expect(state().asides.ses_one).toMatchObject({ status: 'done', answer: 'An answer', error: null })
  })
})
