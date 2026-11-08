import { describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { InboxSearch, SEARCH_HITS_PER_THREAD, SEARCH_MAX_RESULTS, snippet } from '../src/main/inbox/search'
import type { ServiceOperation, ServiceRequest } from '../src/main/opencode/service/client'

const wsl = { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }
const model = { id: 'model-1', providerID: 'provider-1' }

function thread(id: string, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id, title: id, directory: '/home/me/app', target: wsl, branch: null, status: 'idle', createdAt: 1, lastActivityAt: 1_000,
    readAt: 1_000, archived: false, folderId: 'fld_app', ...overrides,
  }
}

const user = (id: string, text: string, created = 1) => ({ id, type: 'user', text, time: { created } })
const agent = (id: string, ...texts: string[]) => ({
  id, type: 'assistant', agent: 'build', model, time: { created: 2 },
  content: texts.map((text) => ({ type: 'text', text })),
})
const tool = { type: 'tool', id: 'call_1', name: 'shell', state: { status: 'completed', input: { command: 'needle in a command' }, output: 'needle in output' } }

type Handler = (thread: string, request: ServiceRequest) => unknown

function setup(threads: InboxThread[], handler: Handler) {
  let now = 10_000
  const list = [...threads]
  const request = vi.fn(async (_target: unknown, operation: ServiceOperation, req: ServiceRequest = {}) => {
    if (operation !== 'session.message.list') throw new Error(`unexpected ${operation}`)
    const result = handler(String(req.params?.sessionID), req)
    if (result instanceof Error) throw result
    return result
  })
  const search = new InboxSearch({ client: { request }, store: { list: () => list }, enabled: () => true, now: () => now })
  const settle = async (query = ''): Promise<ReturnType<InboxSearch['search']>> => {
    let answer = search.search({ query })
    for (let tries = 0; answer.indexed < answer.total && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      answer = search.search({ query })
    }
    return answer
  }
  return { search, settle, request, list, advance: (ms: number) => { now += ms } }
}

describe('snippet', () => {
  it('cuts the text around the match and says where it was cut', () => {
    const text = `${'a'.repeat(100)} needle ${'b'.repeat(200)}`
    const cut = snippet(text, 101, 6)
    expect(cut.match).toBe('needle')
    expect(cut.before.startsWith('…')).toBe(true)
    expect(cut.after.endsWith('…')).toBe(true)
    expect(cut.before.length).toBeLessThan(60)
    expect(cut.after.length).toBeLessThan(110)
  })

  it('keeps a short text whole and folds line breaks into spaces', () => {
    expect(snippet('first line\nthe needle\n\nlast', 15, 6)).toEqual({ before: 'first line the ', match: 'needle', after: ' last' })
  })
})

