import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownMessage, safeMarkdownUrl } from '../src/renderer/components/MarkdownMessage'

describe('GUI Markdown renderer', () => {
  it('renders GitHub-flavored Markdown constructs', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownMessage, {
        text: '# Heading\n\n- **bold**\n- [ ] todo\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst answer = 42\n```'
      })
    )

    expect(html).toContain('<h1')
    expect(html).toContain('<strong')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<table')
    expect(html).toContain('const answer = 42')
  })

  it('keeps raw HTML inert and only allows HTTP(S) links', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownMessage, {
        text: '<script>alert(1)</script>\n\n[good](https://example.com) [bad](javascript:alert(1))'
      })
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('javascript:')
    expect(safeMarkdownUrl('https://example.com')).toBe('https://example.com')
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('')
  })

  it('renders incomplete streaming Markdown without requiring a closing fence', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownMessage, { text: '```\npartial output', streaming: true })
    )

    expect(html).toContain('partial output')
    expect(html).toContain('animate-pulse')
  })
})
