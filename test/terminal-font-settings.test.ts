import { describe, expect, it } from 'vitest'
import {
  defaultTerminalFontSettings,
  listTerminalFonts,
  resolveTerminalFontSettings,
  TERMINAL_FONT_SIZES,
  xtermFontFamily
} from '../src/renderer/terminal/font-settings'

describe('terminal font settings', () => {
  const available = listTerminalFonts((family) => family === 'JetBrains Mono')

  it('keeps the curated list limited to installed fonts and includes the system fallback', () => {
    expect(available.map((option) => option.family)).toEqual(['JetBrains Mono', 'monospace'])
  })

  it('uses the first available font and the current size as defaults', () => {
    expect(defaultTerminalFontSettings(available)).toEqual({ family: 'JetBrains Mono', size: 13 })
  })

  it('rejects unavailable families and unsupported sizes', () => {
    expect(resolveTerminalFontSettings({ family: 'Missing Font', size: 99 }, available)).toEqual({
      family: 'JetBrains Mono',
      size: 13
    })
    expect(resolveTerminalFontSettings({ family: 'monospace', size: TERMINAL_FONT_SIZES[3] }, available)).toEqual({
      family: 'monospace',
      size: 14
    })
  })

  it('builds an xterm family with a monospace fallback', () => {
    expect(xtermFontFamily('JetBrains Mono')).toBe('"JetBrains Mono", monospace')
    expect(xtermFontFamily('monospace')).toBe('monospace')
  })
})
