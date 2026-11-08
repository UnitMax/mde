import { describe, expect, it, vi } from 'vitest'
import {
  ALERT_QUIET_MS,
  alertKind,
  createAlerts,
  taskbarIndicator,
  type AlertDependencies
} from '../src/renderer/lib/alerts'
import {
  ALERT_SOUND_CHOICES,
  DEFAULT_ALERT_SETTINGS,
  normalizeAlertSettings,
  type AlertSettings
} from '../src/renderer/lib/alert-settings'
import { ALERT_TUNES, ALERT_VOICE_DEFINITIONS, alertDuration, alertSamples } from '../src/renderer/lib/alert-sound'
import { ALERT_KINDS } from '../src/shared/taskbar-attention'
import type { InboxThread } from '../src/shared/types'

function thread(patch: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_1',
    target: { kind: 'native' },
    directory: '/home/me/project',
    title: 'Thread',
    status: 'working',
    lastActivityAt: 100,
    readAt: 100,
    ...patch
  } as InboxThread
}

describe('alertKind', () => {
  it('names the three states a thread can move into', () => {
    expect(alertKind(thread(), thread({ status: 'completed' }))).toBe('done')
    expect(alertKind(thread(), thread({ status: 'error' }))).toBe('failed')
    expect(alertKind(thread(), thread({ status: 'attention', attentionReason: 'question' }))).toBe('input')
  })

  it('says nothing for a thread seen for the first time, or one that did not change', () => {
    expect(alertKind(undefined, thread({ status: 'completed' }))).toBeNull()
    expect(alertKind(thread({ status: 'completed' }), thread({ status: 'completed', title: 'Renamed' }))).toBeNull()
  })

  it('says nothing for states that are not an ending', () => {
    expect(alertKind(thread({ status: 'completed' }), thread({ status: 'working' }))).toBeNull()
    expect(alertKind(thread({ status: 'working' }), thread({ status: 'idle' }))).toBeNull()
  })

  it('tells about a second question after a permission, since it needs the person again', () => {
    const permission = thread({ status: 'attention', attentionReason: 'permission' })
    expect(alertKind(permission, thread({ status: 'attention', attentionReason: 'question' }))).toBe('input')
  })
})

describe('taskbarIndicator', () => {
  it('is nothing when nothing needs the person', () => {
    expect(taskbarIndicator([])).toBeNull()
    expect(taskbarIndicator([thread({ status: 'working' }), thread({ id: 'b', status: 'completed', readAt: 100 })])).toBeNull()
  })

  it('counts unread done and failed threads, and every thread waiting for an answer', () => {
    expect(taskbarIndicator([thread({ status: 'completed', lastActivityAt: 200 }), thread({ id: 'b', status: 'completed', lastActivityAt: 300 })]))
      .toEqual({ tone: 'done', count: 2 })
    expect(taskbarIndicator([thread({ status: 'error', lastActivityAt: 200 })])).toEqual({ tone: 'failed', count: 1 })
    // A question stays on the taskbar after the thread was opened, until it is answered.
    expect(taskbarIndicator([thread({ status: 'attention', lastActivityAt: 100, readAt: 500 })])).toEqual({ tone: 'input', count: 1 })
  })

  it('shows the most urgent state and counts only the threads in it', () => {
    const threads = [
      thread({ id: 'a', status: 'completed', lastActivityAt: 200 }),
      thread({ id: 'b', status: 'attention' }),
      thread({ id: 'c', status: 'attention' }),
      thread({ id: 'd', status: 'error', lastActivityAt: 200 })
    ]
    expect(taskbarIndicator(threads)).toEqual({ tone: 'failed', count: 1 })
    expect(taskbarIndicator(threads.slice(0, 3))).toEqual({ tone: 'input', count: 2 })
  })

  it('ignores parked threads and caps the count', () => {
    expect(taskbarIndicator([thread({ status: 'error', lastActivityAt: 200, archived: true })])).toBeNull()
    const many = Array.from({ length: 120 }, (_, index) => thread({ id: `t${index}`, status: 'attention' }))
    expect(taskbarIndicator(many)).toEqual({ tone: 'input', count: 99 })
  })
})

function setup(patch: Partial<AlertSettings> = {}, state: { focused?: boolean; viewing?: string | null; threads?: InboxThread[] } = {}) {
  const context = { focused: state.focused ?? false, viewing: state.viewing ?? null, threads: state.threads ?? [], now: 10_000 }
  const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, ...patch }
  const play = vi.fn()
  const send = vi.fn()
  const dependencies: AlertDependencies = {
    settings: () => settings,
    threads: () => context.threads,
    focused: () => context.focused,
    viewing: (id) => context.viewing === id,
    now: () => context.now,
    play,
    send
  }
  return { alerts: createAlerts(dependencies), context, play, send, settings }
}

const finished = thread({ status: 'completed', lastActivityAt: 200 })

