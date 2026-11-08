import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/renderer/fancy/random'
import {
  createRain,
  isRainHead,
  rainBrightness,
  stepRain,
  type RainColumn
} from '../src/renderer/fancy/thread-effects/matrix-rain'

const column = (overrides: Partial<RainColumn> = {}): RainColumn => ({
  active: true,
  head: 3.4,
  speed: 8,
  length: 5,
  wait: 0,
  glyphs: [0, 1, 2, 3, 4, 5, 6],
  ...overrides
})

describe('digital rain', () => {
  it('is brightest at the head, fades along the tail and is dark ahead of it and beyond it', () => {
    const c = column()
    expect(rainBrightness(c, 3)).toBe(1)
    expect(isRainHead(c, 3)).toBe(true)
    expect(isRainHead(c, 2)).toBe(false)
    expect(rainBrightness(c, 2)).toBeLessThan(1)
    expect(rainBrightness(c, 2)).toBeGreaterThan(rainBrightness(c, 1))
    expect(rainBrightness(c, 1)).toBeGreaterThan(rainBrightness(c, 0))
    expect(rainBrightness(c, 4)).toBe(0)
    expect(rainBrightness(c, 3 - 5)).toBe(0)
  })

  it('shows nothing in a column that waits or is not in use', () => {
    expect(rainBrightness(column({ wait: 0.5 }), 3)).toBe(0)
    expect(isRainHead(column({ wait: 0.5 }), 3)).toBe(false)
    expect(rainBrightness(column({ active: false }), 3)).toBe(0)
    expect(isRainHead(column({ active: false }), 3)).toBe(false)
  })

  it('starts with columns of which most are in use, glyphs in range, the same way for the same seed', () => {
    const state = createRain(mulberry32(4), 40, 7, 60)
    expect(state.columns).toHaveLength(40)
    const active = state.columns.filter((c) => c.active).length
    expect(active).toBeGreaterThan(20)
    expect(active).toBeLessThan(40)
    for (const c of state.columns) {
      expect(c.glyphs).toHaveLength(7)
      for (const glyph of c.glyphs) {
        expect(glyph).toBeGreaterThanOrEqual(0)
        expect(glyph).toBeLessThan(60)
      }
    }
    expect(createRain(mulberry32(4), 40, 7, 60)).toEqual(state)
  })

  it('falls, and starts a column again when its tail has left the row', () => {
    const random = mulberry32(2)
    const state = createRain(random, 1, 6, 30)
    const c = state.columns[0]!
    c.active = true
    c.wait = 0
    c.head = 0
    c.speed = 10
    c.length = 4
    stepRain(state, random, 0.1)
    expect(c.head).toBeCloseTo(1, 5)
    // Long enough for the head and the whole tail to have passed.
    let restarts = 0
    let last = c.head
    for (let step = 0; step < 600; step += 1) {
      stepRain(state, random, 1 / 30)
      if (c.head < last) restarts += 1
      last = c.head
    }
    expect(restarts).toBeGreaterThan(2)
    expect(c.head).toBeLessThan(6 + 12 + 5)
  })

  it('does not move a column that is waiting, and counts its wait down', () => {
    const random = mulberry32(2)
    const state = createRain(random, 1, 6, 30)
    const c = state.columns[0]!
    c.wait = 0.5
    c.head = -1
    stepRain(state, random, 0.2)
    expect(c.head).toBe(-1)
    expect(c.wait).toBeCloseTo(0.3, 5)
  })

  it('puts a new glyph in each cell the head enters', () => {
    const random = mulberry32(8)
    const state = createRain(random, 1, 6, 1000)
    const c = state.columns[0]!
    c.wait = 0
    c.head = -0.5
    c.speed = 20
    c.length = 3
    const before = [...c.glyphs]
    stepRain(state, random, 0.2)
    expect(Math.floor(c.head)).toBe(3)
    expect(c.glyphs.slice(0, 4)).not.toEqual(before.slice(0, 4))
  })

  it('copes with no columns', () => {
    const state = createRain(mulberry32(1), 0, 5, 10)
    expect(() => stepRain(state, mulberry32(1), 0.1)).not.toThrow()
  })
})
