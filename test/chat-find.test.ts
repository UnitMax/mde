// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { findOffsets, matchRanges, startingMatch } from '../src/renderer/lib/chat-find'

describe('findOffsets', () => {
  it('finds every occurrence, ignoring case', () => {
    expect(findOffsets('Fix the fix, FIX it', 'fix')).toEqual([0, 8, 13])
  })

  it('does not overlap matches and finds nothing for an empty query', () => {
    expect(findOffsets('aaaa', 'aa')).toEqual([0, 2])
    expect(findOffsets('aaaa', '')).toEqual([])
  })

  it('keeps its offsets right for a letter that changes length when lowercased', () => {
    expect(findOffsets('İx x', 'x')).toEqual([1, 3])
  })
})

describe('matchRanges', () => {
  let root: HTMLElement
  beforeEach(() => {
    document.body.innerHTML = ''
    root = document.createElement('div')
    document.body.append(root)
  })
  const found = (query: string): string[] => matchRanges(root, query).map((range) => range.toString())

  it('looks only through the elements marked as searchable', () => {
    root.innerHTML = '<div data-chat-searchable>Fix the login</div><div>Fix the tool output</div><p data-chat-searchable>fix again</p>'
    expect(found('fix')).toEqual(['Fix', 'fix'])
  })

  it('finds text that runs across formatting', () => {
    root.innerHTML = '<p data-chat-searchable>make the <strong>login</strong> <em>re</em>direct work</p>'
    expect(found('login redirect')).toEqual(['login redirect'])
    expect(found('the log')).toEqual(['the log'])
  })

  it('finds several matches in one text node and in later nodes', () => {
    root.innerHTML = '<p data-chat-searchable>one two one <code>one</code></p>'
    const ranges = matchRanges(root, 'one')
    expect(ranges).toHaveLength(3)
    expect(ranges.map((range) => range.startOffset)).toEqual([0, 8, 0])
  })

  it('counts a marked element inside a marked element once', () => {
    root.innerHTML = '<div data-chat-searchable>a <span data-chat-searchable>word</span></div>'
    expect(found('word')).toEqual(['word'])
  })

  it('skips text that is not drawn', () => {
    root.innerHTML = '<p data-chat-searchable>shown <span id="gone">hidden</span></p>'
    const gone = root.querySelector<HTMLElement>('#gone')!
    gone.checkVisibility = () => false
    expect(found('hidden')).toEqual([])
    expect(found('shown')).toEqual(['shown'])
  })

  it('finds nothing for an empty query', () => {
    root.innerHTML = '<p data-chat-searchable>text</p>'
    expect(found('')).toEqual([])
  })
})

describe('startingMatch', () => {
  it('starts at the first match that is not above the top of the view', () => {
    expect(startingMatch([-300, -20, 40, 900], 0)).toBe(2)
  })

  it('starts at the last match when all of them are above the view', () => {
    expect(startingMatch([-300, -200, -50], 0)).toBe(2)
  })

  it('has no match to start at when there are none', () => {
    expect(startingMatch([], 0)).toBe(-1)
  })
})
