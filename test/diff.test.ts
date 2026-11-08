import { describe, expect, it } from 'vitest'
import type { ChatPart } from '../src/shared/types'
import {
  additionsOf,
  changedWords,
  countChanges,
  diffLines,
  emphasisIn,
  parseUnifiedDiff,
  toolFileChanges,
  type DiffHunk,
} from '../src/renderer/lib/diff'

const kinds = (hunk: DiffHunk): string => hunk.lines.map((line) => ({ context: ' ', add: '+', del: '-' })[line.kind] + line.text).join('\n')

describe('unified diffs', () => {
  const patch = [
    'Index: /home/me/app/src/a.ts',
    '===================================================================',
    '--- /home/me/app/src/a.ts',
    '+++ /home/me/app/src/a.ts',
    '@@ -10,4 +10,5 @@',
    ' import time',
    '-import copy',
    '+import copy',
    '+import json',
    ' ',
    ' def run():',
    '@@ -40 +41 @@',
    '-old',
    '+new',
    '',
  ].join('\n')

  it('reads the hunks with line numbers on both sides and skips the file header', () => {
    const hunks = parseUnifiedDiff(patch)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'import time', oldNo: 10, newNo: 10 },
      { kind: 'del', text: 'import copy', oldNo: 11 },
      { kind: 'add', text: 'import copy', newNo: 11 },
      { kind: 'add', text: 'import json', newNo: 12 },
      { kind: 'context', text: '', oldNo: 12, newNo: 13 },
      { kind: 'context', text: 'def run():', oldNo: 13, newNo: 14 },
    ])
    // A header without a length means one line.
    expect(hunks[1]!.lines).toEqual([{ kind: 'del', text: 'old', oldNo: 40 }, { kind: 'add', text: 'new', newNo: 41 }])
    expect(countChanges(hunks)).toEqual({ additions: 3, deletions: 2 })
  })

  it('keeps a deleted line that looks like a file header, and ignores real ones after the hunk', () => {
    const hunks = parseUnifiedDiff([
      '--- a/notes.md', '+++ b/notes.md', '@@ -1,4 +1,2 @@', ' keep', '--- not a header', '-+++ nor this', ' end',
      '--- a/other.md', '+++ b/other.md', '',
    ].join('\n'))
    expect(hunks).toHaveLength(1)
    expect(kinds(hunks[0]!)).toBe(' keep\n--- not a header\n-+++ nor this\n end')
  })

  it('handles missing-newline markers, CRLF, blank context lines without their space, and cut-off diffs', () => {
    const crlf = parseUnifiedDiff('@@ -1,4 +1,4 @@\r\n a\r\n-b\r\n\\ No newline at end of file\r\n+c\r\n\r\n d\r\n')
    expect(kinds(crlf[0]!)).toBe(' a\n-b\n+c\n \n d')
    const cut = parseUnifiedDiff('@@ -1,50 +1,50 @@\n a\n-b\n+c')
    expect(kinds(cut[0]!)).toBe(' a\n-b\n+c')
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('not a diff at all\nreally')).toEqual([])
    expect(parseUnifiedDiff('@@ -1 +1 @@\n')).toEqual([])
  })
})

