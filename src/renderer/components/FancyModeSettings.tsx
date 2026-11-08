import { useEffect, useRef, useState } from 'react'
import { SwitchRow } from '@/components/ui/switch'
import { ThreadEffect } from '@/components/ThreadEffect'
import { mountBackground } from '@/fancy/background-host'
import { backgroundOpacity, fancyPaletteForTheme } from '@/fancy/color'
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
        description="Animated backgrounds, and lightning and digital rain on the Inbox's threads. It uses some extra processor time and rests while MDE is hidden. With reduced motion on in your system, it shows still pictures."
        testId="fancy-mode"
        onClick={() => update({ enabled: !settings.enabled })}
      />

      {settings.enabled && (
        <>
          <div role="radiogroup" aria-label="Animated background" className="grid grid-cols-3 gap-2">
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
          </div>

          <SwitchRow
            checked={settings.threadEffects}
            label="Thread effects"
            description="Lightning crackles across unread threads in the Inbox, and digital rain falls through the ones that are working."
            testId="fancy-thread-effects"
            onClick={() => update({ threadEffects: !settings.threadEffects })}
          />
          {settings.threadEffects && <ThreadEffectPreview />}
        </>
      )}
    </div>
  )
}
