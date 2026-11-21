import { describe, expect, it } from 'vitest'
import { forkLineage } from '../src/renderer/lib/fork-lineage'
import type { InboxThread } from '../src/shared/types'

const thread = (id: string, createdAt: number, forkedFrom?: string): InboxThread => ({
  id, title: id, directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
  createdAt, lastActivityAt: createdAt, readAt: 0, archived: false, status: 'completed', ...(forkedFrom ? { forkedFrom } : {}),
})
const shape = (rows: ReturnType<typeof forkLineage>): string[] =>
  rows.map((row) => `${row.id} d${row.depth} g[${row.guides.map(Number).join('')}] ${row.last ? 'last' : 'more'} f${row.forks}`)

describe('forkLineage', () => {
  it('has no tree for a thread with no forks and none it was forked from', () => {
    expect(forkLineage([thread('ses_a', 1), thread('ses_b', 2)], 'ses_a')).toEqual([])
    expect(forkLineage([], 'ses_a')).toEqual([])
  })

  it('draws the whole tree from its first thread, oldest fork first, from any thread in it', () => {
    const threads = [
      thread('ses_root', 1),
      thread('ses_late', 9, 'ses_root'),
      thread('ses_early', 2, 'ses_root'),
      thread('ses_deep', 3, 'ses_early'),
      thread('ses_other', 4),
    ]
    const expected = [
      'ses_root d0 g[] last f2',
      'ses_early d1 g[] more f1',
      'ses_deep d2 g[1] last f0',
      'ses_late d1 g[] last f0',
    ]
    expect(shape(forkLineage(threads, 'ses_deep'))).toEqual(expected)
    expect(shape(forkLineage(threads, 'ses_root'))).toEqual(expected)
    expect(shape(forkLineage(threads, 'ses_late'))).toEqual(expected)
  })

  it('heads the tree with a removed thread, so that its other forks are found too', () => {
    const rows = forkLineage([thread('ses_a', 2, 'ses_gone'), thread('ses_b', 3, 'ses_gone')], 'ses_b')
    expect(shape(rows)).toEqual(['ses_gone d0 g[] last f2', 'ses_a d1 g[] more f0', 'ses_b d1 g[] last f0'])
    expect(rows[0]!.thread).toBeNull()
  })

  it('stops at a loop in the records instead of walking forever', () => {
    const rows = forkLineage([thread('ses_a', 1, 'ses_b'), thread('ses_b', 2, 'ses_a')], 'ses_a')
    expect(rows.map((row) => row.id).sort()).toEqual(['ses_a', 'ses_b'])
  })
})