describe('createAlerts sound', () => {
  it('plays the chosen sound at the chosen volume', () => {
    const { alerts, play } = setup({ volume: 0.3, sounds: { done: 'bell', input: 'chime', failed: 'beep' } })
    alerts.threadChanged(thread(), finished)
    expect(play).toHaveBeenCalledExactlyOnceWith('done', 'bell', 0.3)
    alerts.threadChanged(thread(), thread({ status: 'error', lastActivityAt: 200 }))
    expect(play).toHaveBeenLastCalledWith('failed', 'beep', 0.3)
  })

  it('stays quiet when sounds are off, a kind is off, or the change is not an ending', () => {
    const off = setup({ sound: false })
    off.alerts.threadChanged(thread(), finished)
    expect(off.play).not.toHaveBeenCalled()
    const kindOff = setup({ sounds: { ...DEFAULT_ALERT_SETTINGS.sounds, done: 'off' } })
    kindOff.alerts.threadChanged(thread(), finished)
    expect(kindOff.play).not.toHaveBeenCalled()
    const working = setup()
    working.alerts.threadChanged(finished, thread())
    working.alerts.threadChanged(undefined, finished)
    expect(working.play).not.toHaveBeenCalled()
  })

  it('stays quiet about the thread being read in the window in use, but not about another one', () => {
    const reading = setup({}, { focused: true, viewing: 'ses_1' })
    reading.alerts.threadChanged(thread(), finished)
    expect(reading.play).not.toHaveBeenCalled()
    expect(reading.send).not.toHaveBeenCalled()
    const other = setup({}, { focused: true, viewing: 'ses_2' })
    other.alerts.threadChanged(thread(), finished)
    expect(other.play).toHaveBeenCalledTimes(1)
  })

  it('reads the same thread in the background as a thread to hear about', () => {
    const { alerts, play } = setup({}, { focused: false, viewing: 'ses_1' })
    alerts.threadChanged(thread(), finished)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('can be limited to the time MDE is in the background', () => {
    const focused = setup({ onlyWhenAway: true }, { focused: true })
    focused.alerts.threadChanged(thread(), finished)
    expect(focused.play).not.toHaveBeenCalled()
    const away = setup({ onlyWhenAway: true }, { focused: false })
    away.alerts.threadChanged(thread(), finished)
    expect(away.play).toHaveBeenCalledTimes(1)
  })

  it('plays one sound for threads that end together, unless a later one is more urgent', () => {
    const { alerts, play, context } = setup()
    alerts.threadChanged(thread({ id: 'a' }), thread({ id: 'a', status: 'completed' }))
    context.now += 200
    alerts.threadChanged(thread({ id: 'b' }), thread({ id: 'b', status: 'completed' }))
    expect(play).toHaveBeenCalledTimes(1)
    context.now += 200
    alerts.threadChanged(thread({ id: 'c' }), thread({ id: 'c', status: 'error' }))
    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenLastCalledWith('failed', expect.anything(), expect.anything())
    context.now += 200
    alerts.threadChanged(thread({ id: 'd' }), thread({ id: 'd', status: 'completed' }))
    expect(play).toHaveBeenCalledTimes(2)
    context.now += ALERT_QUIET_MS
    alerts.threadChanged(thread({ id: 'e' }), thread({ id: 'e', status: 'completed' }))
    expect(play).toHaveBeenCalledTimes(3)
  })
})

describe('createAlerts taskbar', () => {
  it('flashes the button and sets the indicator when a thread ends in the background', () => {
    const { alerts, send, context } = setup({ flash: 'brief' })
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 }, flash: 'brief' })
  })

  it('flashes until focus when asked to', () => {
    const { alerts, send, context } = setup({ flash: 'until-focus' })
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    expect(send).toHaveBeenCalledWith({ indicator: { tone: 'done', count: 1 }, flash: 'continuous' })
  })

  it('does not flash when flashing is off, but still colours the button', () => {
    const { alerts, send, context } = setup({ flash: 'off' })
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 } })
  })

  it('shows no indicator when the badge is off', () => {
    const noBadge = setup({ badge: false }, { threads: [finished] })
    noBadge.alerts.threadChanged(thread(), finished)
    expect(noBadge.send).toHaveBeenCalledExactlyOnceWith({ indicator: null, flash: 'brief' })
  })

  it('shows the indicator while MDE is in use too, but does not flash for a thread that is not open', () => {
    const { alerts, send } = setup({}, { focused: true, viewing: 'other', threads: [finished] })
    alerts.threadChanged(thread(), finished)
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 } })
    const shown = setup({}, { focused: true, threads: [finished] })
    shown.alerts.refresh()
    expect(shown.send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 } })
  })

  it('sends a flash every time but an unchanged indicator only once', () => {
    const { alerts, send, context } = setup()
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    alerts.threadChanged(thread({ id: 'x' }), thread({ id: 'x', status: 'completed' }))
    expect(send).toHaveBeenCalledTimes(2)
    send.mockClear()
    alerts.refresh()
    alerts.refresh()
    expect(send).not.toHaveBeenCalled()
  })

  it('stops the flash but keeps the indicator when the window is used', () => {
    const { alerts, send, context } = setup({ flash: 'until-focus' })
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    send.mockClear()
    context.focused = true
    alerts.refresh()
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 }, flash: 'none' })
    alerts.refresh()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps the indicator when the window is left and when it is come back to', () => {
    const { alerts, send, context } = setup({}, { focused: true, threads: [thread({ status: 'attention' })] })
    alerts.refresh()
    send.mockClear()
    context.focused = false
    alerts.refresh()
    context.focused = true
    alerts.refresh()
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ indicator: null }))
  })

  it('clears the indicator once the threads have been read or answered', () => {
    const { alerts, send, context } = setup({}, { focused: true, threads: [finished] })
    alerts.refresh()
    send.mockClear()
    context.threads = [{ ...finished, readAt: finished.lastActivityAt + 1 }]
    alerts.refresh()
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: null })
  })

  it('stops a flash that was turned off in the settings', () => {
    const { alerts, send, context, settings } = setup({ flash: 'until-focus' })
    context.threads = [finished]
    alerts.threadChanged(thread(), finished)
    send.mockClear()
    settings.flash = 'off'
    alerts.refresh()
    expect(send).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'done', count: 1 }, flash: 'none' })
  })
})

