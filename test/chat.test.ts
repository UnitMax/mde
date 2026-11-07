import { describe, expect, it } from 'vitest'
import type { ChatForm, ChatMessage, ChatPart, ChatPendingMessage, ChatTokens } from '../src/shared/types'
import {
  appendLive,
  compactionState,
  contextTone,
  contextUsage,
  displayPath,
  formatCost,
  formatExactTokens,
  formatPercent,
  formatTokens,
  formAnswer,
  groupModels,
  hideReverted,
  initialChoice,
  initialFormDraft,
  latestStepTokens,
  messageBlocks,
  mergeLive,
  mergePending,
  modelName,
  orderAgents,
  pruneLive,
  revertedMessageCount,
  segmentFill,
  stepContext,
  subagentInfo,
  subagentResult,
  toolSummary,
  turnStats,
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

  it('reads the older `task` tool as a subagent too', () => {
    const old = call({
      name: 'task', status: 'completed',
      input: JSON.stringify({ description: 'Count to 100', prompt: 'Write a script', subagent_type: 'general' }),
      output: '<task id="ses_x" state="completed">\n<task_result>\nThe script printed 1 to 100.\n</task_result>\n</task>',
    })
    expect(subagentInfo(old)).toMatchObject({ agent: 'general', title: 'Count to 100', state: 'done' })
    expect(subagentResult(old.output!)).toBe('The script printed 1 to 100.')
    expect(messageBlocks([old]).map((block) => block.kind)).toEqual(['subagents'])
  })

  it('groups consecutive subagent calls into one block', () => {
    const text: ChatPart = { kind: 'text', text: 'Launching' }
    const blocks = messageBlocks([text, call({ id: 'a' }), call({ id: 'b' }), text, call({ id: 'c' })])
    expect(blocks.map((block) => block.kind)).toEqual(['part', 'subagents', 'part', 'subagents'])
    expect(blocks[1]).toMatchObject({ kind: 'subagents', parts: [{ id: 'a' }, { id: 'b' }] })
  })
})

