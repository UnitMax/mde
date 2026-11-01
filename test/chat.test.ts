import { describe, expect, it } from 'vitest'
import type { ChatForm, ChatMessage, ChatPart } from '../src/shared/types'
import {
  appendLive,
  displayPath,
  formAnswer,
  groupModels,
  initialChoice,
  initialFormDraft,
  messageBlocks,
  mergeLive,
  modelName,
  orderAgents,
  pruneLive,
  subagentInfo,
  subagentResult,
  toolSummary,
} from '../src/renderer/lib/chat'

const model = { id: 'model-1', providerId: 'p' }
const models = [
  { id: 'b-model', providerId: 'zed', providerName: 'Zed', name: 'Beta' },
  { id: 'a-model', providerId: 'zed', providerName: 'Zed', name: 'Alpha' },
  { id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free' },
]

describe('chat picker helpers', () => {
  it('orders Build and Plan first', () => {
    expect(orderAgents([
      { id: 'review', name: 'Review' }, { id: 'plan', name: 'Plan' }, { id: 'apply', name: 'Apply' }, { id: 'build', name: 'Build' },
    ]).map((agent) => agent.id)).toEqual(['build', 'plan', 'apply', 'review'])
  })

  it('groups and searches models by name, ID and provider', () => {
    expect(groupModels(models, '').map((group) => [group.providerName, group.models.map((item) => item.name)]))
      .toEqual([['OpenCode', ['Flint Free']], ['Zed', ['Alpha', 'Beta']]])
    expect(groupModels(models, 'zed alp').flatMap((group) => group.models.map((item) => item.id))).toEqual(['a-model'])
    expect(groupModels(models, 'FREE')[0]?.models[0]?.id).toBe('free-1')
    expect(groupModels(models, 'nothing')).toEqual([])
    expect(modelName(models, { id: 'free-1', providerId: 'opencode' })).toBe('Flint Free')
    expect(modelName(models, { id: 'gone', providerId: 'x' })).toBe('gone')
    expect(modelName(models, null)).toBe('Choose a model')
  })

  it('starts with the remembered choice when it still exists, else the defaults', () => {
    const options = {
      agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }],
      models,
      defaultModel: { id: 'free-1', providerId: 'opencode' },
      defaultAgent: 'build',
    }
    expect(initialChoice(options, { agent: 'plan', model: { id: 'a-model', providerId: 'zed' } }))
      .toEqual({ agent: 'plan', model: { id: 'a-model', providerId: 'zed' } })
    expect(initialChoice(options, { agent: 'gone', model: { id: 'gone', providerId: 'zed' } }))
      .toEqual({ agent: 'build', model: { id: 'free-1', providerId: 'opencode' } })
    expect(initialChoice({ ...options, defaultModel: null, defaultAgent: null }, {}))
      .toEqual({ agent: 'build', model: { id: 'b-model', providerId: 'zed' } })
  })
})

describe('live streaming', () => {
  const assistant = (parts: ChatPart[], id = 'msg_a'): ChatMessage => ({
    kind: 'assistant', id, time: 1, agent: 'build', model, parts, completed: false,
  })

  it('accumulates deltas per message, part kind and ordinal', () => {
    let live = appendLive([], { messageId: 'msg_a', part: 'text', ordinal: 0, delta: 'Hel' })
    live = appendLive(live, { messageId: 'msg_a', part: 'text', ordinal: 0, delta: 'lo' })
    live = appendLive(live, { messageId: 'msg_a', part: 'reasoning', ordinal: 0, delta: 'Hmm' })
    expect(live).toEqual([
      { messageId: 'msg_a', part: 'text', ordinal: 0, text: 'Hello' },
      { messageId: 'msg_a', part: 'reasoning', ordinal: 0, text: 'Hmm' },
    ])
  })

  it('lays streamed text over fetched parts, appends missing parts, and adds unfetched messages', () => {
    const fetched = [assistant([{ kind: 'reasoning', text: 'Hm' }, { kind: 'text', text: 'Hel' }])]
    const live = [
      { messageId: 'msg_a', part: 'text' as const, ordinal: 0, text: 'Hello' },
      { messageId: 'msg_a', part: 'text' as const, ordinal: 1, text: 'Second' },
      { messageId: 'msg_a', part: 'reasoning' as const, ordinal: 0, text: 'H' },
      { messageId: 'msg_b', part: 'text' as const, ordinal: 0, text: 'New' },
    ]
    const merged = mergeLive(fetched, live, { agent: 'plan', model })
    expect(merged[0]).toMatchObject({ parts: [
      { kind: 'reasoning', text: 'Hm' },
      { kind: 'text', text: 'Hello' },
      { kind: 'text', text: 'Second' },
    ] })
    expect(merged[1]).toMatchObject({ id: 'msg_b', agent: 'plan', parts: [{ kind: 'text', text: 'New' }] })
    expect(mergeLive(fetched, live).map((message) => message.id)).toEqual(['msg_a'])
    expect(mergeLive(fetched, [])).toBe(fetched)
  })

  it('forgets streamed text once the fetched message caught up', () => {
    const live = [
      { messageId: 'msg_a', part: 'text' as const, ordinal: 0, text: 'Hello' },
      { messageId: 'msg_b', part: 'text' as const, ordinal: 0, text: 'Pending' },
    ]
    expect(pruneLive([assistant([{ kind: 'text', text: 'Hello there' }])], live)).toEqual([live[1]])
    expect(pruneLive([assistant([{ kind: 'text', text: 'He' }])], live)).toEqual(live)
  })
})

