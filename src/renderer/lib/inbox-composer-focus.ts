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

const ATTEMPTS = 8

/**
 * Asks for the keyboard once a box is on the page, trying for a few frames while the Inbox mounts (F8 opens it from
 * another view). Returns a function that stops trying.
 */
export function focusInboxComposerWhenReady(): () => void {
  let attempts = 0
  let frame: number | undefined
  const focus = (): void => {
    if (listeners.size > 0) {
      requestInboxComposerFocus()
      return
    }
    attempts += 1
    if (attempts < ATTEMPTS) frame = window.requestAnimationFrame(focus)
  }
  frame = window.requestAnimationFrame(focus)
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
  }
}