describe('context usage', () => {
  const tokens = (overrides: Partial<ChatTokens> = {}): ChatTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, ...overrides })
  const step = (id: string, stepTokens: ChatTokens | undefined, completed = true): ChatMessage => ({
    kind: 'assistant', id, time: 1, agent: 'build', model, parts: [], completed, ...(stepTokens ? { tokens: stepTokens } : {}),
  })
  const user: ChatMessage = { kind: 'user', id: 'msg_u', time: 1, text: 'Hi' }
  const windowed = { id: 'model-1', providerId: 'p', providerName: 'P', name: 'Model One', contextLimit: 200_000, outputLimit: 32_000 }

  it('adds up a step the way the model saw it: the whole prompt plus what it wrote', () => {
    expect(stepContext(tokens({ input: 100, output: 20, reasoning: 5, cacheRead: 1000, cacheWrite: 10 }))).toBe(1135)
  })

  it('measures the newest finished step and ignores streaming and empty ones', () => {
    const older = tokens({ input: 10, cacheRead: 100 })
    const newest = tokens({ input: 20, output: 5, cacheRead: 300 })
    expect(latestStepTokens([user, step('a', older), step('b', newest), step('c', undefined, false)])).toBe(newest)
    expect(latestStepTokens([step('a', older), step('b', tokens({ input: 1 }), false)])).toBe(older)
    expect(latestStepTokens([step('a', older), step('b', tokens())])).toBe(older)
    expect(latestStepTokens([user, step('a', undefined)])).toBeNull()
    expect(latestStepTokens([])).toBeNull()
  })

  it('has nothing to show before a step has finished', () => {
    expect(contextUsage({ messages: [user, step('a', undefined, false)], model: windowed })).toBeNull()
  })

  it('relates the newest step to the chosen model\'s window', () => {
    const totals = { cost: 0.5, tokens: tokens({ input: 9 }) }
    const usage = contextUsage({
      messages: [step('a', tokens({ input: 1000 })), step('b', tokens({ input: 2000, output: 500, cacheRead: 137_500 }))],
      usage: totals,
      model: windowed,
    })
    expect(usage).toMatchObject({
      used: 140_000, limit: 200_000, ratio: 0.7, tone: 'warn', outputLimit: 32_000, modelName: 'Model One', thread: totals,
    })
    expect(usage?.step).toEqual(tokens({ input: 2000, output: 500, cacheRead: 137_500 }))
  })

  it('still reports the count when the model has no known window', () => {
    expect(contextUsage({ messages: [step('a', tokens({ input: 42 }))] })).toMatchObject({
      used: 42, limit: null, ratio: null, tone: 'normal', outputLimit: null, modelName: null, thread: null,
    })
    expect(contextUsage({ messages: [step('a', tokens({ input: 42 }))], model: { ...windowed, contextLimit: undefined } })?.ratio).toBeNull()
  })

  describe('after a compaction', () => {
    const note = (id: string, compaction: Extract<ChatMessage, { kind: 'note' }>['compaction'], tone: 'info' | 'error' = 'info'): ChatMessage =>
      ({ kind: 'note', id, time: 1, tone, text: 'note', ...(compaction ? { compaction } : {}) })
    const completed = (id = 'c', summaryTokens?: number): ChatMessage => note(id, { status: 'completed', reason: 'manual', ...(summaryTokens ? { summaryTokens } : {}) })
    const before = tokens({ input: 2000, output: 500, cacheRead: 137_500 })

    it('does not know the size until the next reply: it keeps the old count, drops the ratio and stays calm', () => {
      const usage = contextUsage({ messages: [user, step('a', before), completed('c', 724)], model: windowed })
      expect(usage).toMatchObject({ used: 140_000, step: before, limit: 200_000, ratio: null, tone: 'normal', compacted: { summaryTokens: 724 } })
      // The same conversation, not compacted, is at 70% and amber.
      expect(contextUsage({ messages: [user, step('a', before)], model: windowed })).toMatchObject({ ratio: 0.7, tone: 'warn', compacted: null })
    })

    it('says so when it does not know how big the summary is', () => {
      expect(contextUsage({ messages: [step('a', before), completed()], model: windowed })?.compacted).toEqual({ summaryTokens: null })
    })

    it('measures again from the first finished reply after it', () => {
      const after = tokens({ input: 9000, output: 500 })
      expect(contextUsage({ messages: [step('a', before), completed(), user, step('b', after)], model: windowed }))
        .toMatchObject({ used: 9500, ratio: 9500 / 200_000, tone: 'normal', compacted: null })
      // A reply still being written has no count yet, so it is still the compacted conversation.
      expect(contextUsage({ messages: [step('a', before), completed(), user, step('b', undefined, false)], model: windowed })?.compacted).not.toBeNull()
    })

    it('is not changed by a compaction that failed or is still running, or by a note that is no compaction', () => {
      for (const other of [note('c', { status: 'failed', reason: 'manual' }, 'error'), note('c', { status: 'running', reason: 'manual' }), note('c', undefined)]) {
        expect(contextUsage({ messages: [user, step('a', before), other], model: windowed })).toMatchObject({ used: 140_000, ratio: 0.7, tone: 'warn', compacted: null })
      }
    })

    it('uses the newest compaction when there are several', () => {
      expect(contextUsage({ messages: [step('a', before), completed('c1', 100), completed('c2', 200)], model: windowed })?.compacted).toEqual({ summaryTokens: 200 })
    })

    it('has nothing to show when no step ever finished, however many compactions there are', () => {
      expect(contextUsage({ messages: [user, completed()], model: windowed })).toBeNull()
    })
  })

  describe('compaction state', () => {
    const note = (status: 'running' | 'completed' | 'failed'): ChatMessage =>
      ({ kind: 'note', id: `c-${status}`, time: 1, tone: 'info', text: 'note', compaction: { status, reason: 'manual' } })
    const idle = { running: false, held: false }

    it('is running while the newest compaction says so and the thread is working', () => {
      expect(compactionState([user, note('running')], { running: true, held: false })).toBe('running')
    })

    it('is not running for a note the service left behind when it stopped', () => {
      expect(compactionState([user, note('running')], idle)).toBeNull()
    })

    it('is over once the newest compaction has completed or failed, whatever came before', () => {
      expect(compactionState([note('running'), note('completed')], { running: true, held: false })).toBeNull()
      expect(compactionState([note('running'), note('failed')], { running: true, held: false })).toBeNull()
    })

    it('is held when the service holds a request for the agent, and running wins over held', () => {
      expect(compactionState([user], { running: true, held: true })).toBe('held')
      expect(compactionState([user, note('running')], { running: true, held: true })).toBe('running')
      expect(compactionState([user, note('completed')], { running: true, held: true })).toBe('held')
    })

    it('is nothing otherwise', () => {
      expect(compactionState([], idle)).toBeNull()
      expect(compactionState([user], { running: true, held: false })).toBeNull()
    })
  })

  it('turns amber at 70% and red at 90%', () => {
    expect([0, 0.69, 0.7, 0.89, 0.9, 1.4].map(contextTone)).toEqual(['normal', 'normal', 'warn', 'warn', 'danger', 'danger'])
    expect(contextTone(null)).toBe('normal')
  })

  it('lights the gauge segment by segment, and leaves it dark without a window', () => {
    const lit = (ratio: number | null): number[] => Array.from({ length: 5 }, (_, index) => Number(segmentFill(ratio, index).toFixed(2)))
    expect(lit(0)).toEqual([0, 0, 0, 0, 0])
    expect(lit(0.21)).toEqual([1, 0.05, 0, 0, 0])
    expect(lit(0.75)).toEqual([1, 1, 1, 0.75, 0])
    expect(lit(1)).toEqual([1, 1, 1, 1, 1])
    expect(lit(1.6)).toEqual([1, 1, 1, 1, 1])
    expect(lit(null)).toEqual([0, 0, 0, 0, 0])
  })

  it('writes counts, percentages and costs compactly', () => {
    expect([0, 842, 999, 1000, 4231, 42_300, 99_960, 100_000, 412_345, 999_499, 999_500, 1_048_576, 12_400_000]
      .map(formatTokens)).toEqual(['0', '842', '999', '1K', '4.2K', '42.3K', '100K', '100K', '412K', '999K', '1M', '1.05M', '12.4M'])
    expect(formatTokens(-5)).toBe('0')
    expect(formatExactTokens(1_048_576)).toBe('1,048,576')
    expect([0, 0.001, 0.004, 0.0099, 0.2, 1].map(formatPercent)).toEqual(['0%', '<1%', '<1%', '<1%', '20%', '100%'])
    expect(formatPercent(0.01)).toBe('1%')
    expect(formatPercent(1.043)).toBe('104%')
    expect([0, 0.00123, 0.5, 12.3456, 1234.5].map(formatCost)).toEqual(['$0.00', '$0.0012', '$0.50', '$12.35', '$1,234.50'])
  })
})

