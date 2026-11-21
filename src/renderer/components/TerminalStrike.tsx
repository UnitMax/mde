import { useEffect, useRef } from 'react'
import { fancyPaletteForTheme } from '@/fancy/color'
import { playTerminalStrike } from '@/fancy/terminal-strike'
import { useThemeId } from '@/fancy/use-theme-id'
import { onTerminalCommand } from '@/terminal/command-events'
import { useFancyTerminalStrikesOn } from '@/store/fancy-mode'

/**
 * Fancy mode's lightning over a terminal pane: it strikes once each time a command is entered there. The canvas lies
 * over the whole pane, lets every click through, and is empty between strikes. Renders nothing while fancy mode or
 * its terminal lightning is off.
 */
export function TerminalStrike({ terminalId }: { terminalId: string }): JSX.Element | null {
  const on = useFancyTerminalStrikesOn()
  const themeId = useThemeId()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!on) return
    let stop: (() => void) | null = null
    let count = 0
    const unsubscribe = onTerminalCommand(terminalId, () => {
      if (!canvas.current) return
      // A new command cuts the last strike short, and each one strikes differently.
      stop?.()
      count += 1
      stop = playTerminalStrike(canvas.current, fancyPaletteForTheme(themeId), `${terminalId}:${count}:${Date.now()}`)
    })
    return () => {
      unsubscribe()
      stop?.()
    }
  }, [on, terminalId, themeId])

  if (!on) return null
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-testid="fancy-terminal-strike"
      className="fancy-terminal-strike pointer-events-none absolute inset-0 z-20 h-full w-full"
    />
  )
}
