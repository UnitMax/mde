import { describe, expect, it } from 'vitest'
import { contourSegments, emitCellSegments } from '../src/renderer/fancy/backgrounds/contours-math'

/** A grid of heights `f(column, row)`. */
function grid(cols: number, rows: number, f: (column: number, row: number) => number): Float32Array {
  const field = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < cols; column += 1) field[row * cols + column] = f(column, row)
  return field
}

describe('contour lines', () => {
  it('finds nothing in a field that never crosses the level', () => {
    expect(contourSegments(grid(6, 6, () => 0.2), 6, 6, 10, 0.5)).toEqual([])
    expect(contourSegments(grid(6, 6, () => 0.9), 6, 6, 10, 0.5)).toEqual([])
  })

  it('draws a straight line where a slope crosses the level, at the interpolated place', () => {
    // Height rises with the column: 0, 1, 2, 3, 4. Level 1.5 lies halfway between columns 1 and 2.
    const segments = contourSegments(grid(5, 4, (column) => column), 5, 4, 10, 1.5)
    expect(segments.length / 4).toBe(3)
    for (let index = 0; index < segments.length; index += 4) {
      expect(segments[index]).toBeCloseTo(15, 5)
      expect(segments[index + 2]).toBeCloseTo(15, 5)
    }
    // A level a quarter of the way between them.
    const quarter = contourSegments(grid(5, 4, (column) => column), 5, 4, 10, 1.25)
    expect(quarter[0]).toBeCloseTo(12.5, 5)
  })

  it('closes a loop round a hill, every point on the level', () => {
    const size = 21
    const center = 10
    const field = grid(size, size, (column, row) => -Math.hypot(column - center, row - center))
    const level = -4.3
    const cell = 8
    const segments = contourSegments(field, size, size, cell, level)
    expect(segments.length / 4).toBeGreaterThan(16)
    const counts = new Map<string, number>()
    for (let index = 0; index < segments.length; index += 2) {
      const x = segments[index]!
      const y = segments[index + 1]!
      // Linear interpolation of a cone is exact along an axis and close elsewhere.
      expect(Math.hypot(x / cell - center, y / cell - center)).toBeGreaterThan(4.3 - 0.3)
      expect(Math.hypot(x / cell - center, y / cell - center)).toBeLessThan(4.3 + 0.3)
      const key = `${x.toFixed(4)},${y.toFixed(4)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    // A closed loop: each end of a segment is the end of exactly one other.
    for (const count of counts.values()) expect(count).toBe(2)
  })

  it('joins the two corners of a saddle one way when the middle is high, the other when it is low', () => {
    const field = [1, 0, 0, 1] // top-left and bottom-right high
    const average = 0.5
    const out: number[] = []
    emitCellSegments(field, 2, 0, 0, 10, average - 0.01, out) // level below the average: the middle is high
    const high = [...out]
    out.length = 0
    emitCellSegments(field, 2, 0, 0, 10, average + 0.01, out) // level above the average: the middle is low
    expect(high).toHaveLength(8)
    expect(out).toHaveLength(8)
    expect(high).not.toEqual(out)
  })
})
