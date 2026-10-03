import type { MermaidConfig } from 'mermaid'
import { getApplicationTheme, type ApplicationThemeId } from '@/theme/themes'
import { sanitizeMermaidSvg } from '@/lib/mermaid-svg'

export const MAX_MERMAID_SOURCE_LENGTH = 16_000

const config: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
  maxEdges: 200,
  suppressErrorRendering: true,
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'maxEdges',
    'suppressErrorRendering',
    'htmlLabels',
  ],
}

let mermaidPromise: Promise<typeof import('mermaid')['default']> | undefined
let nextDiagramId = 0
let renderQueue: Promise<unknown> = Promise.resolve()

function themeConfig(themeId: ApplicationThemeId): MermaidConfig {
  const { application: palette, terminal } = getApplicationTheme(themeId)
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif'
  const chartColors = [terminal.brightBlue, palette.ok, palette.warn, palette.danger, terminal.brightMagenta, terminal.brightCyan]
  return {
    theme: 'base',
    fontFamily,
    themeVariables: {
      darkMode: true,
      fontFamily,
      fontSize: '14px',
      background: palette.bg,
      textColor: palette.fg,
      primaryColor: palette.panel,
      primaryTextColor: palette.fg,
      primaryBorderColor: palette.accent,
      secondaryColor: palette.elevated,
      secondaryTextColor: palette.fg,
      secondaryBorderColor: palette.lineStrong,
      tertiaryColor: palette.active,
      tertiaryTextColor: palette.fg,
      tertiaryBorderColor: palette.lineStrong,
      lineColor: palette.fgMuted,
      mainBkg: palette.panel,
      nodeBorder: palette.accent,
      clusterBkg: palette.panel,
      clusterBorder: palette.lineStrong,
      edgeLabelBackground: palette.bg,
      titleColor: palette.fg,
      noteBkgColor: palette.elevated,
      noteTextColor: palette.fg,
      noteBorderColor: palette.accent,
      actorBkg: palette.panel,
      actorBorder: palette.accent,
      actorTextColor: palette.fg,
      signalColor: palette.fgMuted,
      signalTextColor: palette.fg,
      activationBkgColor: palette.active,
      activationBorderColor: palette.accent,
      ...Object.fromEntries(chartColors.flatMap((color, index) => [
        [`pie${index + 1}`, color],
        [`cScale${index}`, color],
      ])),
    },
  }
}

/** Repository content must not configure the renderer or its security policy. */
export function validateMermaidSource(source: string): void {
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
    throw new Error('Diagram is too large to preview.')
  }
  if (/%%\s*\{/.test(source) || /^\s*---(?:\r?\n|$)/.test(source)) {
    throw new Error('Diagram configuration directives and frontmatter are disabled.')
  }
}

export async function renderMermaidSvg(source: string, themeId: ApplicationThemeId): Promise<DocumentFragment> {
  validateMermaidSource(source)
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid)
  const mermaid = await mermaidPromise
  // initialize changes global Mermaid state. Keep it and rendering in one job
  // so concurrent previews cannot render with another diagram's theme.
  const result = renderQueue.then(async () => {
    mermaid.initialize({ ...config, ...themeConfig(themeId) })
    const { svg } = await mermaid.render(`mde-mermaid-${++nextDiagramId}`, source)
    return sanitizeMermaidSvg(svg)
  })
  renderQueue = result.catch(() => undefined)
  return result
}
