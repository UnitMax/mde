import { describe, expect, it } from 'vitest'
import {
  NEMOTRON_MODEL,
  createPromptBody,
  describeResponseParts,
  extractReasoningMessages,
  extractTurnItems,
  extractTextParts,
  OPENCODE_INLINE_CONFIG,
  OpenCodeStreamTracker,
  parseServerUrl,
  parseSseFrames
} from '../src/main/opencode/manager'

describe('OpenCode GUI protocol helpers', () => {
  it('locks every prompt to the free OpenCode Zen Nemotron 3.5 Lightning model', () => {
    expect(NEMOTRON_MODEL).toEqual({ providerID: 'opencode', modelID: 'nemotron-3.5-lightning-free' })
    expect(createPromptBody('Reply only with pong')).toEqual({
      model: { providerID: 'opencode', modelID: 'nemotron-3.5-lightning-free' },
      parts: [{ type: 'text', text: 'Reply only with pong' }]
    })
  })

  it('starts OpenCode with read-only workspace tools enabled', () => {
    expect(OPENCODE_INLINE_CONFIG).toEqual({
      permission: {
        '*': 'deny',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        external_directory: 'deny'
      }
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
    expect(tracker.accept({ type: 'session.idle', properties: { sessionID: 'ses_1' } })).toBeNull()
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
