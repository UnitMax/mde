import { describe, expect, it } from 'vitest'
import {
  NEMOTRON_MODEL,
  createPromptBody,
  describeResponseParts,
  extractReasoningMessages,
  extractTurnItems,
  extractTextParts,
  OPENCODE_INLINE_CONFIG,
  parseServerUrl
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
