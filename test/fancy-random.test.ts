import { describe, expect, it } from 'vitest'
import { between, clamp, createNoise3, hashString, lerp, mulberry32, pick } from '../src/renderer/fancy/random'

describe('fancy randomness', () => {
  it('repeats a sequence for a seed and differs between seeds', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const first = Array.from({ length: 8 }, () => a())
    expect(Array.from({ length: 8 }, () => b())).toEqual(first)
    expect(Array.from({ length: 8 }, mulberry32(43))).not.toEqual(first)
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('hashes text to a stable seed', () => {
    expect(hashString('ses_one')).toBe(hashString('ses_one'))
    expect(hashString('ses_one')).not.toBe(hashString('ses_two'))
    expect(hashString('')).toBeGreaterThanOrEqual(0)
  })

  it('has helpers for ranges, picks and limits', () => {
    const random = mulberry32(1)
    for (let index = 0; index < 50; index += 1) {
      const value = between(random, 3, 5)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThan(5)
      expect(['a', 'b', 'c']).toContain(pick(random, ['a', 'b', 'c']))
    }
    expect(clamp(9, 0, 5)).toBe(5)
    expect(clamp(-1, 0, 5)).toBe(0)
    expect(lerp(10, 20, 0.25)).toBe(12.5)
  })

  it('makes smooth noise that repeats for a seed', () => {
    const noise = createNoise3(7)
    const same = createNoise3(7)
    const other = createNoise3(8)
    let differs = false
    let sum = 0
    let count = 0
    let largestStep = 0
    for (let x = 0; x < 20; x += 0.37) {
      for (let y = 0; y < 20; y += 0.53) {
        const value = noise(x, y, 1.5)
        expect(value).toBe(same(x, y, 1.5))
        if (value !== other(x, y, 1.5)) differs = true
        expect(Math.abs(value)).toBeLessThanOrEqual(1.2)
        largestStep = Math.max(largestStep, Math.abs(noise(x + 0.01, y, 1.5) - value))
        sum += value
        count += 1
      }
    }
    expect(differs).toBe(true)
    // Neighboring points differ by little, and the noise has no lean to either side.
    expect(largestStep).toBeLessThan(0.1)
    expect(Math.abs(sum / count)).toBeLessThan(0.2)
  })
})
