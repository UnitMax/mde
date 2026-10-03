import DOMPurify from 'dompurify'

const RESOURCE_ATTRIBUTES = new Set([
  'style', 'fill', 'stroke', 'filter', 'clip-path', 'mask',
  'marker-start', 'marker-mid', 'marker-end', 'cursor',
])

/** CSS is outside DOMPurify's XSS policy, so check it before mounting SVG. */
function validateCss(css: string, ids: Set<string>): void {
  if (/\\|@import|:host|::slotted|(?:image-set|image|src|paint)\s*\(/i.test(css)) {
    throw new Error('Unsafe diagram stylesheet.')
  }
  const withoutLocalUrls = css.replace(/url\(\s*(['"]?)(#[\w-]+)\1\s*\)/gi, (_match, _quote, reference: string) => {
    if (!ids.has(reference.slice(1))) throw new Error('Unknown diagram resource.')
    return ''
  })
  if (/url\s*\(/i.test(withoutLocalUrls)) throw new Error('External diagram resources are disabled.')
}

export function sanitizeMermaidSvg(markup: string): DocumentFragment {
  // Keep the application boundary independent of hooks used by Mermaid or
  // any other consumer of DOMPurify's default instance.
  const fragment = DOMPurify(window).sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: [
      'foreignObject', 'script', 'a', 'image', 'feImage', 'use',
      'animate', 'animateMotion', 'animateTransform', 'set',
    ],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  const svg = fragment.firstElementChild
  if (fragment.children.length !== 1 || svg?.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('Invalid diagram SVG.')
  }
  const ids = new Set(Array.from(svg.querySelectorAll('[id]'), (element) => element.id))
  if (svg.id) ids.add(svg.id)

  for (const element of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase()
      if (name === 'href') {
        const reference = attribute.value
        if (!reference.startsWith('#') || !ids.has(reference.slice(1))) element.removeAttributeNode(attribute)
      } else if (RESOURCE_ATTRIBUTES.has(name)) {
        // Also covers presentation attributes such as fill and marker-end.
        validateCss(attribute.value, ids)
      }
    }
  }
  for (const style of Array.from(svg.querySelectorAll('style'))) {
    const css = style.textContent ?? ''
    validateCss(css, ids)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    // Only ordinary style rules are needed for static diagrams. Drop imports,
    // font faces, keyframes, grouping and nested rules.
    style.textContent = Array.from(sheet.cssRules)
      .filter((rule) => rule.type === CSSRule.STYLE_RULE && !(rule as CSSStyleRule).cssRules?.length)
      .map((rule) => rule.cssText)
      .join('\n')
  }
  return fragment
}
