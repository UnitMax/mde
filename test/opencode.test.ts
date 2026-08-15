import { describe, expect, it } from 'vitest'
import {
  BIG_PICKLE_MODEL,
  createPromptBody,
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

  it('starts OpenCode in text-only mode with every tool permission denied', () => {
    expect(OPENCODE_INLINE_CONFIG).toEqual({ permission: 'deny' })
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
})
