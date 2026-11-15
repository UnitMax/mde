import { describe, expect, it } from 'vitest'
import { filterTurns, toolCallCount, toolCounts, toolTurns } from '../src/renderer/lib/tool-review'
import type { ChatMessage, ChatPart } from '../src/shared/types'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const DIR = '/home/me/app'
const MODEL = { id: 'm', providerId: 'p' }
const tool = (id: string, name: string, input: unknown, extra: Partial<ToolPart> = {}): ToolPart =>
  ({ kind: 'tool', id, name, status: 'completed', input: JSON.stringify(input), ...extra })
const assistant = (id: string, parts: ChatPart[]): ChatMessage => ({ kind: 'assistant', id, time: 2, agent: 'build', model: MODEL, parts, completed: true })
const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })

const messages: ChatMessage[] = [
  assistant('msg_0', [tool('t0', 'read', { filePath: `${DIR}/early.ts` })]),
  user('msg_1', 'Fix the build\nand more'),
  assistant('msg_2', [
    { kind: 'text', text: 'Looking' },
    tool('t1', 'read', { filePath: `${DIR}/src/a.ts` }),
    tool('t2', 'bash', { command: 'npm test\necho done' }, { exitCode: 1 }),
    tool('t3', 'github_search_issues', { query: 'flaky' }),
  ]),
  user('msg_3', 'Nothing to do'),
  assistant('msg_4', [{ kind: 'text', text: 'Done' }]),
  user('msg_5', 'Use code mode'),
  assistant('msg_6', [
    tool('t4', 'execute', { code: 'await tools.github.list()' }, { calls: [{ tool: 'github.list', status: 'completed', input: '{}' }, { tool: 'browser.open', status: 'error', input: '{"url":"x"}' }] }),
    tool('t5', 'webfetch', { url: 'https://example.com' }, { status: 'running' }),
  ]),
]

describe('toolTurns', () => {
  const turns = toolTurns(messages, ['github'], DIR)

  it('groups calls under the message they answered, keeping calls before the first loaded message and dropping empty turns', () => {
    expect(turns.map((turn) => [turn.id, turn.number, turn.prompt, turn.entries.map((entry) => entry.id)])).toEqual([
      ['start', 0, null, ['t0']],
      ['msg_1', 1, 'Fix the build', ['t1', 't2', 't3']],
      ['msg_5', 3, 'Use code mode', ['t4', 't5']],
    ])
  })

  it('names each call and what it was about', () => {
    const entries = turns.flatMap((turn) => turn.entries)
    expect(entries.map((entry) => [entry.title, entry.subject])).toEqual([
      ['Read', 'early.ts'],
      ['Read', 'src/a.ts'],
      ['Shell', 'npm test'],
      ['search_issues', 'query: flaky'],
      ['Code Mode', 'github.list, browser.open'],
      ['Fetch', 'https://example.com'],
    ])
  })

  it('tells MCP calls, failures (including a non-zero exit) and running calls apart', () => {
    expect(toolCounts(turns)).toEqual({ actions: 3, all: 6, mcp: 2, failed: 1, running: 1 })
    const byId = new Map(turns.flatMap((turn) => turn.entries).map((entry) => [entry.id, entry]))
    expect(byId.get('t2')?.failed).toBe(true)
    expect(byId.get('t3')?.calls[0]?.server).toBe('github')
    expect(byId.get('t4')?.mcp).toBe(true)
  })

  it('counts nothing as MCP before the server names are known, as the chat does', () => {
    expect(toolCounts(toolTurns(messages, [], DIR)).mcp).toBe(0)
  })
})

describe('filterTurns', () => {
  const turns = toolTurns(messages, ['github'], DIR)
  const ids = (filtered: ReturnType<typeof filterTurns>): string[] => filtered.flatMap((turn) => turn.entries.map((entry) => entry.id))

  it('keeps everything with no filter or search', () => {
    expect(filterTurns(turns, 'all', '  ')).toBe(turns)
  })

  it('keeps commands and MCP calls for the default view, leaving out reads, fetches and the like', () => {
    expect(ids(filterTurns(turns, 'actions', ''))).toEqual(['t2', 't3', 't4'])
    expect(filterTurns(turns, 'actions', '').map((turn) => turn.id)).toEqual(['msg_1', 'msg_5'])
  })

  it('counts an unknown tool as an action: it may be MCP whose server list has not loaded', () => {
    const unknown = toolTurns([assistant('m', [tool('x', 'linear_create_issue', { title: 'a' }), tool('y', 'glob', { pattern: '*' })])], [], DIR)
    expect(ids(filterTurns(unknown, 'actions', ''))).toEqual(['x'])
  })

  it('narrows to MCP calls or failures, dropping turns left empty', () => {
    expect(ids(filterTurns(turns, 'mcp', ''))).toEqual(['t3', 't4'])
    const failed = filterTurns(turns, 'failed', '')
    expect(ids(failed)).toEqual(['t2'])
    expect(failed.map((turn) => turn.id)).toEqual(['msg_1'])
  })

  it('searches names, subjects, servers and input, every word having to match', () => {
    expect(ids(filterTurns(turns, 'all', 'github'))).toEqual(['t3', 't4'])
    expect(ids(filterTurns(turns, 'all', 'READ a.ts'))).toEqual(['t1'])
    expect(ids(filterTurns(turns, 'all', 'flaky'))).toEqual(['t3'])
    expect(ids(filterTurns(turns, 'mcp', 'browser'))).toEqual(['t4'])
    expect(ids(filterTurns(turns, 'all', 'nowhere'))).toEqual([])
  })
})

it('counts tool calls for the tab badge', () => {
  expect(toolCallCount(messages)).toBe(6)
  expect(toolCallCount([])).toBe(0)
})
