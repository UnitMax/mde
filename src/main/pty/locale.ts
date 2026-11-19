import fs from 'node:fs'

const FALLBACK_LOCALE = 'en_US.UTF-8'

// The region a language's own locale is named after where it is not the language code in capitals.
const DEFAULT_REGIONS: Record<string, string> = {
  en: 'US', ja: 'JP', zh: 'CN', ko: 'KR', sv: 'SE', da: 'DK', nb: 'NO', no: 'NO', cs: 'CZ', el: 'GR',
  uk: 'UA', he: 'IL', ca: 'ES', eu: 'ES', et: 'EE', sl: 'SI', sr: 'RS', hy: 'AM', kk: 'KZ', ga: 'IE',
}

/**
 * The `LANG` a macOS terminal needs, or null when it needs none. An app started from the Dock gets no locale from the
 * shell profile, so its shells ran in the "C" locale, where zsh counts each byte of a prompt's non-ASCII character
 * (Starship's and Oh My Zsh's symbols) as a column: it then redrew the line in the wrong place after Tab, leaving a
 * stale copy of the command on screen. Terminal.app, iTerm and VS Code set `LANG` the same way. Any locale variable
 * the person set wins.
 */
export function macTerminalLang(
  environment: NodeJS.ProcessEnv,
  appLocale: string,
  localeExists: (name: string) => boolean = (name) => fs.existsSync(`/usr/share/locale/${name}`),
): string | null {
  if (environment.LC_ALL || environment.LC_CTYPE || environment.LANG) return null
  const [language = '', ...rest] = appLocale.split(/[-_]/)
  if (!/^[a-z]{2,3}$/i.test(language)) return FALLBACK_LOCALE
  const lower = language.toLowerCase()
  const region = rest.find((part) => /^[a-z]{2}$/i.test(part))?.toUpperCase() ?? DEFAULT_REGIONS[lower] ?? lower.toUpperCase()
  const name = `${lower}_${region}.UTF-8`
  return localeExists(name) ? name : FALLBACK_LOCALE
}
