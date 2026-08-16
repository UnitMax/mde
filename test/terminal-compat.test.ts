import { describe, expect, it } from 'vitest'
import { terminalSizeAction } from '../src/renderer/terminal/terminal-compat'

describe('terminal compatibility', () => {
  it('waits until the terminal can be measured before ensuring the PTY', () => {
    expect(terminalSizeAction(null, false, null)).toEqual({ type: 'wait' })
    expect(terminalSizeAction({ cols: 140, rows: 42 }, false, null)).toEqual({
      type: 'ensure',
      size: { cols: 140, rows: 42 }
    })
  })

  it('resizes only after the measured dimensions change', () => {
    const size = { cols: 140, rows: 42 }
    expect(terminalSizeAction(size, true, size)).toEqual({ type: 'wait' })
    expect(terminalSizeAction({ cols: 141, rows: 42 }, true, size)).toEqual({
      type: 'resize',
      size: { cols: 141, rows: 42 }
    })
  })
})
