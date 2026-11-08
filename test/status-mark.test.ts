// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusMark, statusGlyph } from '../src/renderer/components/inbox/StatusMark'
import { APPLICATION_THEMES } from '../src/renderer/theme/themes'

const css = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.css'), 'utf8')

/** How much of its color the label of a state keeps when the stylesheet mixes it toward the text color. */
function labelShare(): number {
  return Number(/\.status-mark \{[^}]*?color: color-mix\(in srgb, var\(--mark\) (\d+)%/.exec(css)?.[1])
}

/** The tones whose label is their own color, and the ones whose label is the muted text color. */
const TONED = { accent: 'accent', danger: 'danger' } as const

const channel = (value: number): number => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const luminance = (c: number[]): number => 0.2126 * channel(c[0]!) + 0.7152 * channel(c[1]!) + 0.0722 * channel(c[2]!)
const mix = (a: number[], b: number[], share: number): number[] => a.map((v, i) => v * share + b[i]! * (1 - share))
function contrast(a: number[], b: number[]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('the status mark’s colors', () => {
  it('has a tone for each state the Inbox shows, with the quiet ones in the muted text color', () => {
    expect(labelShare()).toBeGreaterThan(50)
    for (const tone of ['accent', 'danger', 'muted', 'ok']) expect(css).toContain(`.status-mark[data-tone='${tone}']`)
    expect(/\.status-mark\[data-tone='ok'\] \{[^}]*color: var\(--color-fg-muted\)/.test(css)).toBe(true)
    expect(/\.status-mark\[data-tone='muted'\] \{[^}]*color: var\(--color-fg-muted\)/.test(css)).toBe(true)
    expect(css).not.toMatch(/\.status-mark[^{]*\{[^}]*(background|box-shadow|border)/)
  })

  it.each(APPLICATION_THEMES.map((theme) => [theme.id, theme] as const))('%s: every label can be read on every surface, and every glyph seen', (_id, theme) => {
    const floor = theme.id.startsWith('high-contrast') ? 7 : 4.5
    for (const [name, color] of Object.entries(TONED)) {
      for (const surface of ['bg', 'panel', 'elevated'] as const) {
        const ground = rgb(theme.application[surface])
        const text = mix(rgb(theme.application[color]), rgb(theme.application.fg), labelShare() / 100)
        expect(contrast(text, ground), `${name} label on ${surface}`).toBeGreaterThanOrEqual(floor)
      }
    }
    for (const surface of ['bg', 'panel', 'elevated'] as const) {
      const ground = rgb(theme.application[surface])
      expect(contrast(rgb(theme.application.fgMuted), ground), `muted label on ${surface}`).toBeGreaterThanOrEqual(floor)
      // The glyph is not text, so it has to be seen, not read.
      for (const color of ['accent', 'ok', 'danger'] as const) {
        expect(contrast(rgb(theme.application[color]), ground), `${color} glyph on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

/** `data-*` attributes are not in the mark's prop types, though it passes them on. */
const testId = (id: string): object => ({ 'data-testid': id })

describe('StatusMark', () => {
  let root: Root
  let container: HTMLElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('leads with a glyph that tells the states apart without their color', async () => {
    const glyphs = ['spinner', 'pulse', 'check', 'cross', 'none'] as const
    await act(async () => root.render(createElement('div', null, glyphs.map((glyph) => createElement(StatusMark, { key: glyph, tone: 'ok', glyph, children: glyph, ...testId(glyph) })))))
    const at = (glyph: string): HTMLElement => container.querySelector(`[data-testid="${glyph}"]`)!
    expect(at('spinner').querySelector('.animate-spin')).not.toBeNull()
    expect(at('pulse').querySelector('.status-pulse')).not.toBeNull()
    expect(at('check').querySelector('svg')).not.toBeNull()
    expect(at('cross').querySelector('svg')).not.toBeNull()
    expect(at('none').querySelector('svg, .status-pulse')).toBeNull()
    // The glyph is decoration: the label is what is read out.
    expect(at('check').textContent).toBe('check')
    expect(at('check').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('carries its tone, and maps each thread status to a glyph', async () => {
    await act(async () => root.render(createElement(StatusMark, { tone: 'danger', children: 'Failed', ...testId('mark') })))
    expect(container.querySelector('[data-testid="mark"]')?.getAttribute('data-tone')).toBe('danger')
    expect(container.querySelector('[data-testid="mark"]')?.className).toContain('status-mark')
    expect(['idle', 'working', 'attention', 'completed', 'error'].map((status) => statusGlyph(status as never)))
      .toEqual(['none', 'spinner', 'pulse', 'check', 'cross'])
  })
})
