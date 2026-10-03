import CodeBlock from '@tiptap/extension-code-block'
import { renderMermaidSvg } from '@/lib/mermaid-preview'
import { getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

/** A view-only replacement; the underlying document remains a code block. */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node }) => {
      const language = node.attrs.language
      if (language !== 'mermaid') {
        const dom = document.createElement('pre')
        const code = document.createElement('code')
        if (language) code.className = `language-${language}`
        dom.append(code)
        return {
          dom,
          contentDOM: code,
          update: (next) => next.type === node.type && next.attrs.language === language,
        }
      }

      const dom = document.createElement('div')
      dom.className = 'mermaid-diagram'
      dom.setAttribute('role', 'figure')
      dom.setAttribute('aria-label', 'Mermaid diagram')
      let generation = 0
      let theme = getTerminalSettings().theme

      const render = (source: string): void => {
        const current = ++generation
        const fallback = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = source
        fallback.append(code)
        dom.replaceChildren(fallback)
        dom.setAttribute('aria-busy', 'true')

        void renderMermaidSvg(source, theme).then(
          (fragment) => {
            if (current !== generation) return
            const host = document.createElement('div')
            host.className = 'mermaid-svg'
            const shadow = host.attachShadow({ mode: 'open' })
            const style = document.createElement('style')
            style.textContent = `
              :host { display: block; user-select: text; }
              svg { display: block; margin: 0 auto; max-width: none !important; }
              svg text, svg tspan { user-select: text !important; cursor: text; }
            `
            const svg = fragment.querySelector('svg')
            const dimensions = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
            const width = dimensions?.[2]
            if (svg && width && Number.isFinite(width) && width > 0) {
              svg.setAttribute('width', String(width))
              svg.style.width = `${width}px`
              svg.style.height = 'auto'
            }
            shadow.append(fragment, style)
            dom.replaceChildren(host)
            dom.removeAttribute('aria-busy')
          },
          () => {
            if (current !== generation) return
            const error = document.createElement('p')
            error.textContent = 'Cannot preview this Mermaid diagram. Check its syntax, size, and configuration.'
            dom.replaceChildren(error, fallback)
            dom.removeAttribute('aria-busy')
          },
        )
      }

      let source = node.textContent
      render(source)
      const unsubscribe = subscribeTerminalSettings(() => {
        const nextTheme = getTerminalSettings().theme
        if (nextTheme === theme) return
        theme = nextTheme
        render(source)
      })
      return {
        dom,
        update: (next) => {
          if (next.type !== node.type || next.attrs.language !== language) return false
          if (next.textContent !== source) {
            source = next.textContent
            render(source)
          }
          return true
        },
        ignoreMutation: () => true,
        // Let Chromium handle selection/copy inside the SVG rather than letting
        // ProseMirror turn a mouse drag into a document/node selection.
        stopEvent: (event) => event.composedPath().some((target) => target instanceof ShadowRoot),
        destroy: () => {
          generation += 1
          unsubscribe()
        },
      }
    }
  },
})
