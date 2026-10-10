// @vitest-environment jsdom

import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import { renderMermaidSvg } from '../src/renderer/lib/mermaid-preview'

const require = createRequire(import.meta.url)
const mermaidRequire = createRequire(require.resolve('mermaid'))
const katex = mermaidRequire('katex') as {
  renderToString: (source: string, options: Record<string, unknown>) => string
}

beforeEach(() => {
  vi.stubGlobal('MathMLElement', HTMLElement)
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 30 }),
  })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value: () => 100,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (SVGElement.prototype as unknown as Record<string, unknown>).getBBox
  delete (SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength
  document.body.replaceChildren()
})

describe('Mermaid math dependency compatibility', () => {
  it('renders ordinary math and rejects an inherited trust option', () => {
    const math = katex.renderToString(String.raw`\frac{a}{b}`, { output: 'mathml' })
    expect(math).toContain('<mfrac>')
    const inheritedTrust = Object.create({ trust: true }) as Record<string, unknown>
    const untrusted = katex.renderToString(String.raw`\href{javascript:alert(1)}{click}`, inheritedTrust)
    expect(untrusted).not.toMatch(/href=["']javascript:/)
    expect(untrusted).not.toContain('<a ')
  })

  it('renders real Mermaid flowcharts through the preview sanitizer', async () => {
    const fragment = await renderMermaidSvg('flowchart TD\nA[Start] --> B[Finish]', 'slate')
    expect(fragment.querySelector('svg')).not.toBeNull()
    expect(fragment.textContent).toContain('Start')
    expect(fragment.textContent).toContain('Finish')
    expect(fragment.querySelector('script, foreignObject, a')).toBeNull()
  }, 15_000)

  it('renders math labels with Mermaid using the upgraded KaTeX', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: true })
    const { svg } = await mermaid.render('dependency-math', String.raw`flowchart TD
      A["$$\frac{a}{b}$$"] --> B[Done]`)
    expect(svg).toContain('<math')
    expect(svg).toContain('<mfrac>')
    expect(svg).not.toContain('javascript:')
  }, 15_000)
})
