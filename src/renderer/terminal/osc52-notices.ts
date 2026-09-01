import type { Osc52Decision, Osc52Preview } from './osc52'

/**
 * A per-terminal channel from the xterm session layer, which is a plain module,
 * to the React pane that shows the user what happened. Modelled on the
 * `mde:terminal-settings-changed` subscription in `terminal-settings.ts`, but
 * kept as a module registry because these events carry a payload and are
 * addressed to one terminal rather than broadcast.
 */

export type Osc52Notice =
  | { kind: 'written'; preview: Osc52Preview }
  | { kind: 'blocked'; reason: Osc52Decision; preview: Osc52Preview }
  | { kind: 'too-large' }

export type Osc52GrantScope = 'once' | 'terminal'

export interface Osc52Prompt {
  preview: Osc52Preview
  approve: (scope: Osc52GrantScope) => void
  deny: () => void
}

export type Osc52Event =
  | { kind: 'notice'; notice: Osc52Notice }
  | { kind: 'prompt'; prompt: Osc52Prompt }
  /** The pending request went away on its own (superseded, expired, or the pane closed). */
  | { kind: 'prompt-cleared' }

type Osc52Listener = (event: Osc52Event) => void

const listeners = new Map<string, Set<Osc52Listener>>()

export function subscribeOsc52(terminalId: string, listener: Osc52Listener): () => void {
  const existing = listeners.get(terminalId) ?? new Set<Osc52Listener>()
  existing.add(listener)
  listeners.set(terminalId, existing)

  return () => {
    const current = listeners.get(terminalId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(terminalId)
  }
}

export function emitOsc52(terminalId: string, event: Osc52Event): void {
  const current = listeners.get(terminalId)
  if (!current) return
  // Copied so a listener unsubscribing while handling cannot skip another.
  for (const listener of [...current]) listener(event)
}

/** Test seam; the renderer never needs this. */
export function resetOsc52Listeners(): void {
  listeners.clear()
}
