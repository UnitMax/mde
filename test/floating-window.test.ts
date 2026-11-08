import { describe, expect, it } from 'vitest'
import {
  clampFloatingRect,
  defaultFloatingRect,
  FLOATING_MARGIN,
  FLOATING_MIN_SIZE,
  isFloatingRect,
  moveFloatingRect,
  resizeFloatingRect,
  type FloatingRect
} from '../src/renderer/lib/floating-window'
import {
  DEFAULT_FLOATING_TERMINAL,
  parseStoredFloatingTerminal
} from '../src/renderer/lib/inbox-settings'

const bounds = { width: 1000, height: 700 }
const start: FloatingRect = { x: 300, y: 200, width: 400, height: 300 }

describe('clampFloatingRect', () => {
  it('leaves a window that fits alone', () => {
    expect(clampFloatingRect(start, bounds)).toEqual(start)
  })

  it('pulls a window back inside its view', () => {
    expect(clampFloatingRect({ ...start, x: -50, y: 900 }, bounds)).toEqual({ ...start, x: 0, y: 400 })
    expect(clampFloatingRect({ ...start, x: 900 }, bounds).x).toBe(600)
  })

  it('shrinks a window the view has become too small for, and never below the minimum unless the view is smaller', () => {
    expect(clampFloatingRect({ x: 0, y: 0, width: 2000, height: 2000 }, bounds)).toEqual({ x: 0, y: 0, ...bounds })
    expect(clampFloatingRect({ x: 0, y: 0, width: 10, height: 10 }, bounds)).toMatchObject(FLOATING_MIN_SIZE)
    expect(clampFloatingRect(start, { width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('rounds to whole pixels', () => {
    expect(clampFloatingRect({ x: 10.4, y: 10.6, width: 400.2, height: 300.7 }, bounds)).toEqual({ x: 10, y: 11, width: 400, height: 301 })
  })
})

describe('defaultFloatingRect', () => {
  it('opens in the bottom-right corner, at most 760 x 460', () => {
    expect(defaultFloatingRect({ width: 2000, height: 1400 })).toEqual({
      width: 760,
      height: 460,
      x: 2000 - 760 - FLOATING_MARGIN,
      y: 1400 - 460 - FLOATING_MARGIN,
    })
  })

  it('takes 60% by 50% of a smaller view, and always fits', () => {
    expect(defaultFloatingRect(bounds)).toEqual({ width: 600, height: 350, x: 384, y: 334 })
    for (const size of [{ width: 300, height: 150 }, { width: 500, height: 400 }]) {
      const rect = defaultFloatingRect(size)
      expect(clampFloatingRect(rect, size)).toEqual(rect)
    }
  })
})

describe('moveFloatingRect', () => {
  it('moves by the distance dragged and stops at the edges of the view', () => {
    expect(moveFloatingRect(start, 50, -30, bounds)).toEqual({ ...start, x: 350, y: 170 })
    expect(moveFloatingRect(start, 5000, 5000, bounds)).toEqual({ ...start, x: 600, y: 400 })
    expect(moveFloatingRect(start, -5000, -5000, bounds)).toEqual({ ...start, x: 0, y: 0 })
  })
})

describe('resizeFloatingRect', () => {
  it('drags the right and bottom edges, keeping the left and top', () => {
    expect(resizeFloatingRect(start, 'e', 100, 999, bounds)).toEqual({ ...start, width: 500 })
    expect(resizeFloatingRect(start, 's', 999, 50, bounds)).toEqual({ ...start, height: 350 })
  })

  it('drags the left and top edges, keeping the right and bottom ("to the left")', () => {
    expect(resizeFloatingRect(start, 'w', -100, 0, bounds)).toEqual({ x: 200, y: 200, width: 500, height: 300 })
    expect(resizeFloatingRect(start, 'n', 0, -80, bounds)).toEqual({ x: 300, y: 120, width: 400, height: 380 })
  })

  it('moves two edges at a corner', () => {
    expect(resizeFloatingRect(start, 'nw', -50, -50, bounds)).toEqual({ x: 250, y: 150, width: 450, height: 350 })
    expect(resizeFloatingRect(start, 'se', 60, 40, bounds)).toEqual({ ...start, width: 460, height: 340 })
    expect(resizeFloatingRect(start, 'ne', 60, -40, bounds)).toEqual({ x: 300, y: 160, width: 460, height: 340 })
    expect(resizeFloatingRect(start, 'sw', -60, 40, bounds)).toEqual({ x: 240, y: 200, width: 460, height: 340 })
  })

  it('stops at the minimum size without pushing the opposite edge', () => {
    expect(resizeFloatingRect(start, 'e', -9999, 0, bounds)).toEqual({ ...start, width: FLOATING_MIN_SIZE.width })
    expect(resizeFloatingRect(start, 'w', 9999, 0, bounds)).toEqual({ ...start, x: 700 - FLOATING_MIN_SIZE.width, width: FLOATING_MIN_SIZE.width })
    expect(resizeFloatingRect(start, 'n', 0, 9999, bounds)).toEqual({ ...start, y: 500 - FLOATING_MIN_SIZE.height, height: FLOATING_MIN_SIZE.height })
  })

  it('stops at the edges of the view', () => {
    expect(resizeFloatingRect(start, 'e', 9999, 0, bounds)).toEqual({ ...start, width: 700 })
    expect(resizeFloatingRect(start, 'w', -9999, 0, bounds)).toEqual({ ...start, x: 0, width: 700 })
    expect(resizeFloatingRect(start, 's', 0, 9999, bounds)).toEqual({ ...start, height: 500 })
    expect(resizeFloatingRect(start, 'n', 0, -9999, bounds)).toEqual({ ...start, y: 0, height: 500 })
  })
})

describe('stored floating terminal', () => {
  it('is not floating when nothing, or nonsense, was stored', () => {
    expect(parseStoredFloatingTerminal(null)).toEqual(DEFAULT_FLOATING_TERMINAL)
    expect(parseStoredFloatingTerminal('')).toEqual(DEFAULT_FLOATING_TERMINAL)
    expect(parseStoredFloatingTerminal('{not json')).toEqual(DEFAULT_FLOATING_TERMINAL)
    expect(parseStoredFloatingTerminal('7')).toEqual(DEFAULT_FLOATING_TERMINAL)
    expect(DEFAULT_FLOATING_TERMINAL).toEqual({ floating: false, rect: null, maximized: false })
  })

  it('reads what was saved, and drops a window rectangle that is not one', () => {
    expect(parseStoredFloatingTerminal(JSON.stringify({ floating: true, rect: start, maximized: true }))).toEqual({ floating: true, rect: start, maximized: true })
    expect(parseStoredFloatingTerminal(JSON.stringify({ floating: 'yes', rect: { x: 1, y: 2, width: 0, height: 5 }, maximized: 1 }))).toEqual(DEFAULT_FLOATING_TERMINAL)
    expect(parseStoredFloatingTerminal(JSON.stringify({ floating: true, rect: { ...start, extra: 'x' } })).rect).toEqual(start)
  })

  it('accepts only finite, positive-size rectangles', () => {
    expect(isFloatingRect(start)).toBe(true)
    expect(isFloatingRect({ ...start, x: Number.NaN })).toBe(false)
    expect(isFloatingRect({ ...start, width: -1 })).toBe(false)
    expect(isFloatingRect({ ...start, height: '300' })).toBe(false)
    expect(isFloatingRect(null)).toBe(false)
  })
})
