import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDarkColor } from '../src/main/window-chrome'
import { syncWindowChrome, windowChromeColors } from '../src/renderer/lib/window-chrome'
import { APPLICATION_THEMES, getApplicationTheme } from '../src/renderer/theme/themes'

const hex = /^#[0-9a-fA-F]{6}$/

describe('windowChromeColors', () => {
  it.each(APPLICATION_THEMES.map((theme) => theme.id))('tints the native buttons for %s', (id) => {
    const { panel, fgMuted } = getApplicationTheme(id).application
    const colors = windowChromeColors(id)

    expect(colors).toEqual({ color: panel, symbolColor: fgMuted })
    expect(colors.color).toMatch(hex)
    expect(colors.symbolColor).toMatch(hex)
  })

  it.each(APPLICATION_THEMES.map((theme) => theme.id))(
    'keeps the native theme dark for %s, so the button hover wash is visible',
    (id) => {
      expect(isDarkColor(windowChromeColors(id).color)).toBe(true)
    }
  )
})

describe('syncWindowChrome', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the theme colors to the main process', () => {
    const set = vi.fn(async () => undefined)
    vi.stubGlobal('window', { api: { windowChrome: { set } } })

    syncWindowChrome('ember')

    expect(set).toHaveBeenCalledWith(windowChromeColors('ember'))
  })

  it('swallows a rejected request', async () => {
    const set = vi.fn(async () => { throw new Error('rejected') })
    vi.stubGlobal('window', { api: { windowChrome: { set } } })

    expect(() => syncWindowChrome('slate')).not.toThrow()
    await Promise.resolve()
    expect(set).toHaveBeenCalledOnce()
  })

  it('does nothing without a preload bridge', () => {
    expect(() => syncWindowChrome('slate')).not.toThrow()
  })
})
