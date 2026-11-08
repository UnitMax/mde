import { describe, expect, it } from 'vitest'
import {
  ARC_SECONDS,
  STRIKE_SECONDS,
  arcEnvelope,
  crackle,
  generateBolt,
  nextStrikeDelay,
  roundedPerimeter,
  strikeEnvelope
} from '../src/renderer/fancy/thread-effects/lightning'
import { mulberry32 } from '../src/renderer/fancy/random'

describe('lightning bolts', () => {
  it('runs from one end to the other, in 2^depth segments, the same way for the same seed', () => {
    const from = { x: 0, y: 20 }
    const to = { x: 260, y: 40 }
    const bolt = generateBolt(mulberry32(5), from, to, { depth: 5 })
    expect(bolt.main[0]).toEqual(from)
    expect(bolt.main[bolt.main.length - 1]).toEqual(to)
    expect(bolt.main).toHaveLength(2 ** 5 + 1)
    expect(generateBolt(mulberry32(5), from, to, { depth: 5 })).toEqual(bolt)
    expect(generateBolt(mulberry32(6), from, to, { depth: 5 })).not.toEqual(bolt)
  })

  it('is rough, but stays near the line between its ends', () => {
    const from = { x: 0, y: 30 }
    const to = { x: 300, y: 30 }
    const bolt = generateBolt(mulberry32(9), from, to, { depth: 6, roughness: 0.1, branchChance: 0 })
    const deviations = bolt.main.map((point) => Math.abs(point.y - 30))
    expect(Math.max(...deviations)).toBeGreaterThan(1)
    expect(Math.max(...deviations)).toBeLessThan(0.1 * 300)
    for (const point of bolt.main) {
      expect(point.x).toBeGreaterThan(-0.1 * 300)
      expect(point.x).toBeLessThan(1.1 * 300)
    }
  })

  it('forks a few times from the main stroke and no more than allowed', () => {
    const from = { x: 0, y: 30 }
    const to = { x: 260, y: 30 }
    const forked = generateBolt(mulberry32(3), from, to, { depth: 6, branchChance: 1, maxBranches: 3 })
    expect(forked.branches).toHaveLength(3)
    for (const branch of forked.branches) {
      expect(forked.main).toContainEqual(branch[0])
      expect(branch.length).toBeGreaterThan(2)
    }
    expect(generateBolt(mulberry32(3), from, to, { depth: 6, branchChance: 0 }).branches).toEqual([])
    expect(generateBolt(mulberry32(3), from, to, { depth: 2, branchChance: 1 }).branches).toEqual([])
  })

  it('handles a bolt with no length', () => {
    const point = { x: 5, y: 5 }
    const bolt = generateBolt(mulberry32(1), point, point, { depth: 3 })
    expect(bolt.main.every((p) => p.x === 5 && p.y === 5)).toBe(true)
  })
})

describe('a strike’s brightness', () => {
  it('flashes, dips, flashes again and dies away', () => {
    expect(strikeEnvelope(-0.1)).toBe(0)
    expect(strikeEnvelope(0)).toBe(0)
    expect(strikeEnvelope(0.05)).toBeCloseTo(1, 5)
    expect(strikeEnvelope(0.11)).toBeCloseTo(0.35, 5)
    expect(strikeEnvelope(0.15)).toBeCloseTo(0.9, 5)
    expect(strikeEnvelope(0.11)).toBeLessThan(strikeEnvelope(0.05))
    expect(strikeEnvelope(0.15)).toBeGreaterThan(strikeEnvelope(0.11))
    expect(strikeEnvelope(0.3)).toBeLessThan(strikeEnvelope(0.2))
    expect(strikeEnvelope(STRIKE_SECONDS - 0.001)).toBeLessThan(0.1)
    expect(strikeEnvelope(STRIKE_SECONDS)).toBe(0)
    for (let age = 0; age < STRIKE_SECONDS; age += 0.01) {
      const value = strikeEnvelope(age)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('leaves a quiet spell between strikes that varies but is never idle for long', () => {
    const random = mulberry32(11)
    const delays = Array.from({ length: 50 }, () => nextStrikeDelay(random))
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0.9)
      expect(delay).toBeLessThan(2.6)
    }
    expect(new Set(delays.map((delay) => delay.toFixed(2))).size).toBeGreaterThan(20)
  })

  it('gives a small arc a hard flicker and a short life', () => {
    expect(arcEnvelope(-1)).toBe(0)
    expect(arcEnvelope(ARC_SECONDS)).toBe(0)
    const values = Array.from({ length: 20 }, (_, index) => arcEnvelope(index * 0.01))
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(new Set(values.slice(0, 10).map((value) => value.toFixed(3))).size).toBeGreaterThan(2)
  })
})

describe('the border the current runs round', () => {
  it('has the length of a rounded rectangle and wraps round', () => {
    const { length, at } = roundedPerimeter(260, 60, 4)
    expect(length).toBeCloseTo(2 * (260 - 8) + 2 * (60 - 8) + 2 * Math.PI * 4, 5)
    expect(at(0)).toMatchObject({ x: 4, y: 0, nx: 0, ny: -1 })
    expect(at(length).x).toBeCloseTo(at(0).x, 5)
    expect(at(-length).y).toBeCloseTo(at(0).y, 5)
    expect(at(length + 10).x).toBeCloseTo(at(10).x, 5)
  })

  it('stays on the outline, with an outward direction of length one, and has no jumps', () => {
    const { length, at } = roundedPerimeter(260, 60, 4)
    let previous = at(0)
    for (let distance = 0.5; distance <= length; distance += 0.5) {
      const point = at(distance)
      expect(point.x).toBeGreaterThanOrEqual(-1e-6)
      expect(point.x).toBeLessThanOrEqual(260 + 1e-6)
      expect(point.y).toBeGreaterThanOrEqual(-1e-6)
      expect(point.y).toBeLessThanOrEqual(60 + 1e-6)
      expect(Math.hypot(point.nx, point.ny)).toBeCloseTo(1, 5)
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(0.6)
      previous = point
    }
  })

  it('copes with a row too small for its corners', () => {
    const { length, at } = roundedPerimeter(6, 6, 4)
    expect(length).toBeGreaterThan(0)
    expect(Number.isFinite(at(3).x)).toBe(true)
  })

  it('crackles smoothly: bounded, repeatable, and close in value for close inputs', () => {
    let largest = 0
    for (let position = 0; position < 30; position += 0.13) {
      const value = crackle(position, 4.2, 3)
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
      expect(crackle(position, 4.2, 3)).toBe(value)
      largest = Math.max(largest, Math.abs(crackle(position + 0.02, 4.2, 3) - value))
    }
    expect(largest).toBeLessThan(0.2)
    expect(crackle(1.5, 2, 3)).not.toBe(crackle(1.5, 2, 4))
  })
})