describe('turn stats', () => {
  const user = (id: string, time: number): ChatMessage => ({ kind: 'user', id, time, text: 'Do it' })
  const step = (
    id: string, time: number, completedAt?: number,
    extra: { streamedAt?: number; output?: number; reasoning?: number } = {},
  ): ChatMessage => ({
    kind: 'assistant', id, time, agent: 'build', model, parts: [], completed: completedAt !== undefined,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(extra.streamedAt !== undefined ? { streamedAt: extra.streamedAt } : {}),
    ...(extra.output !== undefined ? { tokens: { input: 10, output: extra.output, reasoning: extra.reasoning ?? 0, cacheRead: 0, cacheWrite: 0 } } : {}),
  })
  const note = (id: string, time: number, text = 'Stopped'): ChatMessage => ({ kind: 'note', id, time, tone: 'info', text })
  const took = (stats: ReturnType<typeof turnStats>): [string, number][] => [...stats.finished].map(([id, stat]) => [id, stat.ms])

  it('times a turn from the user message to its last finished step, under that step', () => {
    const { finished, openSince } = turnStats([
      user('u1', 1_000), step('a1', 1_015, 6_000), step('a2', 6_020, 91_000),
      user('u2', 100_000), step('a3', 100_010, 103_500),
    ])
    expect(took({ finished, openSince })).toEqual([['a2', 90_000], ['a3', 3_500]])
    expect(openSince).toBeNull()
  })

  it('puts the line ahead of the note about how the run ended, and ignores notes elsewhere', () => {
    const stats = turnStats([
      user('u1', 1_000), step('a1', 1_010, 23_000), note('n1', 23_003),
      note('n2', 30_000, 'Switched to other/model'), user('u2', 30_010), step('a2', 30_020, 31_000),
    ])
    expect(took(stats)).toEqual([['a1', 22_000], ['a2', 990]])
  })

  it('leaves out the turn in progress and says when it began', () => {
    const working = turnStats([user('u1', 1_000), step('a1', 1_010, 5_000), user('u2', 9_000), step('a2', 9_010)])
    expect(took(working)).toEqual([['a1', 4_000]])
    expect(working.openSince).toBe(9_000)

    // Between steps every step so far is finished; it is the turn that decides, not the last step.
    const waiting = turnStats([user('u1', 1_000), step('a1', 1_010, 5_000)])
    expect(waiting.finished.get('a1')?.ms).toBe(4_000)

    const justSent = turnStats([user('u1', 1_000), step('a1', 1_010, 5_000), user('u2', 9_000)])
    expect(took(justSent)).toEqual([['a1', 4_000]])
    expect(justSent.openSince).toBe(9_000)
  })

  it('does not time a turn whose start or end is unknown', () => {
    // The user message is in an older page that is not loaded.
    expect(turnStats([step('a1', 1_010, 5_000), user('u2', 9_000), step('a2', 9_010, 9_900)]).finished.has('a1')).toBe(false)
    // The run was cut off before any step finished.
    expect(turnStats([user('u1', 1_000), step('a1', 1_010)]).finished.size).toBe(0)
    // A user message without a time.
    expect(turnStats([user('u1', 0), step('a1', 10, 5_000)]).finished.size).toBe(0)
    expect(turnStats([user('u1', 0)]).openSince).toBeNull()
    expect(turnStats([]).finished.size).toBe(0)
  })

  describe('goals', () => {
    const goalNote = (id: string, time: number, goal: 'set' | 'resume' | 'continue'): ChatMessage => ({
      kind: 'note', id, time, tone: 'info', text: 'Goal', goal,
    })
    const DAY = 86_400_000

    it('times a goal from when it was set, not from the user message a day before it', () => {
      // The shape of a real thread: a prompt, a day of nothing, then /goal, whose start is not a user message.
      const stats = turnStats([
        user('u1', 1_000), step('a1', 1_010, 10_000),
        goalNote('g1', DAY + 1_000, 'set'), step('a2', DAY + 1_010, DAY + 56_000),
      ])
      expect(took(stats)).toEqual([['a1', 9_000], ['a2', 55_000]])
      expect(stats.openSince).toBeNull()
    })

    it('gives each round its own time, leaving out the reviewer\'s time between rounds', () => {
      const stats = turnStats([
        goalNote('g1', 10_000, 'set'), step('a1', 10_010, 40_000),
        // The reviewer takes 150 s, then asks the agent to go on.
        goalNote('g2', 190_000, 'continue'), step('a2', 190_010, 205_000),
        goalNote('g3', 400_000, 'resume'), step('a3', 400_010, 402_000),
      ])
      expect(took(stats)).toEqual([['a1', 30_000], ['a2', 15_000], ['a3', 2_000]])
    })

    it('says when the round in progress began, including before its first step', () => {
      const working = turnStats([user('u1', 1_000), step('a1', 1_010, 5_000), goalNote('g1', 9_000, 'set'), step('a2', 9_010)])
      expect(took(working)).toEqual([['a1', 4_000]])
      expect(working.openSince).toBe(9_000)

      const justSet = turnStats([user('u1', 1_000), step('a1', 1_010, 5_000), goalNote('g1', 9_000, 'set')])
      expect(took(justSet)).toEqual([['a1', 4_000]])
      expect(justSet.openSince).toBe(9_000)
    })

    it('does not time a goal note that has no time, and leaves other notes alone', () => {
      expect(turnStats([goalNote('g1', 0, 'set'), step('a1', 10, 5_000)]).finished.size).toBe(0)
      // A note that is not about a goal does not start a turn.
      expect(took(turnStats([user('u1', 1_000), step('a1', 1_010, 4_000), note('n1', 5_000, 'Switched model'), step('a2', 5_010, 8_000)])))
        .toEqual([['a2', 7_000]])
    })
  })

  it('never reports a negative time', () => {
    expect(turnStats([user('u1', 9_000), step('a1', 9_010, 8_000)]).finished.get('a1')?.ms).toBe(0)
  })

  describe('tokens per second', () => {
    it('divides every step\'s output and reasoning tokens by the time the steps spent generating', () => {
      // 3 s then 1 s of generating (the 10 s between stream end and completion was a tool running):
      // (100 + 20 + 40) tokens over 4 s.
      const stats = turnStats([
        user('u1', 1_000),
        step('a1', 1_010, 14_000, { streamedAt: 4_010, output: 100, reasoning: 20 }),
        step('a2', 14_020, 15_100, { streamedAt: 15_020, output: 40 }),
      ])
      expect(stats.finished.get('a2')).toEqual({ ms: 14_100, tokensPerSecond: 40 })
    })

    it('is the same number whichever way the steps are cut up, and counts only its own turn', () => {
      const stats = turnStats([
        user('u1', 1_000), step('a1', 1_010, 3_000, { streamedAt: 2_010, output: 50 }),
        user('u2', 9_000), step('a2', 9_010, 10_000, { streamedAt: 9_510, output: 500 }),
      ])
      expect(stats.finished.get('a1')?.tokensPerSecond).toBe(50)
      expect(stats.finished.get('a2')?.tokensPerSecond).toBe(1_000)
    })

    it('has none when a step lacks its times, there are no tokens, or nothing was generated', () => {
      const rate = (...steps: ChatMessage[]) => turnStats([user('u1', 1_000), ...steps]).finished.values().next().value?.tokensPerSecond
      expect(rate(step('a1', 1_010, 3_000, { output: 50 }))).toBeNull()
      expect(rate(step('a1', 1_010, 3_000, { streamedAt: 2_010, output: 50 }), step('a2', 3_010, 4_000, { output: 50 }))).toBeNull()
      expect(rate(step('a1', 0, 3_000, { streamedAt: 2_010, output: 50 }))).toBeNull()
      expect(rate(step('a1', 1_010, 3_000, { streamedAt: 2_010 }))).toBeNull()
      expect(rate(step('a1', 1_010, 3_000, { streamedAt: 2_010, output: 0 }))).toBeNull()
      expect(rate(step('a1', 1_010, 3_000, { streamedAt: 1_010, output: 50 }))).toBeNull()
      // The line is still there without a rate.
      expect(turnStats([user('u1', 1_000), step('a1', 1_010, 3_000)]).finished.get('a1')).toEqual({ ms: 2_000, tokensPerSecond: null })
    })
  })
})