describe('alert settings', () => {
  it('fills what is missing or invalid with the defaults', () => {
    expect(normalizeAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(normalizeAlertSettings('nonsense')).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(normalizeAlertSettings({ volume: 'loud', flash: 'sometimes', sound: 1, sounds: { done: 'kazoo' } })).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  it('keeps what is valid and limits the volume', () => {
    const settings = normalizeAlertSettings({ sound: false, volume: 4, flash: 'until-focus', badge: false, onlyWhenAway: true, sounds: { input: 'off', failed: 'beep' } })
    expect(settings).toEqual({
      sound: false,
      volume: 1,
      sounds: { done: 'chime', input: 'off', failed: 'beep' },
      flash: 'until-focus',
      badge: false,
      onlyWhenAway: true
    })
    expect(normalizeAlertSettings({ volume: -2 }).volume).toBe(0)
  })

  it('chooses a voice or the beep or nothing for every kind by default', () => {
    for (const kind of ALERT_KINDS) expect(ALERT_SOUND_CHOICES).toContain(DEFAULT_ALERT_SETTINGS.sounds[kind])
    expect(new Set(Object.values(DEFAULT_ALERT_SETTINGS.sounds)).size).toBe(3)
  })
})

/** The strength of one frequency in the samples, by correlating with a sine and a cosine at that frequency. */
function strength(samples: Float32Array, sampleRate: number, frequency: number, from = 0, to = samples.length): number {
  let sine = 0
  let cosine = 0
  for (let index = from; index < to; index += 1) {
    sine += samples[index]! * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
    cosine += samples[index]! * Math.cos((2 * Math.PI * frequency * index) / sampleRate)
  }
  return Math.hypot(sine, cosine) / (to - from)
}

describe('alert sounds', () => {
  const rate = 44_100

  it.each(ALERT_KINDS.flatMap((kind) => (['chime', 'bell', 'pluck'] as const).map((voice) => [kind, voice] as const)))(
    '%s in the %s voice is a short, quiet-enough, click-free sound',
    (kind, voice) => {
      const samples = alertSamples(kind, voice, rate)
      expect(samples.length).toBe(Math.ceil(alertDuration(kind, voice) * rate))
      expect(alertDuration(kind, voice)).toBeLessThan(1.6)
      const peak = samples.reduce((largest, sample) => Math.max(largest, Math.abs(sample)), 0)
      expect(peak).toBeGreaterThan(0.79)
      expect(peak).toBeLessThanOrEqual(0.8 + 1e-6)
      expect(Math.abs(samples[0]!)).toBeLessThan(0.01)
      expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.01)
    }
  )

  it('sounds at the pitch of its notes', () => {
    const samples = alertSamples('input', 'chime', rate)
    // Both pings of the double ping are at B5; a pitch an octave and a half away is absent.
    expect(strength(samples, rate, 987.77)).toBeGreaterThan(strength(samples, rate, 700) * 5)
    const done = alertSamples('done', 'chime', rate)
    const [first, second] = ALERT_TUNES.done
    const split = Math.floor((second!.at - 0.01) * rate)
    expect(strength(done, rate, first!.frequency, 0, split)).toBeGreaterThan(strength(done, rate, second!.frequency, 0, split) * 5)
    // The first note's tail is still dying away under the second.
    expect(strength(done, rate, second!.frequency, split + 2000)).toBeGreaterThan(strength(done, rate, first!.frequency, split + 2000) * 2)
  })

  it('has a rising tune for done and a falling one for failed', () => {
    expect(ALERT_TUNES.done[1]!.frequency).toBeGreaterThan(ALERT_TUNES.done[0]!.frequency)
    expect(ALERT_TUNES.failed[1]!.frequency).toBeLessThan(ALERT_TUNES.failed[0]!.frequency)
    expect(ALERT_TUNES.input).toHaveLength(2)
  })

  it('has voices with different partials', () => {
    expect(new Set(Object.values(ALERT_VOICE_DEFINITIONS).map((voice) => voice.partials.length)).size).toBeGreaterThan(1)
    expect(alertSamples('done', 'bell', rate)).not.toEqual(alertSamples('done', 'chime', rate))
  })
})
