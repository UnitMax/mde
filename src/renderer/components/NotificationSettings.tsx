import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SwitchRow } from '@/components/ui/switch'
import {
  ALERT_FLASHES,
  ALERT_SOUND_CHOICES,
  getAlertSettings,
  saveAlertSettings,
  type AlertFlash,
  type AlertSettings,
  type AlertSoundChoice
} from '@/lib/alert-settings'
import { playAlertChoice } from '@/lib/alert-sound'
import { useWorkspace } from '@/store/workspace'
import { ALERT_KINDS, type AlertKind } from '@shared/taskbar-attention'

const KIND_LABELS: Record<AlertKind, { label: string; description: string }> = {
  done: { label: 'Done', description: 'A thread finished its work.' },
  input: { label: 'Needs input', description: 'A thread asks a question or for permission.' },
  failed: { label: 'Failed', description: 'A thread stopped with an error.' }
}

const CHOICE_LABELS: Record<AlertSoundChoice, string> = {
  chime: 'Chime',
  bell: 'Bell',
  pluck: 'Pluck',
  beep: 'System beep',
  off: 'Off'
}

const FLASH_LABELS: Record<AlertFlash, string> = {
  off: 'Off',
  brief: 'A few times',
  'until-focus': 'Until I come back to MDE'
}

function isChoice(value: string): value is AlertSoundChoice {
  return ALERT_SOUND_CHOICES.includes(value as AlertSoundChoice)
}

function isFlash(value: string): value is AlertFlash {
  return ALERT_FLASHES.includes(value as AlertFlash)
}

/** The Settings section for sounds and taskbar attention when a thread is done, needs input or fails. */
export function NotificationSettings(): JSX.Element {
  const [settings, setSettings] = useState<AlertSettings>(() => getAlertSettings())
  const windows = useWorkspace((state) => state.platform?.platform === 'win32')
  const update = (patch: Partial<AlertSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveAlertSettings(next)
  }

  return (
    <section className="space-y-4" aria-labelledby="notification-settings">
      <div>
        <h3 id="notification-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Notifications
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          How MDE tells you that an Inbox thread is done, needs input or has failed. Nothing is sent anywhere: the sounds are made
          by MDE itself and the taskbar changes are drawn by your system.
        </p>
      </div>

      <div className="space-y-3">
        <SwitchRow
          checked={settings.sound}
          label="Sounds"
          description="Play a short sound when a thread changes to one of these states."
          testId="alert-sound"
          onClick={() => update({ sound: !settings.sound })}
        />
        <label className="flex items-center gap-3 text-xs font-medium text-fg-muted">
          <span className="w-16 shrink-0">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            disabled={!settings.sound}
            data-testid="alert-volume"
            aria-valuetext={`${Math.round(settings.volume * 100)}%`}
            onChange={(event) => update({ volume: Number(event.target.value) / 100 })}
            className="min-w-0 flex-1 accent-accent disabled:opacity-50"
          />
          <span className="w-9 shrink-0 text-right tabular-nums text-fg-subtle">{Math.round(settings.volume * 100)}%</span>
        </label>

        <div className="space-y-2 rounded border border-line bg-panel p-3">
          {ALERT_KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-fg">{KIND_LABELS[kind].label}</div>
                <div className="text-[11px] text-fg-subtle">{KIND_LABELS[kind].description}</div>
              </div>
              <Select
                value={settings.sounds[kind]}
                disabled={!settings.sound}
                onValueChange={(value) => {
                  if (!isChoice(value)) return
                  update({ sounds: { ...settings.sounds, [kind]: value } })
                  // Choosing a sound plays it, as a picker for sounds does.
                  if (value !== 'off') playAlertChoice(kind, value, settings.volume)
                }}
              >
                <SelectTrigger className="w-40" data-testid={`alert-sound-${kind}`} aria-label={`${KIND_LABELS[kind].label} sound`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_SOUND_CHOICES.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {CHOICE_LABELS[choice]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Play the ${KIND_LABELS[kind].label} sound`}
                data-testid={`alert-play-${kind}`}
                disabled={settings.sounds[kind] === 'off'}
                onClick={() => playAlertChoice(kind, settings.sounds[kind], settings.volume)}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <SwitchRow
          checked={settings.onlyWhenAway}
          label="Only when MDE is in the background"
          description="Stay quiet while MDE is the window you are using. A thread you are reading never makes a sound."
          testId="alert-only-away"
          disabled={!settings.sound}
          onClick={() => update({ onlyWhenAway: !settings.onlyWhenAway })}
        />
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-fg-muted">
          Flash the taskbar button
          <Select
            value={settings.flash}
            onValueChange={(value) => {
              if (isFlash(value)) update({ flash: value })
            }}
          >
            <SelectTrigger className="mt-1" data-testid="alert-flash">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALERT_FLASHES.map((flash) => (
                <SelectItem key={flash} value={flash}>
                  {FLASH_LABELS[flash]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="mt-1 block font-normal text-fg-subtle">
            Only while MDE is in the background. “A few times” is the system’s own flashing; the other choice starts it again
            until you switch to MDE.
          </span>
        </label>
        {windows && (
          <SwitchRow
            checked={settings.badge}
            label="Taskbar colour and badge"
            description="Colour the taskbar button red for failed, yellow for needs input or green for done, with the number of threads on it, until you come back."
            testId="alert-badge"
            onClick={() => update({ badge: !settings.badge })}
          />
        )}
      </div>
    </section>
  )
}
