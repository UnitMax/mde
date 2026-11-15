import { describe, expect, it } from 'vitest'
import { layoutGitGraph, relativeCommitTime, type GraphRow } from '../src/renderer/lib/git-graph'

/** The lanes a row draws, as `from>to` per half, for compact comparisons. */
const halves = (row: GraphRow): { top: string[]; bottom: string[] } => ({
  top: row.segments.filter((s) => s.half === 'top').map((s) => `${s.from}>${s.to}`).sort(),
  bottom: row.segments.filter((s) => s.half === 'bottom').map((s) => `${s.from}>${s.to}`).sort(),
})

describe('layoutGitGraph', () => {
  it('keeps a straight history in one lane and one color', () => {
    const rows = layoutGitGraph([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(rows.map((row) => row.column)).toEqual([0, 0, 0])
    expect(new Set(rows.map((row) => row.color)).size).toBe(1)
    expect(halves(rows[0]!)).toEqual({ top: [], bottom: ['0>0'] })
    expect(halves(rows[1]!)).toEqual({ top: ['0>0'], bottom: ['0>0'] })
    // The root commit ends its lane.
    expect(halves(rows[2]!)).toEqual({ top: ['0>0'], bottom: [] })
  })

  it('opens a lane for a second parent and joins it back where the branches met', () => {
    // m merges f into main; f and b both come from a.
    const rows = layoutGitGraph([
      { hash: 'm', parents: ['b', 'f'] },
      { hash: 'f', parents: ['a'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(rows.map((row) => row.column)).toEqual([0, 1, 0, 0])
    expect(halves(rows[0]!).bottom).toEqual(['0>0', '0>1'])
    expect(rows[1]!.color).not.toBe(rows[0]!.color)
    // f's lane waits for a while b passes by in lane 0.
    expect(halves(rows[2]!)).toEqual({ top: ['0>0', '1>1'], bottom: ['0>0', '1>1'] })
    // Both lanes wait for a: the second joins the first at the commit.
    expect(halves(rows[3]!).top).toEqual(['0>0', '1>0'])
    expect(rows[3]!.width).toBe(2)
  })

  it('starts a new lane for each branch tip and reuses a lane once it is free', () => {
    const rows = layoutGitGraph([
      { hash: 'x', parents: ['a'] },
      { hash: 'y', parents: ['a'] },
      { hash: 'a', parents: [] },
      { hash: 'z', parents: [] },
    ])
    expect(rows.map((row) => row.column)).toEqual([0, 1, 0, 0])
    // y's parent is already awaited in lane 0, so its line bends there.
    expect(halves(rows[1]!).bottom).toEqual(['0>0', '1>0'])
    expect(rows[3]!.segments).toEqual([])
  })

  it('draws the uncommitted changes and the line to HEAD dashed', () => {
    const rows = layoutGitGraph([
      { hash: 'working', parents: ['b'], dashed: true },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(rows[0]!.segments.every((s) => s.dashed)).toBe(true)
    expect(rows[1]!.segments.find((s) => s.half === 'top')?.dashed).toBe(true)
    expect(rows[1]!.segments.find((s) => s.half === 'bottom')?.dashed).toBe(false)
  })

  it('leaves a lane open at the bottom for a parent past the commits read', () => {
    const rows = layoutGitGraph([{ hash: 'b', parents: ['a'] }])
    expect(halves(rows[0]!).bottom).toEqual(['0>0'])
  })
})

describe('relativeCommitTime', () => {
  const now = Date.UTC(2026, 10, 11, 12)
  it('names recent times in words', () => {
    expect(relativeCommitTime(now / 1000 - 20, now)).toBe('just now')
    expect(relativeCommitTime(now / 1000 - 5 * 60, now)).toBe('5 min ago')
    expect(relativeCommitTime(now / 1000 - 3 * 3600, now)).toBe('3 h ago')
    expect(relativeCommitTime(now / 1000 - 30 * 3600, now)).toBe('yesterday')
    expect(relativeCommitTime(now / 1000 - 4 * 86_400, now)).toBe('4 days ago')
  })
  it('gives an older time as a date', () => {
    expect(relativeCommitTime(now / 1000 - 40 * 86_400, now)).not.toMatch(/ago/)
  })
})