describe('line diffs of two snippets', () => {
  it('shows only what changed, with no line numbers', () => {
    const hunks = diffLines('const a = 1\nconst b = 2\nconst c = 3', 'const a = 1\nconst b = 20\nconst c = 3')
    expect(hunks).toHaveLength(1)
    expect(kinds(hunks[0]!)).toBe(' const a = 1\n-const b = 2\n+const b = 20\n const c = 3')
    expect(hunks[0]!.lines.every((line) => line.oldNo === undefined && line.newNo === undefined)).toBe(true)
  })

  it('keeps unchanged lines in the middle as context, and puts deletions before additions', () => {
    const hunks = diffLines('a\nb\nc\nd', 'a\nB\nc\nD\ne')
    expect(kinds(hunks[0]!)).toBe(' a\n-b\n+B\n c\n-d\n+D\n+e')
  })

  it('trims long stretches of unchanged lines to three around each change', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    const changed = [...lines]
    changed[3] = 'changed 3'
    changed[25] = 'changed 25'
    const hunks = diffLines(lines.join('\n'), changed.join('\n'))
    expect(hunks.map((hunk) => hunk.lines.length)).toEqual([8, 8])
    expect(kinds(hunks[0]!)).toBe(' line 0\n line 1\n line 2\n-line 3\n+changed 3\n line 4\n line 5\n line 6')
    // Changes with at most twice the context between them share one hunk; one more line splits them.
    expect(diffLines('1\n2\n3\n4\n5\n6\n7\n8', 'x\n2\n3\n4\n5\n6\n7\ny')).toHaveLength(1)
    expect(diffLines('1\n2\n3\n4\n5\n6\n7\n8\n9', 'x\n2\n3\n4\n5\n6\n7\n8\ny')).toHaveLength(2)
  })

  it('handles insertions, deletions, empty sides, and texts that are the same', () => {
    expect(kinds(diffLines('', 'a\nb')[0]!)).toBe('+a\n+b')
    expect(kinds(diffLines('a\nb', '')[0]!)).toBe('-a\n-b')
    expect(kinds(diffLines('a', 'a\nb')[0]!)).toBe(' a\n+b')
    expect(diffLines('same\nthing', 'same\nthing')).toEqual([])
    expect(diffLines('', '')).toEqual([])
    // A trailing newline is not a line, and CRLF is the same as LF.
    expect(diffLines('a\nb\n', 'a\r\nb\r\n')).toEqual([])
  })

  it('does not match up lines when that would take too long', () => {
    const a = Array.from({ length: 1700 }, (_, index) => `old ${index}`).join('\n')
    const b = Array.from({ length: 1700 }, (_, index) => `new ${index}`).join('\n')
    const [hunk] = diffLines(a, b)
    expect(countChanges([hunk!])).toEqual({ additions: 1700, deletions: 1700 })
    expect(hunk!.lines.slice(0, 1700).every((line) => line.kind === 'del')).toBe(true)
  })

  it('shows a whole new file as additions numbered from 1', () => {
    expect(additionsOf('# Title\n\nText\n')[0]!.lines).toEqual([
      { kind: 'add', text: '# Title', newNo: 1 }, { kind: 'add', text: '', newNo: 2 }, { kind: 'add', text: 'Text', newNo: 3 },
    ])
    expect(additionsOf('')).toEqual([])
  })
})

describe('changed words within a line', () => {
  const marked = (oldLine: string, newLine: string): [string, string] | null => {
    const change = changedWords(oldLine, newLine)
    return change && [oldLine.slice(...change.old), newLine.slice(...change.new)]
  }

  it('marks what is left once the same beginning and end are taken off', () => {
    expect(marked('const total = items.length', 'const total = items.size')).toEqual(['length', 'size'])
    expect(marked('  return a + b', '  return a - b')).toEqual(['+', '-'])
    expect(marked('call(foo, bar)', 'call(foo, bar, baz)')).toEqual(['', ', baz'])
    expect(marked('let count = 1;', 'let count = 100;')).toEqual(['1', '100'])
  })

  it('leaves identical, unrelated and very long lines alone', () => {
    expect(changedWords('same', 'same')).toBeNull()
    expect(changedWords('import copy', 'def create_grid(width, height):')).toBeNull()
    expect(changedWords('x'.repeat(3000), `${'x'.repeat(2999)}y`)).toBeNull()
  })

  it('does not count indentation as a likeness between unrelated lines', () => {
    expect(changedWords('        alpha beta gamma', '        one two three')).toBeNull()
  })

  it('pairs each deleted line with the added line in the same place', () => {
    const [hunk] = diffLines('a = 1\nb = 2\nkeep', 'a = 10\nb = 20\nkeep')
    const marks = emphasisIn(hunk!)
    expect([...marks.keys()].sort()).toEqual([0, 1, 2, 3].filter((index) => hunk!.lines[index]!.kind !== 'context'))
    expect(hunk!.lines.map((line, index) => marks.has(index) ? line.text.slice(...marks.get(index)!) : null))
      .toEqual(['1', '2', '10', '20', null])
    // A line with no counterpart stays unmarked.
    const [lone] = diffLines('a', 'a\nb')
    expect(emphasisIn(lone!).size).toBe(0)
  })
})

