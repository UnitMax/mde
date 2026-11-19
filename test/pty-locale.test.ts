import { describe, expect, it } from 'vitest'
import { macTerminalLang } from '../src/main/pty/locale'

const all = () => true

describe('macTerminalLang', () => {
  it('names a UTF-8 locale after the app locale when the environment has none', () => {
    expect(macTerminalLang({}, 'de-DE', all)).toBe('de_DE.UTF-8')
    expect(macTerminalLang({}, 'en-US', all)).toBe('en_US.UTF-8')
    expect(macTerminalLang({}, 'zh-Hans-CN', all)).toBe('zh_CN.UTF-8')
    expect(macTerminalLang({}, 'pt_BR', all)).toBe('pt_BR.UTF-8')
  })

  it('gives a language without a region its usual one', () => {
    expect(macTerminalLang({}, 'de', all)).toBe('de_DE.UTF-8')
    expect(macTerminalLang({}, 'en', all)).toBe('en_US.UTF-8')
    expect(macTerminalLang({}, 'ja', all)).toBe('ja_JP.UTF-8')
  })

  it('falls back to en_US.UTF-8 when the locale does not exist or the app locale is unusable', () => {
    expect(macTerminalLang({}, 'xx-YY', () => false)).toBe('en_US.UTF-8')
    expect(macTerminalLang({}, '', all)).toBe('en_US.UTF-8')
    expect(macTerminalLang({}, '123', all)).toBe('en_US.UTF-8')
  })

  it('leaves a locale the person set alone', () => {
    expect(macTerminalLang({ LANG: 'fr_FR.UTF-8' }, 'de-DE', all)).toBeNull()
    expect(macTerminalLang({ LC_ALL: 'C' }, 'de-DE', all)).toBeNull()
    expect(macTerminalLang({ LC_CTYPE: 'UTF-8' }, 'de-DE', all)).toBeNull()
  })
})
