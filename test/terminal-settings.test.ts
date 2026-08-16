import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultTerminalSettings,
  getTerminalSettings,
  LEGACY_TERMINAL_FONT_STORAGE_KEY,
  listTerminalFonts,
  resolveTerminalSettings,
  saveTerminalSettings,
  TERMINAL_FONT_SIZES,
  TERMINAL_SETTINGS_STORAGE_KEY,
  TERMINAL_LINE_HEIGHTS,
  xtermFontFamily
} from '../src/renderer/terminal/terminal-settings'

function createStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('terminal settings', () => {
  const available = listTerminalFonts((family) => family === 'JetBrains Mono')

  it('keeps the curated list limited to installed fonts and includes the system fallback', () => {
    expect(available.map((option) => option.family)).toEqual(['JetBrains Mono', 'monospace'])
  })

  it('uses the first available font, current size, and current line height as defaults', () => {
    expect(defaultTerminalSettings(available)).toEqual({
      family: 'JetBrains Mono',
      size: 13,
      lineHeight: 1
    })
  })

  it('rejects unavailable families, unsupported sizes, and unsupported line heights', () => {
    expect(resolveTerminalSettings({ family: 'Missing Font', size: 99, lineHeight: 2 }, available)).toEqual({
      family: 'JetBrains Mono',
      size: 13,
      lineHeight: 1
    })
    expect(
      resolveTerminalSettings(
        { family: 'monospace', size: TERMINAL_FONT_SIZES[3], lineHeight: TERMINAL_LINE_HEIGHTS[4] },
        available
      )
    ).toEqual({ family: 'monospace', size: 14, lineHeight: 1.4 })
  })

  it('loads legacy font settings and supplies the line-height default', () => {
    vi.stubGlobal(
      'localStorage',
      createStorage({
        [LEGACY_TERMINAL_FONT_STORAGE_KEY]: JSON.stringify({ family: 'monospace', size: 14 })
      })
    )

    expect(getTerminalSettings()).toEqual({ family: 'monospace', size: 14, lineHeight: 1 })
  })

  it('saves complete settings under the new storage key', () => {
    const storage = createStorage()
    vi.stubGlobal('localStorage', storage)
    const settings = { family: 'monospace', size: 14, lineHeight: 1.4 }

    saveTerminalSettings(settings)

    expect(storage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)).toBe(JSON.stringify(settings))
  })

  it('builds an xterm family with a monospace fallback', () => {
    expect(xtermFontFamily('JetBrains Mono')).toBe('"JetBrains Mono", monospace')
    expect(xtermFontFamily('monospace')).toBe('monospace')
  })
})