describe('InboxSearch', () => {
  it('finds what the person and the agent wrote, ignoring case, and not the tool calls', async () => {
    const { settle } = setup([thread('ses_a')], () => ({ data: [agent('msg_3', 'The NEEDLE is fixed.'), { ...agent('msg_2'), content: [tool] }, user('msg_1', 'Find the needle')] }))
    const answer = await settle('needle')
    expect(answer.results).toHaveLength(1)
    expect(answer.results[0]).toMatchObject({ threadId: 'ses_a', hitCount: 2 })
    // Newest first.
    expect(answer.results[0]!.hits.map((hit) => [hit.messageId, hit.role, hit.match])).toEqual([['msg_3', 'assistant', 'NEEDLE'], ['msg_1', 'user', 'needle']])
  })

  it('lists the threads with the most recent activity first and leaves out those without a match', async () => {
    const { settle } = setup(
      [thread('ses_new', { lastActivityAt: 3_000 }), thread('ses_none', { lastActivityAt: 2_000 }), thread('ses_old', { lastActivityAt: 1_000 })],
      (id) => ({ data: [user('msg_1', id === 'ses_none' ? 'nothing here' : 'a needle')] }),
    )
    expect((await settle('needle')).results.map((result) => result.threadId)).toEqual(['ses_new', 'ses_old'])
  })

  it('lists a few messages of a thread and counts all of them', async () => {
    const { settle } = setup([thread('ses_a')], () => ({ data: Array.from({ length: 6 }, (_, index) => user(`msg_${6 - index}`, 'needle')) }))
    const [result] = (await settle('needle')).results
    expect(result?.hitCount).toBe(6)
    expect(result?.hits).toHaveLength(SEARCH_HITS_PER_THREAD)
    expect(result?.hits[0]?.messageId).toBe('msg_6')
  })

  it('reads every page of a long thread, oldest text first', async () => {
    const pages: Record<string, unknown> = {
      first: { data: Array.from({ length: 50 }, (_, index) => user(`msg_b${50 - index}`, 'new text')), cursor: { next: 'older-1' } },
      'older-1': { data: [user('msg_a1', 'the needle from long ago')] },
    }
    const { settle, request } = setup([thread('ses_a')], (_id, req) => pages[req.query?.cursor ?? 'first'])
    const answer = await settle('needle')
    expect(answer.results[0]?.hits[0]?.messageId).toBe('msg_a1')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('has nothing to list for an empty query, but starts reading and reports how far it is', async () => {
    const { search, settle } = setup([thread('ses_a'), thread('ses_b')], () => ({ data: [user('msg_1', 'needle')] }))
    expect(search.search({ query: '  ' })).toMatchObject({ results: [], total: 2 })
    expect(await settle('')).toMatchObject({ results: [], indexed: 2, total: 2 })
  })

  it('answers with what is read so far while the rest is still being read', async () => {
    const { search } = setup([thread('ses_a')], () => ({ data: [user('msg_1', 'needle')] }))
    expect(search.search({ query: 'needle' })).toMatchObject({ results: [], indexed: 0, total: 1 })
  })

  it('reads a thread again once it has had activity, and not before', async () => {
    const { settle, request, list } = setup([thread('ses_a')], () => ({ data: [user('msg_1', 'needle')] }))
    await settle('needle')
    await settle('needle')
    expect(request).toHaveBeenCalledTimes(1)
    list[0] = thread('ses_a', { lastActivityAt: 2_000 })
    await settle('needle')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('reads a thread that is working again after a few seconds', async () => {
    const { settle, request, advance } = setup([thread('ses_a', { status: 'working' })], () => ({ data: [user('msg_1', 'needle')] }))
    await settle('needle')
    advance(1_000)
    await settle('needle')
    expect(request).toHaveBeenCalledTimes(1)
    advance(5_000)
    await settle('needle')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('counts a thread that cannot be read as read, keeps going, and tries it again later', async () => {
    let broken = true
    const { settle, request, advance } = setup([thread('ses_bad', { lastActivityAt: 2_000 }), thread('ses_ok')], (id) =>
      id === 'ses_bad' && broken ? new Error('The OpenCode service is not reachable.') : { data: [user('msg_1', 'needle')] })
    const answer = await settle('needle')
    expect(answer).toMatchObject({ indexed: 2, total: 2 })
    expect(answer.results.map((result) => result.threadId)).toEqual(['ses_ok'])
    broken = false
    advance(31_000)
    await settle('needle')
    // The thread counts as read while it is read again, so the new text shows with the next question.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(request).toHaveBeenCalledTimes(3)
    expect((await settle('needle')).results.map((result) => result.threadId)).toEqual(['ses_bad', 'ses_ok'])
  })

  it('forgets a thread that is gone from the Inbox', async () => {
    const { settle, list } = setup([thread('ses_a'), thread('ses_b')], () => ({ data: [user('msg_1', 'needle')] }))
    expect((await settle('needle')).results).toHaveLength(2)
    list.pop()
    expect(await settle('needle')).toMatchObject({ total: 1, results: [{ threadId: 'ses_a' }] })
  })

  it('lists at most so many threads and says when there are more', async () => {
    const threads = Array.from({ length: SEARCH_MAX_RESULTS + 5 }, (_, index) => thread(`ses_${index}`, { lastActivityAt: 10_000 - index }))
    const { settle } = setup(threads, () => ({ data: [user('msg_1', 'needle')] }))
    const answer = await settle('needle')
    expect(answer.results).toHaveLength(SEARCH_MAX_RESULTS)
    expect(answer.truncated).toBe(true)
  })

  it('asks again in smaller pages when a page is more than the client accepts', async () => {
    const limits: string[] = []
    let first = true
    const { settle } = setup([thread('ses_a')], (_id, req) => {
      limits.push(String(req.query?.limit))
      if (first) {
        first = false
        return new Error('The OpenCode service sent more data than MDE accepts.')
      }
      return { data: [user('msg_1', 'needle')] }
    })
    expect((await settle('needle')).results).toHaveLength(1)
    expect(limits).toEqual(['50', '25'])
  })

  it('is empty where the Inbox is not available', () => {
    const search = new InboxSearch({ client: { request: vi.fn() }, store: { list: () => [thread('ses_a')] }, enabled: () => false, now: () => 1 })
    expect(search.search({ query: 'needle' })).toEqual({ results: [], indexed: 0, total: 0, truncated: false })
  })
})