describe('staged revert', () => {
  const user = (id: string): ChatMessage => ({ kind: 'user', id, time: 1, text: id })
  const reply = (id: string): ChatMessage => ({ kind: 'assistant', id, time: 2, agent: 'build', model, parts: [], completed: true })
  const messages = [user('msg_1'), reply('msg_2'), user('msg_3'), reply('msg_4'), user('msg_5')]
  const revert = (messageId: string) => ({ messageId, files: [] })
  const ids = (list: readonly ChatMessage[]) => list.map((message) => message.id)

  it('keeps what comes before the first hidden message, as OpenCode orders them', () => {
    expect(ids(hideReverted(messages, revert('msg_3')))).toEqual(['msg_1', 'msg_2'])
    // A step of a reply can be the boundary too.
    expect(ids(hideReverted(messages, revert('msg_4')))).toEqual(['msg_1', 'msg_2', 'msg_3'])
    expect(ids(hideReverted(messages, revert('msg_1')))).toEqual([])
  })

  it('hands back the same messages when nothing is staged or the cut is past the end', () => {
    expect(hideReverted(messages, null)).toBe(messages)
    expect(hideReverted(messages, undefined)).toBe(messages)
    expect(ids(hideReverted(messages, revert('msg_9')))).toEqual(ids(messages))
  })

  it('counts the user messages that are hidden, not the replies', () => {
    expect(revertedMessageCount(messages, revert('msg_3'))).toBe(2)
    expect(revertedMessageCount(messages, revert('msg_4'))).toBe(1)
    expect(revertedMessageCount(messages, revert('msg_9'))).toBe(0)
    expect(revertedMessageCount(messages, null)).toBe(0)
  })
})

