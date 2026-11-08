import { describe, expect, it } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { inboxTerminalHighlightTone } from '../src/renderer/lib/inbox-terminal-highlight'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Review tests', mode: 'terminal', folderId: 'fld_app', directory: '/workspace/app',
    target: { kind: 'native' }, branch: 'main', status: 'working', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false,
    ...overrides,
  }
}

describe('Inbox Terminal chat highlights', () => {
  it.each([
    ['attention', 'attention'], ['completed', 'done'], ['error', 'error'],
  ] as const)('animates an API transition to %s in the %s tone', (status, tone) => {
    expect(inboxTerminalHighlightTone(thread(), thread({ status }))).toBe(tone)
  })

  it('keeps the first report quiet, including threads already done when MDE starts', () => {
    expect(inboxTerminalHighlightTone(undefined, thread({ status: 'completed' }))).toBeNull()
  })

  it.each([undefined, 'gui'] as const)('ignores GUI threads with mode %s', (mode) => {
    expect(inboxTerminalHighlightTone(thread({ mode }), thread({ mode, status: 'completed' }))).toBeNull()
  })

  it('ignores duplicate, title, branch, pin and read updates', () => {
    const completed = thread({ status: 'completed' })
    expect(inboxTerminalHighlightTone(completed, completed)).toBeNull()
    expect(inboxTerminalHighlightTone(completed, {
      ...completed, title: 'New title', branch: 'feature', pinned: true, readAt: 2,
    })).toBeNull()
  })

  it('animates a new request or completion even when the status name stays the same', () => {
    const attention = thread({ status: 'attention', attentionReason: 'permission' })
    expect(inboxTerminalHighlightTone(attention, { ...attention, attentionReason: 'question' })).toBe('attention')
    expect(inboxTerminalHighlightTone(attention, { ...attention, lastActivityAt: 2 })).toBe('attention')
    const completed = thread({ status: 'completed' })
    expect(inboxTerminalHighlightTone(completed, { ...completed, lastActivityAt: 2 })).toBe('done')
  })

  it('stays quiet when work starts or the thread becomes idle', () => {
    expect(inboxTerminalHighlightTone(thread({ status: 'attention' }), thread())).toBeNull()
    expect(inboxTerminalHighlightTone(thread(), thread({ status: 'idle' }))).toBeNull()
  })
})