describe('tool summaries', () => {
  const tool = (name: string, input: unknown, status: 'running' | 'completed' = 'completed') =>
    ({ kind: 'tool', id: 'call_1', name, status, input: JSON.stringify(input) }) as Extract<ChatPart, { kind: 'tool' }>

  it('describes common tools with paths relative to the folder', () => {
    expect(toolSummary(tool('read', { path: '/home/me/app/src/a.ts' }), '/home/me/app')).toBe('Read src/a.ts')
    expect(toolSummary(tool('write', { path: '/home/me/app/copy.txt' }, 'running'), '/home/me/app/')).toBe('Writing copy.txt')
    expect(toolSummary(tool('edit', { filePath: '/etc/hosts' }), '/home/me/app')).toBe('Edited /etc/hosts')
    expect(toolSummary(tool('shell', { command: 'npm test\nnpm run lint' }), '/home/me/app')).toBe('Ran npm test')
    expect(toolSummary(tool('grep', { pattern: 'TODO' }), '/')).toBe('Searched for TODO')
    expect(toolSummary(tool('question', {}), '/')).toBe('Asked a question')
    expect(toolSummary(tool('mystery', {}), '/')).toBe('mystery')
    expect(toolSummary({ ...tool('read', {}), input: '{"path": "/home/me/app/a' }, '/home/me/app')).toBe('Read a file')
    expect(displayPath('C:\\src\\app\\a.ts', 'C:\\src\\app')).toBe('a.ts')
  })
})

describe('question answers', () => {
  const form: ChatForm = {
    id: 'frm_1', title: 'Questions', unsupported: false,
    fields: [
      { key: 'color', type: 'string', title: 'Color', required: false, custom: true, options: [{ value: 'Red', label: 'Red' }] },
      { key: 'count', type: 'integer', title: 'Count', required: false, custom: false, options: [] },
      { key: 'tags', type: 'multiselect', title: 'Tags', required: true, custom: false, options: [{ value: 'a', label: 'A' }] },
      { key: 'sure', type: 'boolean', required: false, custom: false, options: [] },
    ],
  }

  it('builds an answer and explains what is missing', () => {
    const draft = initialFormDraft(form)
    expect(draft).toEqual({ tags: [], sure: false })
    expect(formAnswer(form, draft)).toEqual({ error: 'Answer “Color”.' })
    expect(formAnswer(form, { ...draft, color: 'Red' })).toEqual({ error: 'Choose at least one option for “Tags”.' })
    expect(formAnswer(form, { ...draft, color: 'Red', tags: ['a'], count: '2.5' })).toEqual({ error: '“Count” needs a whole number.' })
    expect(formAnswer(form, { color: ' Green ', tags: ['a'], count: '3', sure: true }))
      .toEqual({ answer: { color: 'Green', tags: ['a'], count: 3, sure: true } })
  })
})

describe('subagent calls', () => {
  const call = (overrides: Partial<Extract<ChatPart, { kind: 'tool' }>> = {}): Extract<ChatPart, { kind: 'tool' }> => ({
    kind: 'tool', id: 'call_1', name: 'subagent', status: 'running',
    input: JSON.stringify({ agent: 'explore', description: 'Explore repo structure', prompt: 'Read the README.\nThen list the modules.' }),
    ...overrides,
  })

  it('reads who, what and how it went', () => {
    expect(subagentInfo(call())).toEqual({
      agent: 'explore', title: 'Explore repo structure', task: 'Read the README.\nThen list the modules.', state: 'running', problem: null,
    })
    expect(subagentInfo(call({ status: 'completed', output: 'All good' })).state).toBe('done')
    expect(subagentInfo(call({ status: 'pending', input: '{"agent": "expl' }))).toMatchObject({ agent: null, state: 'starting' })
    expect(subagentInfo(call({ status: 'error', error: 'Tool execution interrupted (sessionID: ses_x)' })))
      .toMatchObject({ state: 'interrupted', problem: 'Tool execution interrupted' })
    expect(subagentInfo(call({ status: 'error', error: 'Subagent failed (sessionID: ses_x): no credits' })))
      .toMatchObject({ state: 'failed', problem: 'Subagent failed: no credits' })
    expect(toolSummary(call(), '/')).toBe('Subagent: Explore repo structure')
  })

  it('drops the wrapper tag around a subagent answer', () => {
    expect(subagentResult('<subagent sessionID="ses_x" state="completed">\n**Found** it\n</subagent>')).toBe('**Found** it')
    expect(subagentResult('Plain answer')).toBe('Plain answer')
  })

  it('groups consecutive subagent calls into one block', () => {
    const text: ChatPart = { kind: 'text', text: 'Launching' }
    const blocks = messageBlocks([text, call({ id: 'a' }), call({ id: 'b' }), text, call({ id: 'c' })])
    expect(blocks.map((block) => block.kind)).toEqual(['part', 'subagents', 'part', 'subagents'])
    expect(blocks[1]).toMatchObject({ kind: 'subagents', parts: [{ id: 'a' }, { id: 'b' }] })
  })
})
