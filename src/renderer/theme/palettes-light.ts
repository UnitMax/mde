import type { ApplicationThemeOption } from './types'

/*
 * Light themes keep the same layers as the dark ones, in the same order of depth: `elevated` is the brightest
 * surface (cards, menus and the composer, which cast a shadow), `bg` is the working area and the wells inside
 * cards, `panel` is the chrome around them, and `hover` and `active` are darker still.
 *
 * Except for High contrast light, the palettes are adapted from the projects named in `source`; see the
 * "Color themes" section of THIRD_PARTY_NOTICES.md. Adapted means the hues are theirs and the surfaces are fitted
 * to MDE's layers, with a few grays moved to keep text readable.
 */

/** Light terminals draw the faint grays programs pick for a dark ground, so xterm lifts them to this ratio. */
const LIGHT_MINIMUM_CONTRAST = 4.5

export const HIGH_CONTRAST_LIGHT: ApplicationThemeOption = {
  id: 'high-contrast-light',
  label: 'High contrast light',
  mode: 'light',
  minimumContrastRatio: 7,
  application: {
    bg: '#ffffff',
    panel: '#f2f2f2',
    elevated: '#ffffff',
    hover: '#e0e0e0',
    active: '#cccccc',
    line: '#767676',
    lineStrong: '#404040',
    fg: '#000000',
    fgMuted: '#262626',
    fgSubtle: '#454545',
    accent: '#0033aa',
    accentHover: '#001f7a',
    accentFg: '#ffffff',
    ok: '#005c19',
    warn: '#6b4600',
    danger: '#a80000',
    scrollbarHover: '#595959',
    shade: '#000000'
  },
  terminal: {
    background: '#ffffff',
    foreground: '#000000',
    cursor: '#000000',
    cursorAccent: '#ffffff',
    selectionBackground: '#a8c8ff',
    black: '#000000',
    red: '#a80000',
    green: '#005c19',
    yellow: '#6b4600',
    blue: '#0033aa',
    magenta: '#7a007a',
    cyan: '#005f66',
    white: '#4a4a4a',
    brightBlack: '#3d3d3d',
    brightRed: '#8f0000',
    brightGreen: '#004d14',
    brightYellow: '#573700',
    brightBlue: '#002288',
    brightMagenta: '#5f005f',
    brightCyan: '#004a50',
    brightWhite: '#262626'
  }
}

export const GITHUB_LIGHT: ApplicationThemeOption = {
  id: 'github-light',
  label: 'GitHub Light',
  mode: 'light',
  source: 'github',
  minimumContrastRatio: LIGHT_MINIMUM_CONTRAST,
  application: {
    bg: '#f6f8fa',
    panel: '#eaeef2',
    elevated: '#ffffff',
    hover: '#dde3ea',
    active: '#cfd7df',
    line: '#d0d7de',
    lineStrong: '#afb8c1',
    fg: '#1f2328',
    fgMuted: '#59636e',
    fgSubtle: '#6e7781',
    accent: '#0969da',
    accentHover: '#0550ae',
    accentFg: '#ffffff',
    ok: '#1a7f37',
    warn: '#9a6700',
    danger: '#cf222e',
    scrollbarHover: '#afb8c1',
    shade: '#24292f'
  },
  terminal: {
    background: '#f6f8fa',
    foreground: '#1f2328',
    cursor: '#0969da',
    cursorAccent: '#f6f8fa',
    selectionBackground: '#b6d4f5',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#1b73d4',
    brightMagenta: '#835ec7',
    brightCyan: '#2a7c90',
    brightWhite: '#8c959f'
  },
  syntax: {
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    function: '#8250df',
    type: '#953800',
    property: '#0550ae'
  }
}

