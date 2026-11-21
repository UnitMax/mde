import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SwitchRow } from '@/components/ui/switch'
import { ThreadEffect } from '@/components/ThreadEffect'
import { mountBackground } from '@/fancy/background-host'
import { backgroundOpacity, fancyPaletteForTheme } from '@/fancy/color'
import { playTerminalStrike } from '@/fancy/terminal-strike'
import { FANCY_BACKGROUND_OPTIONS, type FancyBackgroundId } from '@/fancy/settings'
import { useThemeId } from '@/fancy/use-theme-id'
import { cn } from '@/lib/utils'
import { useFancyMode } from '@/store/fancy-mode'

/** A small live picture of one background. It moves while it is hovered, focused or chosen, and rests otherwise. */
function BackgroundPreview({ id, active }: { id: FancyBackgroundId; active: boolean }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const themeId = useThemeId()
  useEffect(() => {
    if (!canvas.current) return
    const palette = fancyPaletteForTheme(themeId)
    // These are made for a whole window, so each is laid out at a larger size and scaled down to fit the card.
    const host = mountBackground(canvas.current, id, palette, {
      animated: active,
      design: id === 'aurora' ? { width: 640, height: 352 } : id === 'constellation' ? { width: 400, height: 220 } : { width: 480, height: 264 },
      // A preview is a little punchier than the background it stands for.
      opacity: Math.min(1, backgroundOpacity(palette) * 1.5)
    })
    return () => host.dispose()
  }, [id, themeId, active])
  return <canvas ref={canvas} aria-hidden="true" className="block h-24 w-full" />
}

/** Two rows as they look in the Inbox's thread list, one unread and one working, to show what the effects do. */
function ThreadEffectPreview(): JSX.Element {
  const rows = [
    { kind: 'unread' as const, title: 'Rework the keyboard shortcuts', project: 'mde', status: 'Needs input', unread: true },
    { kind: 'working' as const, title: 'Migrate the build to Vite 7', project: 'api-server', status: 'Working', unread: false }
  ]
  return (
    <div className="grid max-w-[260px] gap-1 rounded border border-line bg-panel p-2" data-testid="fancy-thread-preview">
      {rows.map((row) => (
        <div
          key={row.kind}
          className={cn('relative isolate rounded px-2.5 py-2', row.unread ? 'bg-accent/[0.08]' : '')}
        >
          <ThreadEffect kind={row.kind} seed={`preview:${row.kind}`} force />
          <div className="flex items-center gap-1.5">
            {row.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
            <span className={cn('min-w-0 flex-1 truncate text-[14px] text-fg', row.unread ? 'font-bold' : 'font-normal')}>{row.title}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[11px] text-fg-muted">
            <span>{row.project}</span>
            <span>{row.status}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** A small terminal that is struck when the button is pressed, to show the terminal lightning. */
function TerminalStrikePreview(): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stop = useRef<(() => void) | null>(null)
  const themeId = useThemeId()
  useEffect(() => () => stop.current?.(), [])
  const strike = (): void => {
    if (!canvas.current) return
    stop.current?.()
    stop.current = playTerminalStrike(canvas.current, fancyPaletteForTheme(themeId), `preview:${Date.now()}`)
  }
  return (
    <div className="flex items-end gap-2">
      <div
        className="relative h-24 w-full max-w-[260px] overflow-hidden rounded border border-line bg-bg p-2 font-mono text-[11px] leading-relaxed text-fg-muted"
        data-testid="fancy-terminal-preview"
      >
        <div><span className="text-accent">~/app</span> $ npm run dev</div>
        <div className="text-fg-subtle">ready on http://localhost:3000</div>
        <div><span className="text-accent">~/app</span> $ <span className="inline-block h-3 w-1.5 translate-y-0.5 bg-fg-muted" /></div>
        <canvas ref={canvas} aria-hidden="true" className="fancy-terminal-strike pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <Button type="button" size="sm" variant="secondary" data-testid="fancy-terminal-preview-strike" onClick={strike}>
        Try it
      </Button>
    </div>
  )
}

/** Settings, Appearance: fancy mode, its background and its thread effects. */
export function FancyModeSettings(): JSX.Element {
  const settings = useFancyMode((state) => state.settings)
  const update = useFancyMode((state) => state.update)
  const [hovered, setHovered] = useState<FancyBackgroundId | null>(null)

  return (
    <div className="space-y-3" data-testid="fancy-mode-settings">
      <SwitchRow
        checked={settings.enabled}
        label="Fancy mode"
        description="Animated backgrounds, lightning and digital rain on the Inbox's threads, and lightning in terminals. It uses some extra processor time and rests while MDE is hidden. With reduced motion on in your system, it shows still pictures."
        testId="fancy-mode"
        onClick={() => update({ enabled: !settings.enabled })}
      />

      {settings.enabled && (
        // Everything fancy mode offers hangs off its switch, on a rail, so it reads as part of it.
        <div
          role="group"
          aria-label="Fancy mode options"
          data-testid="fancy-mode-options"
          className="ml-3 space-y-3 border-l-2 border-accent/40 pl-4"
        >
          <SwitchRow
            checked={settings.backgroundEnabled}
            label="Animated background"
            description="Show an animated background behind the app."
            testId="fancy-background-enabled"
            onClick={() => update({ backgroundEnabled: !settings.backgroundEnabled })}
          />
          {settings.backgroundEnabled && <div role="radiogroup" aria-label="Animated background" className="grid grid-cols-3 gap-2">
            {FANCY_BACKGROUND_OPTIONS.map((option) => {
              const selected = settings.background === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`fancy-background-${option.id}`}
                  onClick={() => update({ background: option.id })}
                  onPointerEnter={() => setHovered(option.id)}
                  onPointerLeave={() => setHovered((current) => (current === option.id ? null : current))}
                  onFocus={() => setHovered(option.id)}
                  onBlur={() => setHovered((current) => (current === option.id ? null : current))}
                  className={cn(
                    'overflow-hidden rounded border bg-bg text-left text-xs transition-colors',
                    selected ? 'border-accent' : 'border-line hover:border-line-strong'
                  )}
                >
                  <BackgroundPreview id={option.id} active={selected || hovered === option.id} />
                  <span className="block border-t border-line bg-panel px-2.5 py-2">
                    <span className="block font-medium text-fg">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{option.description}</span>
                  </span>
                </button>
              )
            })}
          </div>}

          <SwitchRow
            checked={settings.threadEffects}
            label="Thread effects"
            description="Lightning crackles across unread threads in the Inbox, and digital rain falls through the ones that are working."
            testId="fancy-thread-effects"
            onClick={() => update({ threadEffects: !settings.threadEffects })}
          />
          {settings.threadEffects && <ThreadEffectPreview />}

          <SwitchRow
            checked={settings.terminalStrikes}
            label="Terminal lightning"
            description="Lightning strikes across a terminal each time you enter a command in it. Full-screen programs such as editors are left alone."
            testId="fancy-terminal-strikes"
            onClick={() => update({ terminalStrikes: !settings.terminalStrikes })}
          />
          {settings.terminalStrikes && <TerminalStrikePreview />}
        </div>
      )}
    </div>
  )
}
