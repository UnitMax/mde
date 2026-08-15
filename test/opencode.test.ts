import { describe, expect, it } from 'vitest'
import {
  BIG_PICKLE_MODEL,
  createPromptBody,
  describeResponseParts,
  extractTextParts,
  OPENCODE_INLINE_CONFIG,
  parseServerUrl
} from '../src/main/opencode/manager'

describe('OpenCode GUI protocol helpers', () => {
  it('locks every prompt to the free OpenCode Zen Big Pickle model', () => {
    expect(BIG_PICKLE_MODEL).toEqual({ providerID: 'opencode', modelID: 'big-pickle' })
    expect(createPromptBody('Reply only with pong')).toEqual({
      model: { providerID: 'opencode', modelID: 'big-pickle' },
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
})
