import type { InboxThread } from '@shared/types'
import {
  ALERT_PRIORITY,
  ATTENTION_COUNT_LIMIT,
  type AlertKind,
  type TaskbarAttentionRequest,
  type TaskbarFlash,
  type TaskbarIndicator
} from '@shared/taskbar-attention'
import { playAlertChoice } from './alert-sound'
import type { AlertSettings } from './alert-settings'
import { inboxThreadListed, isInboxThreadUnread } from './inbox'

/** A second sound this soon after one is dropped, unless it is more urgent. Threads often finish together. */
export const ALERT_QUIET_MS = 1500

/** What a thread's change means to the person, or null for a change that is not worth telling about. */
export function alertKind(previous: InboxThread | undefined, next: InboxThread): AlertKind | null {
  // A thread seen for the first time, such as one loaded at startup, did not just do anything.
  if (!previous) return null
  const changed = previous.status !== next.status || previous.attentionReason !== next.attentionReason
  if (!changed) return null
  if (next.status === 'completed') return 'done'
  if (next.status === 'error') return 'failed'
  return next.status === 'attention' ? 'input' : null
}

/**
 * What the taskbar button should show for the threads: the most urgent state among them and how many threads are in
 * it. Failed and done count while unread; a thread waiting for an answer counts until it gets one.
 */
export function taskbarIndicator(threads: readonly InboxThread[]): TaskbarIndicator | null {
  const counts: Record<AlertKind, number> = { done: 0, input: 0, failed: 0 }
  for (const thread of threads) {
    if (!inboxThreadListed(thread)) continue
    if (thread.status === 'attention') counts.input += 1
    else if (thread.status === 'error' && isInboxThreadUnread(thread)) counts.failed += 1
    else if (thread.status === 'completed' && isInboxThreadUnread(thread)) counts.done += 1
  }
  const tone = (Object.keys(counts) as AlertKind[])
    .filter((kind) => counts[kind] > 0)
    .sort((a, b) => ALERT_PRIORITY[b] - ALERT_PRIORITY[a])[0]
  return tone ? { tone, count: Math.min(ATTENTION_COUNT_LIMIT, counts[tone]) } : null
}

export interface AlertDependencies {
  settings(): AlertSettings
  threads(): readonly InboxThread[]
  /** Whether the MDE window is the one in use. */
  focused(): boolean
  /** Whether the person is reading this thread right now. */
  viewing(threadId: string): boolean
  now(): number
  play(kind: AlertKind, choice: AlertSettings['sounds'][AlertKind], volume: number): void
  send(request: TaskbarAttentionRequest): void
}

export interface Alerts {
  /** A thread changed; tells the person if it is something they should hear about. */
  threadChanged(previous: InboxThread | undefined, next: InboxThread): void
  /** The threads, the settings or the window's focus changed; brings the taskbar up to date. */
  refresh(): void
}

function flashMode(settings: AlertSettings): TaskbarFlash {
  return settings.flash === 'until-focus' ? 'continuous' : settings.flash === 'brief' ? 'brief' : 'none'
}

/** The decisions about when to make a sound and when to ask the taskbar for attention, apart from the window and the audio. */
export function createAlerts(dependencies: AlertDependencies): Alerts {
  let lastSound: { priority: number; at: number } | null = null
  // The taskbar starts with nothing on it.
  let lastIndicator = 'null'
  let flashing = false

  const send = (request: TaskbarAttentionRequest): void => {
    // A colour that is unchanged is not sent again. A flash is an event, so a new one always is, and a stop is
    // sent only when something is flashing.
    const starting = request.flash === 'brief' || request.flash === 'continuous'
    const stopping = request.flash === 'none' && flashing
    const key = JSON.stringify(request.indicator)
    if (!starting && !stopping && key === lastIndicator) return
    lastIndicator = key
    if (starting) flashing = true
    if (request.flash === 'none') flashing = false
    dependencies.send({ indicator: request.indicator, ...(starting || stopping ? { flash: request.flash } : {}) })
  }

  // Always shown while there is something to show, focused or not: a badge that vanishes when the window is
  // opened, or when another screen's window is clicked, is confusing. It goes when the threads have been read.
  const indicator = (settings: AlertSettings): TaskbarIndicator | null =>
    settings.badge ? taskbarIndicator(dependencies.threads()) : null

  return {
    threadChanged(previous, next) {
      const kind = alertKind(previous, next)
      if (!kind) return
      const settings = dependencies.settings()
      const focused = dependencies.focused()
      // Reading the thread is already knowing.
      if (focused && dependencies.viewing(next.id)) return

      const choice = settings.sounds[kind]
      const now = dependencies.now()
      const priority = ALERT_PRIORITY[kind]
      const quiet = lastSound !== null && now - lastSound.at < ALERT_QUIET_MS && priority <= lastSound.priority
      if (settings.sound && choice !== 'off' && !(settings.onlyWhenAway && focused) && !quiet) {
        lastSound = { priority, at: now }
        dependencies.play(kind, choice, settings.volume)
      }

      const flash = focused ? 'none' : flashMode(settings)
      send({ indicator: indicator(settings), ...(flash !== 'none' ? { flash } : {}) })
    },
    refresh() {
      const settings = dependencies.settings()
      // The window being used ends any flashing; so does turning it off.
      const stop = dependencies.focused() || settings.flash === 'off'
      send({ indicator: indicator(settings), ...(stop ? { flash: 'none' as const } : {}) })
    }
  }
}

/** The sound for a kind, played the way a setting chooses; the same call as an alert makes, for trying one out. */
export function previewAlert(kind: AlertKind, settings: AlertSettings): void {
  playAlertChoice(kind, settings.sounds[kind], settings.volume)
}
