export type FloatingTerminalAction = 'toggle' | 'ignore'

interface FloatingTerminalInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

/**
 * What a key press means for the Inbox's floating terminal. F11 shows and hides it, but only while it is
 * broken out of the sidebar: otherwise the key keeps its usual job of putting the window in full screen. A
 * held key is swallowed ('ignore') so its repeats neither flicker the terminal nor reach the shell.
 */
export function getFloatingTerminalAction(input: FloatingTerminalInput, active: boolean): FloatingTerminalAction | null {
  if (
    !active ||
    input.type !== 'keyDown' ||
    input.control || input.meta || input.alt || input.shift ||
    (input.key !== 'F11' && input.code !== 'F11')
  ) {
    return null
  }
  return input.isAutoRepeat ? 'ignore' : 'toggle'
}

/** Whether the renderer has a floating terminal that F11 should reach, as it last said. */
export class FloatingTerminalKey {
  private active = false

  setActive(active: boolean): void {
    this.active = active
  }

  action(input: FloatingTerminalInput): FloatingTerminalAction | null {
    return getFloatingTerminalAction(input, this.active)
  }
}
