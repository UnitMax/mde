// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_MERMAID_SOURCE_LENGTH,
  renderMermaidSvg,
  validateMermaidSource,
} from '../src/renderer/lib/mermaid-preview'

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: { initialize, render } }))

afterEach(() => {
  initialize.mockClear()
  render.mockReset()
})

describe('Mermaid preview security', () => {
  it('rejects excessive input and both ways of supplying diagram configuration', () => {
    expect(() => validateMermaidSource('a'.repeat(MAX_MERMAID_SOURCE_LENGTH + 1))).toThrow('too large')
    expect(() => validateMermaidSource('%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\nA-->B')).toThrow('disabled')
    expect(() => validateMermaidSource('---\nconfig:\n  htmlLabels: true\n---\nflowchart TD\nA-->B')).toThrow('disabled')
    expect(() => validateMermaidSource('flowchart TD\nA-->B')).not.toThrow()
  })

  it('keeps security settings fixed and returns detached SVG with the selected theme', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;script&gt;</text></svg>'
    render.mockResolvedValue({ svg, bindFunctions: vi.fn() })
    const source = 'flowchart TD\nA-->B'
    const first = await renderMermaidSvg(source, 'slate')
    await renderMermaidSvg(source, 'ember')

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
      maxEdges: 200,
      suppressErrorRendering: true,
      secure: expect.arrayContaining(['secure', 'securityLevel', 'htmlLabels', 'maxEdges', 'maxTextSize']),
    }))
    expect(first.querySelector('text')?.textContent).toBe('<script>')
    expect(initialize.mock.calls[0]?.[0].themeVariables.primaryTextColor).toBe('#d8dee9')
    expect(initialize.mock.calls[1]?.[0].themeVariables.primaryTextColor).toBe('#f5e6d3')
    expect(render.mock.calls[0]?.[0]).not.toBe(render.mock.calls[1]?.[0])
    expect(document.querySelector('svg')).toBeNull()
  })

  it('serializes theme initialization with rendering and recovers after a failure', async () => {
    let rejectFirst!: (reason: Error) => void
    render.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    render.mockResolvedValueOnce({ svg: '<svg><text>Second</text></svg>' })
    const first = renderMermaidSvg('flowchart TD\nA-->B', 'slate')
    const failed = expect(first).rejects.toThrow('Failed')
    const second = renderMermaidSvg('flowchart TD\nC-->D', 'frost')
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    expect(initialize).toHaveBeenCalledTimes(1)
    rejectFirst(new Error('Failed'))
    await failed
    expect((await second).querySelector('text')?.textContent).toBe('Second')
    expect(initialize.mock.calls[1]?.[0].themeVariables.primaryTextColor).toBe('#dce7f3')
  })
})
