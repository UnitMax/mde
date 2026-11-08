import { describe, expect, it } from 'vitest'
import { diffLines, parseUnifiedDiff } from '../src/renderer/lib/diff'
import { highlightHunks, withEmphasis, type StyledSpan } from '../src/renderer/lib/diff-highlight'

const text = (spans: readonly StyledSpan[]): string => spans.map((span) => span.text).join('')
const colorOf = (spans: readonly StyledSpan[], word: string): string | undefined =>
  spans.find((span) => span.text === word)?.style?.color as string | undefined

describe('syntax colors for a diff', () => {
  it('colors each line, keeping every line\'s text exactly', async () => {
    const hunks = diffLines('const a = 1\nconst b = "x"', 'const a = 1\nconst b = "y" // note')
    const lines = (await highlightHunks('src/a.ts', hunks))!
    expect(lines).toHaveLength(1)
    expect(lines[0]!.map(text)).toEqual(hunks[0]!.lines.map((line) => line.text))
    expect(colorOf(lines[0]![0]!, 'const')).toBe('var(--color-syntax-keyword)')
    // The deleted and the added line are each read in their own version of the code.
    expect(lines[0]![1]!.some((span) => span.style?.color === 'var(--color-syntax-string)')).toBe(true)
    expect(lines[0]![2]!.some((span) => span.style?.color === 'var(--color-syntax-string)')).toBe(true)
    expect(lines[0]![2]!.some((span) => span.style?.fontStyle === 'italic')).toBe(true)
  })

  it('reads a comment that runs over several lines as one, even where the diff starts inside it', async () => {
    const hunks = parseUnifiedDiff('@@ -3,3 +3,3 @@\n /* start\n-old words\n+new words\n end */\n')
    const lines = (await highlightHunks('src/a.ts', hunks))!
    expect(lines[0]!.map(text)).toEqual(['/* start', 'old words', 'new words', 'end */'])
    for (const index of [0, 1, 2, 3]) expect(lines[0]![index]!.every((span) => span.style?.color === 'var(--color-fg-subtle)')).toBe(true)
  })

  it('handles several hunks, languages with and without a full parser, and an empty line', async () => {
    const hunks = parseUnifiedDiff('@@ -1,2 +1,2 @@\n key: 1\n-name: a\n+name: b\n@@ -9 +9,2 @@\n+\n+echo "hi"\n')
    expect((await highlightHunks('config.yaml', hunks))!.map((hunk) => hunk.length)).toEqual([3, 2])
    const shell = (await highlightHunks('run.sh', [hunks[1]!]))!
    expect(shell[0]!.map(text)).toEqual(['', 'echo "hi"'])
    expect(shell[0]![1]!.length).toBeGreaterThan(1)
  })

  it('leaves unknown languages and huge diffs plain', async () => {
    const hunks = diffLines('a', 'b')
    expect(await highlightHunks('notes.unknownext', hunks)).toBeNull()
    expect(await highlightHunks('Makefile', hunks)).toBeNull()
    expect(await highlightHunks('big.ts', diffLines('', 'x'.repeat(250_000)))).toBeNull()
    expect(await highlightHunks('a.ts', [])).toEqual([])
  })
})

describe('marking changed words in a line', () => {
  const red = { color: 'red' }
  const blue = { color: 'blue' }
  const spans: StyledSpan[] = [{ text: 'const ', style: red }, { text: 'total', style: blue }, { text: ' = items.length' }]

  it('splits the spans at the edges of the range and keeps their colors', () => {
    expect(withEmphasis(spans, [4, 13])).toEqual([
      { text: 'cons', style: red },
      { text: 't ', style: red, emphasis: true },
      { text: 'total', style: blue, emphasis: true },
      { text: ' =', emphasis: true },
      { text: ' items.length' },
    ])
  })

  it('marks a range inside one span, at the very start, and at the very end', () => {
    expect(withEmphasis([{ text: 'abcdef' }], [2, 4])).toEqual([{ text: 'ab' }, { text: 'cd', emphasis: true }, { text: 'ef' }])
    expect(withEmphasis([{ text: 'abcdef' }], [0, 2])).toEqual([{ text: 'ab', emphasis: true }, { text: 'cdef' }])
    expect(withEmphasis([{ text: 'abcdef' }], [4, 6])).toEqual([{ text: 'abcd' }, { text: 'ef', emphasis: true }])
  })

  it('changes nothing for no range, an empty range, or one past the end of the line', () => {
    expect(withEmphasis(spans, undefined)).toEqual(spans)
    expect(withEmphasis(spans, [5, 5])).toEqual(spans)
    expect(withEmphasis(spans, [40, 50])).toEqual(spans)
    expect(text(withEmphasis(spans, [4, 13]))).toBe(text(spans))
  })
})
