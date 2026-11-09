import { useEffect, useRef } from 'react'
import { fancyPaletteForTheme } from '@/fancy/color'
import { mountThreadEffect } from '@/fancy/thread-effect-host'
import type { ThreadEffectKind } from '@/fancy/thread-effects'
import { useThemeId } from '@/fancy/use-theme-id'
import { useFancyThreadEffectsOn } from '@/store/fancy-mode'

/**
 * Fancy mode's effect behind a thread row: lightning for an unread thread, digital rain for a working one. The row
 * must be an isolated stacking context (`isolate`) so that the canvas, at a negative z-index, sits above the row's
 * own color and below its text. Renders nothing while fancy mode or its thread effects are off.
 *
 * `force` shows the effect whatever the settings say, for the preview in Settings.
 */
export function ThreadEffect({
  kind,
  seed,
  force = false
}: {
  kind: ThreadEffectKind
  /** Anything that stays the same for this row: its pattern of strikes and rain is drawn from it. */
  seed: string
  force?: boolean
}): JSX.Element | null {
  const settingOn = useFancyThreadEffectsOn()
  const on = force || settingOn
  const themeId = useThemeId()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!on || !canvas.current) return
    return mountThreadEffect(canvas.current, kind, fancyPaletteForTheme(themeId), seed)
  }, [on, kind, seed, themeId])

  if (!on) return null
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-testid="fancy-thread-effect"
      data-effect={kind}
      className="fancy-thread-effect pointer-events-none absolute inset-0 -z-10 h-full w-full rounded"
    />
  )
}
