import { describe, expect, it } from 'vitest'
import {
  adjustZoomFactor,
  DEFAULT_ZOOM_FACTOR,
  getZoomAction,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR
} from '../src/main/zoom'

function input(overrides: Partial<Parameters<typeof getZoomAction>[0]> = {}) {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    control: true,
    meta: false,
    alt: false,
    ...overrides
  }
}

describe('getZoomAction', () => {
  it('recognises control plus and minus in browser keyboard events', () => {
    expect(getZoomAction(input({ key: '+' }))).toBe('in')
    expect(getZoomAction(input({ key: '=' }))).toBe('in')
    expect(getZoomAction(input({ code: 'Equal' }))).toBe('in')
    expect(getZoomAction(input({ key: '-' }))).toBe('out')
    expect(getZoomAction(input({ key: '_' }))).toBe('out')
    expect(getZoomAction(input({ code: 'Minus' }))).toBe('out')
  })

  it('recognises the numeric keypad and reset shortcuts', () => {
    expect(getZoomAction(input({ code: 'NumpadAdd' }))).toBe('in')
    expect(getZoomAction(input({ code: 'NumpadSubtract' }))).toBe('out')
    expect(getZoomAction(input({ key: '0' }))).toBe('reset')
    expect(getZoomAction(input({ code: 'Numpad0' }))).toBe('reset')
  })

  it('supports command on macOS and ignores unrelated modifiers/events', () => {
    expect(getZoomAction(input({ control: false, meta: true, key: '+' }))).toBe('in')
    expect(getZoomAction(input({ key: '+', alt: true }))).toBeNull()
    expect(getZoomAction(input({ key: '+', type: 'keyUp' }))).toBeNull()
    expect(getZoomAction(input({ key: 'a' }))).toBeNull()
  })
})

describe('adjustZoomFactor', () => {
  it('changes zoom in ten percent steps and resets to the default', () => {
    expect(adjustZoomFactor(1, 'in')).toBe(1.1)
    expect(adjustZoomFactor(1, 'out')).toBe(0.9)
    expect(adjustZoomFactor(1.7, 'reset')).toBe(DEFAULT_ZOOM_FACTOR)
  })

  it('clamps the zoom range', () => {
    expect(adjustZoomFactor(MAX_ZOOM_FACTOR, 'in')).toBe(MAX_ZOOM_FACTOR)
    expect(adjustZoomFactor(MIN_ZOOM_FACTOR, 'out')).toBe(MIN_ZOOM_FACTOR)
  })
})