describe('mergePending', () => {
  const held = (id: string, delivery: ChatPendingMessage['delivery'] = 'steer'): ChatPendingMessage =>
    ({ id, delivery, message: { kind: 'user', id, time: 1, text: id } })
  const user = (id: string): ChatMessage => ({ kind: 'user', id, time: 1, text: id })
  const ids = (list: readonly ChatPendingMessage[]): string[] => list.map((entry) => entry.id)

  it('takes what the service said it holds, in its order', () => {
    expect(ids(mergePending([held('msg_a')], [held('msg_b'), held('msg_c', 'queue')], []))).toEqual(['msg_b', 'msg_c'])
    expect(mergePending([held('msg_a')], [held('msg_a', 'queue')], [])[0]?.delivery).toBe('queue')
  })

  it('says nothing is held when the service holds nothing', () => {
    expect(mergePending([held('msg_a')], [], [])).toEqual([])
  })

  it('keeps what it had when the service could not say, or when the read cannot be trusted about it', () => {
    const current = [held('msg_a'), held('msg_b')]
    expect(ids(mergePending(current, undefined, []))).toEqual(['msg_a', 'msg_b'])
  })

  it('drops a message that has reached the conversation, whichever way the read saw it', () => {
    // Listed as held by a read that came before the delivery, yet already in the conversation read after it.
    expect(ids(mergePending([], [held('msg_a'), held('msg_b')], [user('msg_a')]))).toEqual(['msg_b'])
    // Held according to what the thread had, and delivered since.
    expect(ids(mergePending([held('msg_a'), held('msg_b')], undefined, [user('msg_b')]))).toEqual(['msg_a'])
  })

  it('does not change what it is given', () => {
    const current = [held('msg_a')]
    const read = [held('msg_b')]
    mergePending(current, read, [user('msg_b')])
    expect(ids(current)).toEqual(['msg_a'])
    expect(ids(read)).toEqual(['msg_b'])
  })
})
