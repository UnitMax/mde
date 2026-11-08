import type { AlertKind } from '@shared/taskbar-attention'
import type { AlertSoundChoice, AlertVoice } from './alert-settings'

/**
 * The alert sounds are made here, from sine waves, instead of played from recordings: they belong to MDE
 * and carry no licence or credit. A tune is a few notes (a pitch and when it starts); a voice is how one note
 * sounds (which overtones, how fast it begins and dies away).
 */

interface Note {
  /** Seconds after the start of the sound. */
  at: number
  /** Hertz. */
  frequency: number
  /** 0 to 1, against the loudest note. */
  gain: number
}

/** Done rises, as a finished thing does; waiting for you pings twice; failed falls to a low minor third. */
export const ALERT_TUNES: Record<AlertKind, readonly Note[]> = {
  done: [
    { at: 0, frequency: 783.99, gain: 0.85 },
    { at: 0.12, frequency: 1046.5, gain: 1 }
  ],
  input: [
    { at: 0, frequency: 987.77, gain: 1 },
    { at: 0.2, frequency: 987.77, gain: 0.8 }
  ],
  failed: [
    { at: 0, frequency: 392, gain: 1 },
    { at: 0.17, frequency: 311.13, gain: 1 }
  ]
}

interface Voice {
  /** Overtones as multiples of the pitch, with their loudness against the pitch itself. */
  partials: ReadonlyArray<{ ratio: number; gain: number }>
  /** Seconds to reach full volume. */
  attack: number
  /** Seconds for the sound to fall to a third of its volume. */
  decay: number
}

export const ALERT_VOICE_DEFINITIONS: Record<AlertVoice, Voice> = {
  // A soft, round ping.
  chime: { partials: [{ ratio: 1, gain: 1 }, { ratio: 2, gain: 0.28 }, { ratio: 3, gain: 0.08 }], attack: 0.006, decay: 0.16 },
  // A glassy bell, whose overtones are not whole multiples of the pitch.
  bell: {
    partials: [{ ratio: 1, gain: 1 }, { ratio: 2.76, gain: 0.45 }, { ratio: 5.4, gain: 0.2 }, { ratio: 8.93, gain: 0.08 }],
    attack: 0.003,
    decay: 0.2
  },
  // A short, bright blip.
  pluck: {
    partials: [{ ratio: 1, gain: 1 }, { ratio: 2, gain: 0.5 }, { ratio: 3, gain: 0.33 }, { ratio: 4, gain: 0.2 }, { ratio: 5, gain: 0.12 }],
    attack: 0.002,
    decay: 0.09
  }
}

/** A note is cut off after this many decay times, when it is below a hundredth of its volume. */
const DECAYS_PER_NOTE = 5
/** The end of a note is faded over this long, so that cutting it off does not click. */
const FADE_OUT = 0.02
/** The loudest sample of a sound, which leaves room for the volume setting to stay below clipping. */
const PEAK = 0.8

/** How long a sound lasts, in seconds. */
export function alertDuration(kind: AlertKind, voice: AlertVoice): number {
  const { attack, decay } = ALERT_VOICE_DEFINITIONS[voice]
  const last = ALERT_TUNES[kind].reduce((latest, note) => Math.max(latest, note.at), 0)
  return last + attack + decay * DECAYS_PER_NOTE
}

/** The sound as samples between -1 and 1, mono. */
export function alertSamples(kind: AlertKind, voice: AlertVoice, sampleRate: number): Float32Array<ArrayBuffer> {
  const definition = ALERT_VOICE_DEFINITIONS[voice]
  const length = Math.ceil(alertDuration(kind, voice) * sampleRate)
  const samples = new Float32Array(new ArrayBuffer(length * 4))
  const noteLength = definition.attack + definition.decay * DECAYS_PER_NOTE
  for (const note of ALERT_TUNES[kind]) {
    const first = Math.floor(note.at * sampleRate)
    const count = Math.min(length - first, Math.ceil(noteLength * sampleRate))
    for (let index = 0; index < count; index += 1) {
      const time = index / sampleRate
      const envelope = time < definition.attack
        ? time / definition.attack
        : Math.exp(-(time - definition.attack) / definition.decay)
      const fade = Math.min(1, (noteLength - time) / FADE_OUT)
      let value = 0
      for (const partial of definition.partials) value += partial.gain * Math.sin(2 * Math.PI * note.frequency * partial.ratio * time)
      samples[first + index]! += value * envelope * fade * note.gain
    }
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (peak > 0) for (let index = 0; index < samples.length; index += 1) samples[index] = samples[index]! * (PEAK / peak)
  return samples
}

let context: AudioContext | null = null

/** Plays a voice's tune for the kind at a volume from 0 to 1. A failure to make sound is not worth an error. */
export function playAlertSound(kind: AlertKind, voice: AlertVoice, volume: number): void {
  try {
    context ??= new AudioContext()
    const audio = context
    // A context made without a click starts suspended in some browsers; Electron allows it to run.
    if (audio.state === 'suspended') void audio.resume().catch(() => {})
    const samples = alertSamples(kind, voice, audio.sampleRate)
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = audio.createBufferSource()
    const gain = audio.createGain()
    gain.gain.value = Math.min(1, Math.max(0, volume))
    source.buffer = buffer
    source.connect(gain).connect(audio.destination)
    source.start()
  } catch {
    // No audio device, or no Web Audio.
  }
}

/** Plays what a setting chooses for a kind: a voice, the system beep, or nothing. */
export function playAlertChoice(kind: AlertKind, choice: AlertSoundChoice, volume: number): void {
  if (choice === 'off') return
  if (choice === 'beep') {
    void window.api.attention.beep().catch(() => {})
    return
  }
  playAlertSound(kind, choice, volume)
}
