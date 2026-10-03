// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { sanitizeMermaidSvg } from '../src/renderer/lib/mermaid-svg'

function svg(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="diagram">${content}</svg>`
}

describe('Mermaid SVG boundary', () => {
  it('removes active content, HTML, links, resources and animation', () => {
    const fragment = sanitizeMermaidSvg(svg(`
      <script>alert(1)</script>
      <foreignObject><div onclick="alert(1)">HTML</div></foreignObject>
      <a href="javascript:alert(1)"><text>Link</text></a>
      <image href="https://example.com/image.svg" />
      <filter><feImage href="file:///etc/passwd" /></filter>
      <use href="https://example.com/icon.svg#icon" />
      <animate attributeName="href" to="javascript:alert(1)" />
      <text onmouseover="alert(1)">Safe label</text>
    `))
    expect(fragment.querySelector('script, foreignObject, a, image, feImage, use, animate, div')).toBeNull()
    expect(fragment.querySelector('text[onmouseover]')).toBeNull()
    expect(fragment.textContent).toContain('Safe label')
  })

  it('preserves local arrow markers, SVG text and static styles', () => {
    const fragment = sanitizeMermaidSvg(svg(`
      <style>#diagram text { fill: #fff; } @font-face { font-family: remote; src: url(#arrow); }</style>
      <defs><marker id="arrow"><path d="M0,0 L10,5 L0,10" /></marker></defs>
      <path marker-end="url(#arrow)" />
      <text><tspan>Selectable</tspan></text>
    `))
    expect(fragment.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe('url(#arrow)')
    expect(fragment.querySelector('tspan')?.textContent).toBe('Selectable')
    expect(fragment.querySelector('style')?.textContent).toContain('fill: rgb(255, 255, 255)')
    expect(fragment.querySelector('style')?.textContent).not.toContain('@font-face')
  })

  it('removes external hrefs while preserving references within the diagram', () => {
    const fragment = sanitizeMermaidSvg(svg(`
      <defs>
        <linearGradient id="base" />
        <linearGradient id="local" href="#base" />
        <linearGradient id="remote" href="https://example.com/gradient.svg#base" />
      </defs>
    `))
    expect(fragment.querySelector('#local')?.getAttribute('href')).toBe('#base')
    expect(fragment.querySelector('#remote')?.hasAttribute('href')).toBe(false)
  })

  it.each([
    '<style>@import "https://example.com/style.css";</style>',
    '<style>:host { position: fixed; }</style>',
    '<style>::slotted(*) { color: red; }</style>',
    '<style>text { fill: u\\72l(https://example.com); }</style>',
    '<style>text { fill: url(https://example.com); }</style>',
    '<style>text { background: image-set("https://example.com"); }</style>',
    '<path fill="url(file:///etc/passwd)" />',
    '<path style="filter:url(data:image/svg+xml,test)" />',
    '<path marker-end="url(#outside)" />',
  ])('rejects unsafe CSS and references: %s', (content) => {
    expect(() => sanitizeMermaidSvg(svg(content))).toThrow()
  })
})
