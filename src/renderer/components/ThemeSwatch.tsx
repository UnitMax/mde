import type { ApplicationThemeOption } from '@/theme/themes'

/** A theme in miniature: its panel, its working area and its accent, so the list shows what a name looks like. */
export function ThemeSwatch({ theme }: { theme: ApplicationThemeOption }): JSX.Element {
  const { panel, bg, accent, lineStrong } = theme.application
  return (
    <span
      aria-hidden="true"
      data-testid={`theme-swatch-${theme.id}`}
      className="inline-flex h-4 w-7 shrink-0 overflow-hidden rounded-sm border"
      style={{ borderColor: lineStrong }}
    >
      <span className="w-2" style={{ backgroundColor: panel }} />
      <span className="flex-1" style={{ backgroundColor: bg }} />
      <span className="w-2" style={{ backgroundColor: accent }} />
    </span>
  )
}
