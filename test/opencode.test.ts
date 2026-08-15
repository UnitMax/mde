import { describe, expect, it } from 'vitest'
import {
  createPromptBody,
  describeResponseParts,
  extractReasoningMessages,
  extractHistoryMessages,
  extractTurnItems,
  extractTextParts,
  createOpenCodeLaunch,
  OpenCodeStreamTracker,
  parseServerUrl,
  parseSseFrames,
  normalizeOpenCodeDirectory,
  normalizeOpenCodeModels
} from '../src/main/opencode/manager'

const TEST_MODEL = { providerID: 'opencode', modelID: 'nemotron-3.5-lightning-free' } as const

describe('OpenCode GUI protocol helpers', () => {
  it('normalizes native OpenCode directory spellings before matching', () => {
    expect(normalizeOpenCodeDirectory('/workspace/app/')).toBe('/workspace/app')
    expect(normalizeOpenCodeDirectory('/workspace/app\\nested')).toBe('/workspace/app/nested')
    expect(normalizeOpenCodeDirectory('C:\\Work\\App\\')).toBe('c:/work/app')
  })
  it('uses the explicitly selected model and does not apply a production default', () => {
    expect(createPromptBody('Reply only with pong', TEST_MODEL)).toEqual({
      model: { providerID: 'opencode', modelID: 'nemotron-3.5-lightning-free' },
      parts: [{ type: 'text', text: 'Reply only with pong' }]
    })
    expect(
      createPromptBody('Use the high effort variant', {
        providerID: 'anthropic',
        modelID: 'claude-sonnet',
        variant: 'high'
      })
    ).toEqual({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet', variant: 'high' },
      parts: [{ type: 'text', text: 'Use the high effort variant' }]
    })
  })

  it('normalizes providers, models, and model variants for the picker', () => {
    expect(
      normalizeOpenCodeModels({
        providers: [
          {
            id: 'cloud',
            name: 'Cloud Provider',
            models: {
              'model-a': { name: 'Model A', reasoning: true, variants: { fast: {}, deep: {} } },
              'model-b': { name: 'Model B' }
            }
          },
          { id: 'broken', models: { ignored: null } }
        ]
      })
    ).toEqual([
      {
        key: 'cloud/model-a',
        providerID: 'cloud',
        providerName: 'Cloud Provider',
        modelID: 'model-a',
        modelName: 'Model A',
        reasoning: true
      },
      {
        key: 'cloud/model-a#deep',
        providerID: 'cloud',
        providerName: 'Cloud Provider',
        modelID: 'model-a',
        modelName: 'Model A · deep',
        reasoning: true,
        variant: 'deep'
      },
      {
        key: 'cloud/model-a#fast',
        providerID: 'cloud',
        providerName: 'Cloud Provider',
        modelID: 'model-a',
        modelName: 'Model A · fast',
        reasoning: true,
        variant: 'fast'
      },
      {
        key: 'cloud/model-b',
        providerID: 'cloud',
        providerName: 'Cloud Provider',
        modelID: 'model-b',
        modelName: 'Model B'
      }
    ])
  })

  it('uses the regular OpenCode config while retaining pure server startup', () => {
    const launch = createOpenCodeLaunch('/workspace', {
      OPENCODE_CONFIG: '/tmp/opencode.json',
      OPENCODE_CONFIG_DIR: '/tmp/config',
      OPENCODE_CONFIG_CONTENT: '{"permission":{"bash":"ask"}}'
    })
    expect(launch.args).toEqual(['serve', '--pure', '--hostname=127.0.0.1', '--port=0'])
    expect(launch.options.cwd).toBe('/workspace')
    expect(launch.options.env).toMatchObject({
      OPENCODE_CONFIG: '/tmp/opencode.json',
      OPENCODE_CONFIG_DIR: '/tmp/config',
      OPENCODE_CONFIG_CONTENT: '{"permission":{"bash":"ask"}}'
    })
  })

  it('finds the localhost URL emitted by opencode serve', () => {
    expect(parseServerUrl('booting\nopencode server listening on http://127.0.0.1:43123\n')).toBe(
      'http://127.0.0.1:43123'
    )
    expect(parseServerUrl('booting')).toBeNull()
  })

  it('keeps only visible text parts from an assistant response', () => {
    expect(
      extractTextParts([
        { type: 'reasoning', text: 'hidden chain of thought' },
        { type: 'text', text: 'First paragraph' },
        { type: 'text', text: 'ignored', ignored: true },
        { type: 'text', text: 'Second paragraph' }
      ])
    ).toBe('First paragraph\nSecond paragraph')
  })

  it('describes response parts when OpenCode has no visible text', () => {
    expect(describeResponseParts([{ type: 'reasoning' }, { type: 'tool' }, { type: 'step-finish' }])).toBe(
      'reasoning, tool, step-finish'
    )
    expect(describeResponseParts([])).toBe('none')
    expect(describeResponseParts(undefined)).toBe('none')
  })

  it('extracts reasoning and tool calls from the current turn, in order', () => {
    expect(
      extractTurnItems(
        [
          {
            info: { id: 'old-assistant', parentID: 'old-user', role: 'assistant' },
            parts: [
              {
                id: 'old-tool',
                type: 'tool',
                tool: 'read',
                state: { status: 'completed', input: { filePath: '/old' }, output: 'old output' }
              }
            ]
          },
          {
            info: { id: 'tool-assistant', parentID: 'current-user', role: 'assistant' },
            parts: [
              {
                id: 'current-reasoning',
                type: 'reasoning',
                text: '  I should list the workspace first.  ',
                time: { start: 1_000, end: 3_500 }
              },
              {
                id: 'current-tool',
                type: 'tool',
                tool: 'read',
                state: {
                  status: 'completed',
                  input: { filePath: '/workspace' },
                  output: 'file listing',
                  title: 'List directory'
                }
              },
              { id: 'empty-reasoning', type: 'reasoning', text: '   ' }
            ]
          },
          {
            info: { id: 'final-assistant', parentID: 'current-user', role: 'assistant' },
            parts: [{ id: 'final-text', type: 'text', text: 'Here are the files.' }]
          }
        ],
        'current-user',
        'final-assistant'
      )
    ).toEqual([
      {
        id: 'current-reasoning',
        role: 'reasoning',
        text: 'I should list the workspace first.',
        durationMs: 2_500
      },
      {
        id: 'current-tool',
        role: 'tool',
        tool: 'read',
        status: 'completed',
        input: { filePath: '/workspace' },
        title: 'List directory',
        output: 'file listing'
      }
    ])
  })

  it('keeps reasoning attached to the final assistant message', () => {
    expect(
      extractReasoningMessages([
        { id: 'r1', type: 'reasoning', text: 'Now I can answer.', time: { start: 10 } },
        { id: 'r2', type: 'reasoning', text: '' },
        { type: 'reasoning', text: 'no id' },
        { id: 't1', type: 'text', text: 'Here are the files.' }
      ])
    ).toEqual([{ id: 'r1', role: 'reasoning', text: 'Now I can answer.' }])
    expect(extractReasoningMessages(undefined)).toEqual([])
  })

  it('converts an existing OpenCode history into ordered GUI items', () => {
    expect(
      extractHistoryMessages([
        {
          info: { id: 'user-1', role: 'user' },
          parts: [{ id: 'user-part', type: 'text', text: 'List the files.' }]
        },
        {
          info: { id: 'assistant-1', role: 'assistant' },
          parts: [
            { id: 'reasoning-1', type: 'reasoning', text: 'I should inspect the folder.' },
            {
              id: 'tool-1',
              type: 'tool',
              tool: 'list',
              state: { status: 'completed', input: { path: '.' }, output: 'README.md' }
            },
            { id: 'text-1', type: 'text', text: 'The folder contains README.md.' }
          ]
        }
      ])
    ).toEqual([
      { id: 'user-1', role: 'user', text: 'List the files.' },
      { id: 'reasoning-1', role: 'reasoning', text: 'I should inspect the folder.' },
      {
        id: 'tool-1',
        role: 'tool',
        tool: 'list',
        status: 'completed',
        input: { path: '.' },
        output: 'README.md'
      },
      { id: 'text-1', role: 'assistant', text: 'The folder contains README.md.' }
    ])
  })

  it('hides the reverted turn while preserving earlier history', () => {
    const history = [
      {
        info: { id: 'user-1', role: 'user' },
        parts: [{ id: 'user-1-part', type: 'text', text: 'First prompt' }]
      },
      {
        info: { id: 'assistant-1', role: 'assistant' },
        parts: [{ id: 'assistant-1-part', type: 'text', text: 'First answer' }]
      },
      {
        info: { id: 'user-2', role: 'user' },
        parts: [{ id: 'user-2-part', type: 'text', text: 'Second prompt' }]
      },
      {
        info: { id: 'assistant-2', role: 'assistant' },
        parts: [{ id: 'assistant-2-part', type: 'text', text: 'Second answer' }]
      }
    ]

    expect(extractHistoryMessages(history, { messageID: 'user-2' })).toEqual([
      { id: 'user-1', role: 'user', text: 'First prompt' },
      { id: 'assistant-1-part', role: 'assistant', text: 'First answer' }
    ])
  })
})

