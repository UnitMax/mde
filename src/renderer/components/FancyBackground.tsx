import { useEffect, useRef } from 'react'
import { mountBackground } from '@/fancy/background-host'
import { fancyPaletteForTheme } from '@/fancy/color'
import { useThemeId } from '@/fancy/use-theme-id'
import { useFancyBackgroundOn, useFancyMode } from '@/store/fancy-mode'

/**
 * The animated background of fancy mode. It fills the window behind everything (the app's root is an isolated
 * stacking context, so a negative z-index puts it above the root's own color and below every panel) and lets every
 * click through. Panels that should show it carry `fancy-glass`; the rest stay solid.
 */
export function FancyBackground(): JSX.Element | null {
  const enabled = useFancyBackgroundOn()
  const background = useFancyMode((state) => state.settings.background)
  const themeId = useThemeId()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!enabled || !canvas.current) return
    const host = mountBackground(canvas.current, background, fancyPaletteForTheme(themeId), { followPointer: true })
    return () => host.dispose()
  }, [enabled, background, themeId])

  if (!enabled) return null
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-testid="fancy-background"
      data-background={background}
      className="fancy-background pointer-events-none absolute inset-0 -z-10 h-full w-full"
    />
  )
}
