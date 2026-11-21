interface ComposerKeyInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

export type ComposerKeyAction = 'focus' | 'sidebar' | 'ignore'

/**
 * What a key press means for the Inbox. F9 puts the keyboard in the message box and F10 switches the right-hand
 * sidebar between docked and floating, from anywhere in the window, a terminal or a page of the MDE browser included,
 * but only while the Inbox is on screen: elsewhere the keys reach the page as usual (on Windows, F10 would otherwise
 * also reach the window menu). A held key is swallowed ('ignore') so its repeats never reach a shell.
 */
export function getComposerKeyAction(input: ComposerKeyInput, active: boolean): ComposerKeyAction | null {
  if (
    !active ||
    input.type !== 'keyDown' ||
    input.control || input.meta || input.alt || input.shift
  ) {
    return null
  }
  const action = input.key === 'F9' || input.code === 'F9' ? 'focus' : input.key === 'F10' || input.code === 'F10' ? 'sidebar' : null
  if (!action) return null
  return input.isAutoRepeat ? 'ignore' : action
}

/** Whether the renderer shows the Inbox, so F9 and F10 should reach it, as it last said. */
export class ComposerKey {
  private active = false

  setActive(active: boolean): void {
    this.active = active
  }

  action(input: ComposerKeyInput): ComposerKeyAction | null {
    return getComposerKeyAction(input, this.active)
  }
}
