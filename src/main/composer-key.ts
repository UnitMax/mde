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

export type ComposerKeyAction = 'focus' | 'ignore'

/**
 * What a key press means for the Inbox's message box. F9 puts the keyboard in it from anywhere in the window, a
 * terminal or a page of the MDE browser included, but only while the Inbox is on screen: elsewhere the key reaches
 * the page as usual. A held key is swallowed ('ignore') so its repeats never reach a shell.
 */
export function getComposerKeyAction(input: ComposerKeyInput, active: boolean): ComposerKeyAction | null {
  if (
    !active ||
    input.type !== 'keyDown' ||
    input.control || input.meta || input.alt || input.shift ||
    (input.key !== 'F9' && input.code !== 'F9')
  ) {
    return null
  }
  return input.isAutoRepeat ? 'ignore' : 'focus'
}

/** Whether the renderer shows the Inbox, so F9 should reach its message box, as it last said. */
export class ComposerKey {
  private active = false

  setActive(active: boolean): void {
    this.active = active
  }

  action(input: ComposerKeyInput): ComposerKeyAction | null {
    return getComposerKeyAction(input, this.active)
  }
}