export const SOLARIZED_LIGHT: ApplicationThemeOption = {
  id: 'solarized-light',
  label: 'Solarized Light',
  mode: 'light',
  source: 'solarized',
  minimumContrastRatio: LIGHT_MINIMUM_CONTRAST,
  application: {
    bg: '#fdf6e3',
    panel: '#eee8d5',
    elevated: '#fffcf2',
    hover: '#e4ddc7',
    active: '#d8d1b8',
    line: '#e0d9c1',
    lineStrong: '#c4bda4',
    fg: '#073642',
    fgMuted: '#546a70',
    fgSubtle: '#6b7f86',
    accent: '#1d72af',
    accentHover: '#17608f',
    accentFg: '#fdf6e3',
    ok: '#6b7c00',
    warn: '#8c6a00',
    danger: '#d12c29',
    scrollbarHover: '#b5ae95',
    shade: '#073642'
  },
  terminal: {
    background: '#fdf6e3',
    foreground: '#073642',
    cursor: '#073642',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#d8d1b8',
    black: '#073642',
    red: '#d12c29',
    green: '#6b7c00',
    yellow: '#8c6a00',
    blue: '#1d72af',
    magenta: '#cd347e',
    cyan: '#1b8079',
    white: '#657b83',
    brightBlack: '#546a70',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#7a5c00',
    brightBlue: '#17608f',
    brightMagenta: '#676bba',
    brightCyan: '#157068',
    brightWhite: '#546a70'
  },
  syntax: {
    keyword: '#6b7c00',
    string: '#1b8079',
    number: '#cd347e',
    function: '#1d72af',
    type: '#8c6a00',
    property: '#6c71c4'
  }
}

export const CATPPUCCIN_LATTE: ApplicationThemeOption = {
  id: 'catppuccin-latte',
  label: 'Catppuccin Latte',
  mode: 'light',
  source: 'catppuccin',
  minimumContrastRatio: LIGHT_MINIMUM_CONTRAST,
  application: {
    bg: '#eff1f5',
    panel: '#e6e9ef',
    elevated: '#fafbfd',
    hover: '#dce0e8',
    active: '#ccd0da',
    line: '#ccd0da',
    lineStrong: '#acb0be',
    fg: '#4c4f69',
    fgMuted: '#5c5f77',
    fgSubtle: '#737689',
    accent: '#8839ef',
    accentHover: '#7527d9',
    accentFg: '#ffffff',
    ok: '#297b19',
    warn: '#995c0a',
    danger: '#d20f39',
    scrollbarHover: '#acb0be',
    shade: '#4c4f69'
  },
  terminal: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    cursorAccent: '#eff1f5',
    selectionBackground: '#ccd0da',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#297b19',
    yellow: '#995c0a',
    blue: '#1e66f5',
    magenta: '#b64294',
    cyan: '#127b81',
    white: '#6c6f85',
    brightBlack: '#686b80',
    brightRed: '#b50c30',
    brightGreen: '#257016',
    brightYellow: '#8c5409',
    brightBlue: '#1550c4',
    brightMagenta: '#a8337f',
    brightCyan: '#0e6267',
    brightWhite: '#7c7f93'
  },
  syntax: {
    keyword: '#8839ef',
    string: '#297b19',
    number: '#c24e07',
    function: '#1e66f5',
    type: '#995c0a',
    property: '#127b81'
  }
}

export const GRUVBOX_LIGHT: ApplicationThemeOption = {
  id: 'gruvbox-light',
  label: 'Gruvbox Light',
  mode: 'light',
  source: 'gruvbox',
  minimumContrastRatio: LIGHT_MINIMUM_CONTRAST,
  application: {
    bg: '#fbf1c7',
    panel: '#ebdbb2',
    elevated: '#fef9dc',
    hover: '#e1d1a9',
    active: '#d5c4a1',
    line: '#d5c4a1',
    lineStrong: '#bdae93',
    fg: '#3c3836',
    fgMuted: '#504945',
    fgSubtle: '#6f6358',
    accent: '#076678',
    accentHover: '#054e5c',
    accentFg: '#fbf1c7',
    ok: '#79740e',
    warn: '#9a5f0c',
    danger: '#9d0006',
    scrollbarHover: '#bdae93',
    shade: '#3c3836'
  },
  terminal: {
    background: '#fbf1c7',
    foreground: '#3c3836',
    cursor: '#3c3836',
    cursorAccent: '#fbf1c7',
    selectionBackground: '#d5c4a1',
    black: '#3c3836',
    red: '#9d0006',
    green: '#79740e',
    yellow: '#9a5f0c',
    blue: '#076678',
    magenta: '#8f3f71',
    cyan: '#427b58',
    white: '#7c6f64',
    brightBlack: '#665c54',
    brightRed: '#cc241d',
    brightGreen: '#747314',
    brightYellow: '#9a6411',
    brightBlue: '#3e787a',
    brightMagenta: '#9f5879',
    brightCyan: '#507952',
    brightWhite: '#504945'
  },
  syntax: {
    keyword: '#9d0006',
    string: '#79740e',
    number: '#8f3f71',
    function: '#076678',
    type: '#9a5f0c',
    property: '#427b58'
  }
}
