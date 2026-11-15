// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown } from '../src/renderer/components/inbox/ChatMarkdown'
import { blockMath, inlineMath, MATH_SOURCE_LIMIT } from '../src/renderer/lib/math-markdown'

// KaTeX refuses to draw in quirks mode, which it checks once as it loads. MDE's page has a doctype; happy-dom's
// blank document does not, so the test document reports standards mode before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(Object.getPrototypeOf(document), 'compatMode', { get: () => 'CSS1Compat', configurable: true })
})

describe('finding math in Markdown', () => {
  it('reads $…$, \\(…\\) and $$…$$ inline', () => {
    expect(inlineMath('$x^2$ and more')).toMatchObject({ raw: '$x^2$', latex: 'x^2', display: false })
    expect(inlineMath('\\(a+b\\) rest')).toMatchObject({ raw: '\\(a+b\\)', latex: 'a+b', display: false })
    expect(inlineMath('$$\\sum_i i$$ rest')).toMatchObject({ latex: '\\sum_i i', display: true })
    expect(inlineMath('$\\$5$')).toMatchObject({ latex: '\\$5' })
  })

  it('leaves money alone', () => {
    expect(inlineMath('$5 and $10')).toBeUndefined()
    expect(inlineMath('$ 5 $')).toBeUndefined()
    expect(inlineMath('$5,000 and $6,000')).toBeUndefined()
    expect(inlineMath('$x$5')).toBeUndefined()
    expect(inlineMath('$a\nb$')).toBeUndefined()
    expect(inlineMath(`$${'x'.repeat(MATH_SOURCE_LIMIT + 1)}$`)).toBeUndefined()
  })

  it('reads $$…$$ and \\[…\\] blocks on lines of their own', () => {
    expect(blockMath('$$\n\\int_0^1 x\\,dx\n$$\nafter')).toMatchObject({ latex: '\\int_0^1 x\\,dx', display: true })
    expect(blockMath('\\[\nE = mc^2\n\\]')).toMatchObject({ latex: 'E = mc^2' })
    expect(blockMath('$$a$$ and text')).toBeUndefined()
  })
})

describe('math in a reply', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })
  afterEach(async () => {
    await act(async () => dispose?.())
    dispose = undefined
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function render(text: string): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    await act(async () => root.render(createElement(ChatMarkdown, { text })))
    return container
  }

  it('draws formulas with KaTeX and keeps prices, code and code blocks as text', async () => {
    const container = await render([
      'Euler: $e^{i\\pi} + 1 = 0$, which costs $5 and $10.',
      '',
      '$$',
      '\\frac{a}{b}',
      '$$',
      '',
      'Code: `$x$`',
      '',
      '```',
      '$$not math$$',
      '```',
    ].join('\n'))
    const inline = container.querySelectorAll('.math-inline .katex')
    expect(inline).toHaveLength(1)
    expect(container.querySelectorAll('.math-block .katex-display')).toHaveLength(1)
    expect(container.textContent).toContain('which costs $5 and $10.')
    expect(container.querySelector('code')?.textContent).toBe('$x$')
    expect(container.querySelector('pre')?.textContent).toContain('$$not math$$')
  })

  it('refuses commands that reach outside, and shows a formula it cannot read as its source', async () => {
    const container = await render('Link $\\href{https://example.com}{x}$ and broken $\\frac{1}{$ and \\(\\url{javascript:alert(1)}\\)')
    expect(container.querySelector('a')).toBeNull()
    const failed = container.querySelectorAll('[data-math-error]')
    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(Array.from(failed).map((element) => element.textContent)).toContain('$\\frac{1}{$')
  })
})
