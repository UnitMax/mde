/**
 * Asks the Inbox's message box for the keyboard (F9). The box on screen, on a thread or on the new-thread page,
 * listens; there is only ever one.
 */
const listeners = new Set<() => void>()

export function onInboxComposerFocusRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requestInboxComposerFocus(): void {
  for (const listener of listeners) listener()
}
