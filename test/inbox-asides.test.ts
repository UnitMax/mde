import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASIDE_ANSWER_LIMIT, ASIDE_HISTORY_LIMIT, InboxAsideHistory, parseAsideHistory } from '../src/main/inbox/asides'

let directory: string
let file: string
const onDisk = async (): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mde-asides-'))
  file = join(directory, 'inbox-asides.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('the side question history', () => {
  it('keeps answered questions per thread, oldest first, across a restart', async () => {
    let clock = 100
    const history = new InboxAsideHistory(file, () => true, () => clock++)
    expect(await history.list('ses_one')).toEqual([])
    const first = await history.add('ses_one', 'Why?', 'Because.')
    await history.add('ses_one', 'And then?', 'Nothing.')
    await history.add('ses_two', 'Other?', 'Yes.')
    expect(first).toMatchObject({ question: 'Why?', answer: 'Because.', askedAt: 100 })
    expect(first.id).toBeTruthy()
    await history.flush()

    const again = new InboxAsideHistory(file)
    expect((await again.list('ses_one')).map((entry) => entry.question)).toEqual(['Why?', 'And then?'])
    expect(await again.list('ses_two')).toHaveLength(1)
    expect((await again.list('ses_one'))[0]).toEqual(first)
  })

  it('keeps only the newest of a thread, and cuts a runaway answer short', async () => {
    const history = new InboxAsideHistory(file)
    for (let index = 0; index < ASIDE_HISTORY_LIMIT + 3; index += 1) await history.add('ses_one', `Question ${index}?`, 'x'.repeat(index === 5 ? ASIDE_ANSWER_LIMIT + 10 : 1))
    const kept = await history.list('ses_one')
    expect(kept).toHaveLength(ASIDE_HISTORY_LIMIT)
    expect(kept[0]!.question).toBe('Question 3?')
    expect(kept.find((entry) => entry.question === 'Question 5?')!.answer).toHaveLength(ASIDE_ANSWER_LIMIT)
  })

  it('forgets a thread\'s questions with the thread, and leaves the others', async () => {
    const history = new InboxAsideHistory(file)
    await history.add('ses_one', 'Why?', 'Because.')
    await history.add('ses_two', 'Other?', 'Yes.')
    await history.remove('ses_one')
    await history.remove('ses_unknown')
    expect(await history.list('ses_one')).toEqual([])
    expect(await onDisk()).toMatchObject({ version: 1, threads: { ses_two: [{ question: 'Other?' }] } })
    expect((await onDisk() as { threads: object }).threads).not.toHaveProperty('ses_one')
  })

  it('drops the history of threads that no longer exist when the file is read', async () => {
    const before = new InboxAsideHistory(file)
    await before.add('ses_gone', 'Why?', 'Because.')
    await before.add('ses_here', 'Other?', 'Yes.')
    await before.flush()
    const history = new InboxAsideHistory(file, (threadId) => threadId === 'ses_here')
    expect(await history.list('ses_gone')).toEqual([])
    expect(await history.list('ses_here')).toHaveLength(1)
    await history.flush()
    expect(Object.keys((await onDisk() as { threads: object }).threads)).toEqual(['ses_here'])
  })

  it('starts empty from a file it cannot understand, and leaves out malformed entries', async () => {
    await writeFile(file, '{ not json')
    expect(await new InboxAsideHistory(file).list('ses_one')).toEqual([])
    expect(parseAsideHistory('[]')).toEqual({})
    expect(parseAsideHistory(JSON.stringify({ version: 1, threads: { ses_one: 'no', ses_two: [{ id: 'a', question: 'Q', answer: 'A', askedAt: 1 }, { id: '', question: 'Q', answer: 'A', askedAt: 1 }, { id: 'b', question: 1, answer: 'A', askedAt: 1 }, null], ses_three: [] } })))
      .toEqual({ ses_two: [{ id: 'a', question: 'Q', answer: 'A', askedAt: 1 }] })
  })

  it('does not fail a question when the file cannot be written, and says so once without the path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // A directory where the file should be: every write fails.
    const history = new InboxAsideHistory(directory)
    await expect(history.add('ses_one', 'Why?', 'Because.')).resolves.toMatchObject({ question: 'Why?' })
    await history.add('ses_one', 'Again?', 'Yes.')
    await history.flush()
    expect(await history.list('ses_one')).toHaveLength(2)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).not.toContain(directory)
  })
})
