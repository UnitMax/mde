import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(`../src/renderer/${path}`, import.meta.url), 'utf8')

describe('menu separators', () => {
  it('are a 12px block with a hairline, so every separator sits on the same sub-pixel at 125% and 150% scaling', () => {
    const { MENU_SEPARATOR_CLASS } = { MENU_SEPARATOR_CLASS: /MENU_SEPARATOR_CLASS = '([^']+)'/.exec(read('components/ui/menu-separator.ts'))![1] }
    expect(MENU_SEPARATOR_CLASS).toContain('h-3')
    expect(MENU_SEPARATOR_CLASS).toContain('before:h-px')
    expect(MENU_SEPARATOR_CLASS).not.toMatch(/\bmy-/)
  })

  it('are used by both menus, whose items are a whole 32px (20px line plus 12px padding) rather than 30.85px', () => {
    for (const file of ['components/ui/context-menu.tsx', 'components/ui/dropdown-menu.tsx']) {
      const source = read(file)
      expect(source).toContain('MENU_SEPARATOR_CLASS')
      expect(source).not.toContain('h-px bg-line')
      for (const line of source.split('\n').filter((text) => text.includes('py-1.5') && text.includes('text-[13px]'))) {
        expect(line).toContain('leading-5')
      }
    }
  })
})
