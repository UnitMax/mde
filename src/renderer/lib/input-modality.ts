/**
 * Whether the last thing the user did was press a key, as against pointing: the difference between a
 * keyboard user, who needs to see where the focus is, and a mouse user, who does not. The listeners are
 * installed when the module is first used and watch the whole window, in the capture phase.
 */
let keyboard = false
let installed = false

function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', () => { keyboard = true }, true)
  window.addEventListener('pointerdown', () => { keyboard = false }, true)
}

install()

export function lastInputWasKeyboard(): boolean {
  install()
  return keyboard
}

/**
 * For a menu's `onCloseAutoFocus`. Radix hands the focus back to the button that opened the menu, and the
 * browser then draws the focus ring on it, as for a keyboard user; it stays until the next click elsewhere.
 * After the mouse closed the menu the focus stays where the click put it; after the keyboard it goes back
 * to the button, ring and all, which is what that user needs.
 */
export function quietCloseFocus(event: Event): void {
  if (!lastInputWasKeyboard()) event.preventDefault()
}
