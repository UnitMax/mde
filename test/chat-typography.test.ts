import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A Windows checkout may turn line endings into CRLF; the rules are matched line by line.
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = read('src/renderer/index.css')
const rule = (selector: string): string => {
  const match = new RegExp(`^  ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm').exec(css)
  expect(match, `${selector} rule`).not.toBeNull()
  return match![1]!
}

describe('Inbox chat typography', () => {
  it('bundles Inter and puts it first in the sans stack', () => {
    expect(read('src/renderer/main.tsx')).toContain("import '@fontsource-variable/inter/wght.css'")
    expect(/--font-sans:\s*'Inter Variable',\s*'Segoe UI'/.test(css)).toBe(true)
    expect(JSON.parse(read('package.json')).dependencies['@fontsource-variable/inter']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('sets reply text at 14px and leaves the column width alone', () => {
    const markdown = read('src/renderer/components/inbox/ChatMarkdown.tsx')
    // The line height follows the size in one class string, or cn (tailwind-merge) drops it.
    expect(markdown).toContain("'text-[14px] leading-[1.65] text-[var(--chat-text)]'")
    expect(read('src/renderer/components/inbox/ChatMessageView.tsx')).toContain('text-[14px] leading-[1.65]')
    expect(read('src/renderer/components/inbox/ChatThreadView.tsx')).toContain('max-w-3xl')
  })

  it('draws inline code smaller, regular and in the code font', () => {
    const code = rule('.chat-markdown code,\n  .chat-markdown pre')
    expect(code).toContain('var(--inbox-code-font, var(--font-mono))')
    expect(code).toContain('font-size: 0.88em')
    expect(code).toContain('font-weight: 400')
  })

  it('keeps list items close and sizes headings apart', () => {
    expect(rule('.chat-markdown li > p,\n  .chat-markdown li > ul,\n  .chat-markdown li > ol')).toContain('margin: 0.2em 0')
    const sizes = ['h1', 'h2', 'h3'].map((tag) => Number(/font-size: ([\d.]+)em/.exec(rule(`.chat-markdown ${tag}`))![1]))
    expect(sizes[0]! > sizes[1]! && sizes[1]! > sizes[2]! && sizes[2]! > 1).toBe(true)
  })

  it('dims the words of a reply and brightens its headings, bold and inline code', () => {
    expect(read('src/renderer/components/inbox/ChatMarkdown.tsx')).toContain('text-[var(--chat-text)]')
    expect(css).toMatch(/--chat-text: color-mix\(in oklab, var\(--color-fg\) \d+%, var\(--color-bg\)\)/)
    expect(rule(".chat-reply :is(h1, h2, h3, h4, h5, h6, strong),\n  .chat-reply :not(pre) > code")).toContain('color: var(--chat-strong)')
    // A high-contrast theme keeps its words at full contrast.
    expect(css).toMatch(/:root\[data-theme\^='high-contrast'\] \{\s*--chat-text: var\(--color-fg\);/)
  })
})
