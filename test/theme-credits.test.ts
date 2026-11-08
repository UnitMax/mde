import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadThemeCredits, renderThirdPartyNotices } from '../scripts/generate-third-party-notices.mjs'
import { APPLICATION_THEMES } from '../src/renderer/theme/themes'

const root = join(__dirname, '..')
const credits = loadThemeCredits()

function licenseText(file: string): string {
  return readFileSync(join(root, 'scripts', 'license-overrides', file), 'utf8').replaceAll('\r\n', '\n').trim()
}

describe('theme credits', () => {
  it('names every theme MDE made itself, and only those', () => {
    const original = APPLICATION_THEMES.filter((theme) => theme.source === undefined).map(({ id, label }) => ({ id, label }))
    expect(credits.original).toEqual(original)
  })

  it('credits every adapted theme to exactly the project its palette comes from', () => {
    const adapted = APPLICATION_THEMES.filter((theme) => theme.source !== undefined)
    expect(adapted.length).toBeGreaterThan(0)
    for (const theme of adapted) {
      const sources = credits.sources.filter((source) => source.themes.some((credited) => credited.id === theme.id))
      expect(sources.map((source) => source.key), theme.id).toEqual([theme.source])
      expect(sources[0]!.themes.find((credited) => credited.id === theme.id)!.label).toBe(theme.label)
    }
  })

  it('lists no theme that does not exist, and every source at most once', () => {
    const keys = credits.sources.map((source) => source.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const source of credits.sources) {
      expect(source.themes.length, source.key).toBeGreaterThan(0)
      for (const credited of source.themes) {
        const theme = APPLICATION_THEMES.find((candidate) => candidate.id === credited.id)
        expect(theme?.source, credited.id).toBe(source.key)
      }
    }
  })

  it.each(credits.sources.map((source) => [source.key, source] as const))('%s: ships the project’s own MIT license text', (_key, source) => {
    expect(source.license).toBe('MIT')
    expect(source.url).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/)
    expect(source.changes.length).toBeGreaterThan(20)
    const text = licenseText(source.licenseFile)
    // Projects wrap the same MIT text differently, so compare it without line breaks.
    const flat = text.replace(/\s+/g, ' ')
    expect(flat).toContain('Permission is hereby granted, free of charge')
    expect(flat).toContain('The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.')
    expect(flat).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
    // The copyright line in the data is the one in the license, not a paraphrase.
    expect(text.split('\n')).toContain(source.copyright)
  })

  it('writes every credit into the generated notices, which are the ones the About dialog and the releases carry', () => {
    const rendered = renderThirdPartyNotices()
    expect(rendered).toContain('## Color themes')
    for (const source of credits.sources) {
      expect(rendered, source.key).toContain(`### ${source.name}`)
      expect(rendered, source.key).toContain(source.url)
      expect(rendered, source.key).toContain(licenseText(source.licenseFile))
      for (const theme of source.themes) expect(rendered).toContain(`| ${theme.label} | ${source.name} | ${source.url} | ${source.license} |`)
    }
    // The committed file is the one that ships; a stale copy would drop a theme's attribution.
    const committed = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').replaceAll('\r\n', '\n')
    expect(committed).toBe(rendered)
  })
})
