// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FANCY_SETTINGS,
  FANCY_BACKGROUNDS,
  FANCY_BACKGROUND_OPTIONS,
  FANCY_SETTINGS_STORAGE_KEY,
  getFancySettings,
  isFancyBackgroundId,
  resolveFancySettings,
  saveFancySettings
} from '../src/renderer/fancy/settings'
import { useFancyMode } from '../src/renderer/store/fancy-mode'

beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  useFancyMode.setState({ settings: DEFAULT_FANCY_SETTINGS })
})

describe('fancy mode settings', () => {
  it('is off by default, with the aurora chosen and the thread effects ready', () => {
    expect(DEFAULT_FANCY_SETTINGS).toEqual({ enabled: false, background: 'aurora', threadEffects: true })
    expect(getFancySettings()).toEqual(DEFAULT_FANCY_SETTINGS)
  })

  it('offers three backgrounds, each described', () => {
    expect(FANCY_BACKGROUNDS).toEqual(['aurora', 'constellation', 'contours'])
    expect(FANCY_BACKGROUND_OPTIONS.map((option) => option.id)).toEqual([...FANCY_BACKGROUNDS])
    for (const option of FANCY_BACKGROUND_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.endsWith('.')).toBe(true)
    }
    expect(isFancyBackgroundId('contours')).toBe(true)
    expect(isFancyBackgroundId('plasma')).toBe(false)
    expect(isFancyBackgroundId(3)).toBe(false)
  })

  it('keeps a default for every field that is missing or of the wrong type', () => {
    expect(resolveFancySettings(null)).toEqual(DEFAULT_FANCY_SETTINGS)
    expect(resolveFancySettings('on')).toEqual(DEFAULT_FANCY_SETTINGS)
    expect(resolveFancySettings({ enabled: true })).toEqual({ ...DEFAULT_FANCY_SETTINGS, enabled: true })
    expect(resolveFancySettings({ enabled: 'yes', background: 'plasma', threadEffects: 0 })).toEqual(DEFAULT_FANCY_SETTINGS)
    expect(resolveFancySettings({ enabled: true, background: 'contours', threadEffects: false })).toEqual({
      enabled: true,
      background: 'contours',
      threadEffects: false
    })
  })

  it('is read back from local storage, and corrupt storage gives the defaults', () => {
    saveFancySettings({ enabled: true, background: 'constellation', threadEffects: false })
    expect(JSON.parse(localStorage.getItem(FANCY_SETTINGS_STORAGE_KEY)!)).toEqual({
      enabled: true,
      background: 'constellation',
      threadEffects: false
    })
    expect(getFancySettings()).toEqual({ enabled: true, background: 'constellation', threadEffects: false })

    localStorage.setItem(FANCY_SETTINGS_STORAGE_KEY, '{not json')
    expect(getFancySettings()).toEqual(DEFAULT_FANCY_SETTINGS)
  })

  it('is changed through the store, which keeps each change', () => {
    useFancyMode.getState().update({ enabled: true })
    useFancyMode.getState().update({ background: 'contours' })
    expect(useFancyMode.getState().settings).toEqual({ enabled: true, background: 'contours', threadEffects: true })
    expect(getFancySettings()).toEqual({ enabled: true, background: 'contours', threadEffects: true })
  })
})
