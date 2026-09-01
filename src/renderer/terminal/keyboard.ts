export interface TerminalKeyboardInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** Returns the compatibility input that should replace an alternate-screen key event. */
export function terminalKeyboardAction(
  input: TerminalKeyboardInput,
  alternateScreen: boolean
): string | null {
  if (!alternateScreen || input.type !== 'keydown') return null
  if (!input.control || input.meta || input.alt || input.shift) return null

  const isEnter = input.key.toLocaleLowerCase() === 'enter' ||
    input.code === 'Enter' ||
    input.code === 'NumpadEnter'
  return isEnter ? '\n' : null
}
