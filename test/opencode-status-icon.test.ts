import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiStatus } from '../src/shared/types'
import {
  OPENCODE_STATUS_ICON_SLOT_CLASS,
  openCodeStatusIconLayout
} from '../src/renderer/lib/opencode-tui-status'

const statuses: OpenCodeTuiStatus[] = ['working', 'attention', 'completed', 'idle', 'error']

describe('OpenCode status icon', () => {
  it('keeps every state in the same fixed-width slot', () => {
    statuses.forEach((status) => {
      expect(openCodeStatusIconLayout(status).slotClassName).toBe(OPENCODE_STATUS_ICON_SLOT_CLASS)
    })
  })

  it('keeps active glyphs larger than centered dot indicators', () => {
    expect(openCodeStatusIconLayout('working').glyphClassName).toBe('h-2.5 w-2.5')
    expect(openCodeStatusIconLayout('attention').glyphClassName).toBe('h-2.5 w-2.5')
    expect(openCodeStatusIconLayout('completed').glyphClassName).toBe('h-1.5 w-1.5')
    expect(openCodeStatusIconLayout('idle').glyphClassName).toBe('h-1.5 w-1.5')
    expect(openCodeStatusIconLayout('error').glyphClassName).toBe('h-1.5 w-1.5')
  })
})
