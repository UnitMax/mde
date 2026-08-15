import { describe, expect, it } from 'vitest'
import {
  NEMOTRON_MODEL,
  createPromptBody,
  describeResponseParts,
  extractReasoningMessages,
  extractTurnItems,
  extractTextParts,
  OPENCODE_INLINE_CONFIG,
  parseServerUrl,
  parseSseFrames,
  TextDeltaTracker
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
    const tracker = new TextDeltaTracker('ses_1')
    const delta = (partID: string, text: string): unknown => ({
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', messageID: 'msg_1', partID, field: 'text', delta: text }
    })
    const opened = (id: string, type: string): unknown => ({
      type: 'message.part.updated',
      properties: { part: { id, sessionID: 'ses_1', type, text: '' } }
    })

    // A reasoning part streams through the same `field: "text"` shape.
    expect(tracker.accept(opened('prt_reasoning', 'reasoning'))).toBeNull()
    expect(tracker.accept(delta('prt_reasoning', 'thinking out loud'))).toBeNull()

    expect(tracker.accept(opened('prt_text', 'text'))).toBeNull()
    expect(tracker.accept(delta('prt_text', 'Hello'))).toBe('Hello')
    expect(tracker.accept(delta('prt_text', ' world'))).toBe(' world')

    // A second text part is a separate block of the reply.
    expect(tracker.accept(opened('prt_text2', 'text'))).toBeNull()
    expect(tracker.accept(delta('prt_text2', 'Second'))).toBe('\n\nSecond')
  })

  it('ignores events from other sessions and unknown parts', () => {
    const tracker = new TextDeltaTracker('ses_1')
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
    const tracker = new TextDeltaTracker('ses_1')
    expect(
      tracker.accept({
        type: 'message.part.updated',
        properties: {
          part: { id: 'prt_text', sessionID: 'ses_1', type: 'text', text: 'Hello' },
          delta: 'Hello'
        }
      })
    ).toBe('Hello')
  })
})
