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

  /** A Mermaid diagram as it is drawn: SVG in a shadow root, a label as a tspan per line holding a tspan per word. */
  function diagram(host: HTMLElement): void {
    const row = (words: string[]): string =>
      `<tspan class="text-outer-tspan row">${words.map((word) => `<tspan class="text-inner-tspan">${word}</tspan>`).join('')}</tspan>`
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<style>.node { fill: red; }</style><svg><g>' +
      `<text>${row(['A', ' much', ' longer'])}${row(['label', ' here'])}</text>` +
      `<text>${row(['Done'])}</text>` +
      '<text class="messageText"><tspan dy="1em">Hello Bob</tspan><tspan dy="1em">again</tspan></text>' +
      '</g></svg>'
  }

  it('finds the labels of a diagram drawn in a shadow root, reading its wrapped lines with a space between them', () => {
    root.innerHTML = '<div data-chat-searchable><p>Before the longer one</p><div id="host"></div></div>'
    diagram(root.querySelector<HTMLElement>('#host')!)
    expect(found('longer')).toEqual(['longer', 'longer'])
    const across = matchRanges(root, 'longer label')
    expect(across).toHaveLength(1)
    // The space between the lines is not in the drawing: the range runs from one word's tspan to the next line's.
    expect(across[0]!.toString()).toBe('longerlabel')
    expect(found('bob again')).toEqual(['Bobagain'])
    // A match at the start of a line, right after the space the search added.
    expect(found(' label')).toEqual(['label'])
  })

  it('does not search a diagram\'s styles or run a match from one label into the next', () => {
    root.innerHTML = '<div data-chat-searchable><div id="host"></div></div>'
    diagram(root.querySelector<HTMLElement>('#host')!)
    expect(found('fill')).toEqual([])
    expect(found('here done')).toEqual([])
    expect(found('hereDone')).toEqual([])
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