describe('OpenCode event stream', () => {
  it('splits complete SSE frames and keeps the partial tail', () => {
    const first = parseSseFrames('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    expect(first.events).toEqual(['{"a":1}', '{"b":2}'])
    expect(first.rest).toBe('data: {"c"')

    // The tail completes once the rest of the frame arrives.
    expect(parseSseFrames(`${first.rest}:3}\n\n`).events).toEqual(['{"c":3}'])
    expect(parseSseFrames('event: ping\r\ndata: {"d":4}\r\n\r\n').events).toEqual(['{"d":4}'])
    expect(parseSseFrames(': comment only\n\n').events).toEqual([])
  })

  it('streams text deltas while ignoring reasoning from the same message', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    const delta = (partID: string, text: string): unknown => ({
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', messageID: 'msg_1', partID, field: 'text', delta: text }
    })
    const opened = (id: string, type: string): unknown => ({
      type: 'message.part.updated',
      properties: { part: { id, sessionID: 'ses_1', type, text: '' } }
    })

    // A reasoning part streams through the same `field: "text"` shape.
    expect(tracker.accept(opened('prt_reasoning', 'reasoning'))).toEqual({
      kind: 'reasoning',
      partId: 'prt_reasoning',
      delta: '',
      done: false
    })
    expect(tracker.accept(delta('prt_reasoning', 'thinking out loud'))).toEqual({
      kind: 'reasoning',
      partId: 'prt_reasoning',
      delta: 'thinking out loud',
      done: false
    })

    expect(tracker.accept(opened('prt_text', 'text'))).toBeNull()
    expect(tracker.accept(delta('prt_text', 'Hello'))).toEqual({ kind: 'text', partId: 'prt_text', delta: 'Hello' })
    expect(tracker.accept(delta('prt_text', ' world'))).toEqual({
      kind: 'text',
      partId: 'prt_text',
      delta: ' world'
    })

    // A second text part is a separate block of the reply.
    expect(tracker.accept(opened('prt_text2', 'text'))).toBeNull()
    expect(tracker.accept(delta('prt_text2', 'Second'))).toEqual({
      kind: 'text',
      partId: 'prt_text2',
      delta: '\n\nSecond'
    })
  })

  it('ignores events from other sessions and unknown parts', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: { part: { id: 'prt_x', sessionID: 'ses_other', type: 'text' } }
      })
    ).toBeNull()
    expect(
      tracker.accept({
        type: 'message.part.delta',
        properties: { sessionID: 'ses_other', partID: 'prt_x', field: 'text', delta: 'nope' }
      })
    ).toBeNull()
    // Never announced, so its kind is unknown and it cannot be assumed to be text.
    expect(
      tracker.accept({
        type: 'message.part.delta',
        properties: { sessionID: 'ses_1', partID: 'prt_unseen', field: 'text', delta: 'nope' }
      })
    ).toBeNull()
    expect(tracker.accept({ type: 'session.idle', properties: { sessionID: 'ses_1' } })).toEqual({
      kind: 'status',
      status: 'idle'
    })
    expect(tracker.accept(null)).toBeNull()
  })

  it('accepts incremental text carried by a part-updated event', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: {
          part: { id: 'prt_text', sessionID: 'ses_1', type: 'text', text: 'Hello' },
          delta: 'Hello'
        }
      })
    ).toEqual({ kind: 'text', partId: 'prt_text', delta: 'Hello' })
  })

  it('deduplicates cumulative snapshots and streams reasoning updates live', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    const update = (text: string, delta?: string): unknown => ({
      type: 'message.part.updated',
      properties: {
        part: { id: 'prt_reasoning', sessionID: 'ses_1', type: 'reasoning', text, time: { start: 100 } },
        ...(delta === undefined ? {} : { delta })
      }
    })

    expect(tracker.accept(update('Thinking'))).toEqual({
      kind: 'reasoning',
      partId: 'prt_reasoning',
      delta: 'Thinking',
      done: false
    })
    expect(tracker.accept(update('Thinking more', ' more'))).toEqual({
      kind: 'reasoning',
      partId: 'prt_reasoning',
      delta: ' more',
      done: false
    })
    expect(tracker.accept(update('Thinking more', ' more'))).toBeNull()
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'prt_reasoning',
            sessionID: 'ses_1',
            type: 'reasoning',
            text: 'Thinking more',
            time: { start: 100, end: 350 }
          }
        }
      })
    ).toEqual({ kind: 'reasoning', partId: 'prt_reasoning', delta: '', done: true, durationMs: 250 })
  })

  it('streams tool lifecycle snapshots including raw input and output', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    const tool = (state: Record<string, unknown>): unknown => ({
      type: 'message.part.updated',
      properties: {
        part: { id: 'prt_tool', sessionID: 'ses_1', type: 'tool', tool: 'read', state }
      }
    })

    expect(tracker.accept(tool({ status: 'pending', input: {}, raw: '{"filePath":"/tmp/a"}' }))).toEqual({
      kind: 'tool',
      partId: 'prt_tool',
      tool: 'read',
      status: 'pending',
      input: {},
      rawInput: '{"filePath":"/tmp/a"}'
    })
    expect(
      tracker.accept(
        tool({ status: 'running', input: { filePath: '/tmp/a' }, title: 'Read file', time: { start: 100 } })
      )
    ).toEqual({
      kind: 'tool',
      partId: 'prt_tool',
      tool: 'read',
      status: 'running',
      input: { filePath: '/tmp/a' },
      title: 'Read file'
    })
    expect(
      tracker.accept(
        tool({
          status: 'completed',
          input: { filePath: '/tmp/a' },
          title: 'Read file',
          output: 'contents',
          time: { start: 100, end: 250 }
        })
      )
    ).toEqual({
      kind: 'tool',
      partId: 'prt_tool',
      tool: 'read',
      status: 'completed',
      input: { filePath: '/tmp/a' },
      title: 'Read file',
      output: 'contents',
      durationMs: 150
    })
  })

  it('tracks foreground and nested subagents from Task metadata and child status events', () => {
    const tracker = new OpenCodeStreamTracker('root')
    const task = (sessionID: string, id: string, childSessionId: string, description: string): unknown => ({
      type: 'message.part.updated',
      properties: {
        part: {
          id,
          sessionID,
          type: 'tool',
          tool: 'task',
          state: {
            status: 'running',
            title: description,
            input: { description, subagent_type: 'explore' },
            metadata: { sessionId: childSessionId, parentSessionId: sessionID }
          }
        }
      }
    })

    expect(tracker.accept(task('root', 'task-1', 'child-1', 'Inspect the codebase'))).toMatchObject({
      kind: 'subagent',
      subagent: {
        id: 'child-1',
        taskId: 'task-1',
        description: 'Inspect the codebase',
        agent: 'explore',
        status: 'working'
      }
    })
    expect(tracker.accept(task('child-1', 'task-2', 'child-2', 'Inspect the tests'))).toMatchObject({
      kind: 'subagent',
      subagent: { id: 'child-2', parentSubagentId: 'child-1', status: 'working' }
    })
    expect(
      tracker.accept({
        type: 'session.status',
        properties: { sessionID: 'child-1', status: { type: 'busy' } }
      })
    ).toMatchObject({ kind: 'subagent', subagent: { id: 'child-1', status: 'working' } })
    expect(
      tracker.accept({ type: 'session.status', properties: { sessionID: 'child-1', status: { type: 'idle' } } })
    ).toMatchObject({ kind: 'subagent', subagent: { id: 'child-1', status: 'completed' } })
    expect(
      tracker.accept({ type: 'session.idle', properties: { sessionID: 'child-2' } })
    ).toMatchObject({ kind: 'subagent', subagent: { id: 'child-2', status: 'completed' } })
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: { part: { id: 'child-text', sessionID: 'child-1', type: 'text', text: 'hidden child output' } }
      })
    ).toBeNull()
  })

  it('keeps background subagents working until the child session becomes idle', () => {
    const tracker = new OpenCodeStreamTracker('root')
    const state = (status: string): unknown => ({
      status,
      input: { description: 'Run the audit', subagent_type: 'review' },
      metadata: { sessionId: 'background-child', parentSessionId: 'root', background: true }
    })
    const event = (status: string): unknown => ({
      type: 'message.part.updated',
      properties: { part: { id: 'task-background', sessionID: 'root', type: 'tool', tool: 'task', state: state(status) } }
    })

    expect(tracker.accept(event('running'))).toMatchObject({
      kind: 'subagent',
      subagent: { id: 'background-child', status: 'working', background: true }
    })
    expect(tracker.accept(event('completed'))).toMatchObject({
      kind: 'subagent',
      subagent: { id: 'background-child', status: 'working', background: true }
    })
    expect(
      tracker.accept({
        type: 'session.status',
        properties: { sessionID: 'background-child', status: { type: 'idle' } }
      })
    ).toMatchObject({ kind: 'subagent', subagent: { id: 'background-child', status: 'completed' } })
  })

  it('normalizes permission requests and ignores other sessions', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    expect(
      tracker.accept({
        type: 'permission.asked',
        properties: {
          requestID: 'permission-1',
          sessionID: 'ses_1',
          permission: 'bash',
          patterns: ['git status *'],
          title: 'Inspect the repository'
        }
      })
    ).toEqual({
      kind: 'permission',
      requestId: 'permission-1',
      permission: 'bash',
      patterns: ['git status *'],
      title: 'Inspect the repository'
    })
    expect(
      tracker.accept({
        type: 'permission.updated',
        properties: {
          id: 'permission-2',
          sessionID: 'ses_1',
          type: 'read',
          pattern: '/workspace/**'
        }
      })
    ).toEqual({
      kind: 'permission',
      requestId: 'permission-2',
      permission: 'read',
      patterns: ['/workspace/**']
    })
    expect(
      tracker.accept({
        type: 'permission.asked',
        properties: {
          requestID: 'other-permission',
          sessionID: 'ses_other',
          permission: 'bash',
          patterns: ['rm -rf /']
        }
      })
    ).toBeNull()
  })

  it('marks child sessions waiting for permission and resumes them after a reply', () => {
    const tracker = new OpenCodeStreamTracker('root')
    tracker.accept({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'task-1',
          sessionID: 'root',
          type: 'tool',
          tool: 'task',
          state: {
            status: 'running',
            input: { description: 'Check the repository', subagent_type: 'explore' },
            metadata: { sessionId: 'child-1' }
          }
        }
      }
    })

    expect(
      tracker.accept({
        type: 'permission.asked',
        properties: {
          requestID: 'child-permission',
          sessionID: 'child-1',
          permission: 'bash',
          patterns: ['git status']
        }
      })
    ).toMatchObject({
      kind: 'subagent',
      subagent: { id: 'child-1', status: 'waiting' },
      permission: { requestId: 'child-permission', permission: 'bash' }
    })
    expect(
      tracker.accept({
        type: 'permission.replied',
        properties: { permissionID: 'child-permission', sessionID: 'child-1', response: 'once' }
      })
    ).toMatchObject({
      kind: 'subagent',
      subagent: { id: 'child-1', status: 'working' },
      permissionResolved: 'child-permission'
    })
  })

  it('accepts the global event envelope used by the OpenCode event endpoint', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    expect(
      tracker.accept({
        directory: '/tmp',
        payload: {
          type: 'message.part.updated',
          properties: {
            part: { id: 'prt_text', sessionID: 'ses_1', type: 'text', text: 'Hello' }
          }
        }
      })
    ).toEqual({ kind: 'text', partId: 'prt_text', delta: 'Hello' })
  })

  it('does not stream the user prompt as assistant text', () => {
    const tracker = new OpenCodeStreamTracker('ses_1')
    expect(
      tracker.accept({
        type: 'message.updated',
        properties: { info: { id: 'msg_user', sessionID: 'ses_1', role: 'user' } }
      })
    ).toBeNull()
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_user',
            sessionID: 'ses_1',
            messageID: 'msg_user',
            type: 'text',
            text: 'please list the contents of this directory'
          }
        }
      })
    ).toBeNull()

    tracker.accept({
      type: 'message.updated',
      properties: { info: { id: 'msg_assistant', sessionID: 'ses_1', role: 'assistant' } }
    })
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_assistant',
            sessionID: 'ses_1',
            messageID: 'msg_assistant',
            type: 'text',
            text: 'Here are the files.'
          }
        }
      })
    ).toEqual({ kind: 'text', partId: 'part_assistant', delta: 'Here are the files.' })
  })
})