describe('what a tool call changed', () => {
  const tool = (overrides: Partial<Extract<ChatPart, { kind: 'tool' }>>): Extract<ChatPart, { kind: 'tool' }> =>
    ({ kind: 'tool', id: 'call_1', name: 'edit', status: 'completed', input: '{}', ...overrides })
  const patch = '@@ -1,2 +1,2 @@\n a\n-b\n+c\n'

  it('prefers the diff OpenCode reported, with its line numbers', () => {
    const [change] = toolFileChanges(tool({
      input: JSON.stringify({ filePath: '/home/me/app/a.ts', oldString: 'b', newString: 'c' }),
      patches: [{ path: '/home/me/app/a.ts', patch }],
    }))!
    expect(change).toMatchObject({ path: '/home/me/app/a.ts', action: 'edit', numbered: true, additions: 1, deletions: 1 })
    expect(change!.hunks[0]!.lines[1]).toEqual({ kind: 'del', text: 'b', oldNo: 2 })
  })

  it('works the diff out from the input while the edit has not finished', () => {
    const [change] = toolFileChanges(tool({
      status: 'running',
      input: JSON.stringify({ path: 'src/a.ts', oldString: 'x\ny', newString: 'x\nz' }),
    }))!
    expect(change).toMatchObject({ path: 'src/a.ts', action: 'edit', numbered: false, additions: 1, deletions: 1 })
    // OpenCode sends file_path too in some versions.
    expect(toolFileChanges(tool({ input: JSON.stringify({ file_path: 'b.ts', oldString: 'a', newString: 'b' }) }))![0]!.path).toBe('b.ts')
  })

  it('has nothing to draw until the input is complete, and for an edit that changes nothing', () => {
    expect(toolFileChanges(tool({ status: 'pending', input: '{"filePath": "src/a.ts", "oldSt' }))).toBeNull()
    expect(toolFileChanges(tool({ input: '{"filePath":"a.ts","oldString":"same"}' }))).toBeNull()
    expect(toolFileChanges(tool({ input: JSON.stringify({ filePath: 'a.ts', oldString: 'same', newString: 'same' }) }))).toBeNull()
    expect(toolFileChanges(tool({ input: '[1, 2]' }))).toBeNull()
    expect(toolFileChanges(tool({ name: 'read', input: JSON.stringify({ filePath: 'a.ts' }) }))).toBeNull()
  })

  it('falls back to the input when the reported diff has nothing to show', () => {
    const [change] = toolFileChanges(tool({
      input: JSON.stringify({ filePath: 'a.ts', oldString: 'a', newString: 'b' }),
      patches: [{ path: 'a.ts', patch: 'garbage' }],
    }))!
    expect(change).toMatchObject({ numbered: false, additions: 1, deletions: 1 })
  })

  it('reports every file of a multi-file diff', () => {
    const changes = toolFileChanges(tool({ patches: [{ path: 'a.ts', patch }, { path: 'b.ts', patch }] }))!
    expect(changes.map((change) => change.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('shows a written file as all additions, and says whether it replaced a file', () => {
    const input = JSON.stringify({ filePath: '/home/me/app/notes.md', content: '# Notes\n\nHello\n' })
    expect(toolFileChanges(tool({ name: 'write', input }))![0]).toMatchObject({ action: 'write', additions: 3, deletions: 0, numbered: true })
    expect(toolFileChanges(tool({ name: 'write', input, existed: false }))![0]!.action).toBe('create')
    expect(toolFileChanges(tool({ name: 'write', input, existed: true }))![0]!.action).toBe('overwrite')
    expect(toolFileChanges(tool({ name: 'write', input: JSON.stringify({ filePath: 'a.md' }) }))).toBeNull()
    expect(toolFileChanges(tool({ name: 'write', input: JSON.stringify({ filePath: 'empty.md', content: '' }) }))![0]!.hunks).toEqual([])
  })
})
