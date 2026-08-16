export type TerminalClipboardAction = 'copy' | 'native-paste'

export interface TerminalClipboardKeyInput {
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

function isKey(input: TerminalClipboardKeyInput, key: string, code: string): boolean {
  return input.key.toLowerCase() === key.toLowerCase() || input.code === code
}

/** Maps host-terminal clipboard shortcuts without consuming ordinary terminal input. */
export function terminalClipboardAction(
  input: TerminalClipboardKeyInput,
  hasSelection: boolean,
  isMac: boolean
): TerminalClipboardAction | null {
  if (input.alt) return null

  const primaryModifier = isMac
    ? input.meta && !input.control
    : input.control && !input.meta

  if (primaryModifier && isKey(input, 'c', 'KeyC') && hasSelection) return 'copy'
  if (primaryModifier && isKey(input, 'v', 'KeyV')) return 'native-paste'

  if (!isMac && input.control && !input.meta && !input.shift && isKey(input, 'Insert', 'Insert')) {
    return hasSelection ? 'copy' : null
  }

  if (input.shift && !input.control && !input.meta && isKey(input, 'Insert', 'Insert')) {
    return 'native-paste'
  }

  return null
}

const maxOsc52Base64Length = 10 * 1024 * 1024
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Decodes an OSC 52 clipboard payload after xterm has removed its terminator. */
export function decodeOsc52Clipboard(data: string): string | null {
  const separator = data.indexOf(';')
  if (separator < 0 || data.slice(0, separator) !== 'c') return null

  const encoded = data.slice(separator + 1).replace(/\s/g, '')
  if (encoded === '?' || encoded.length > maxOsc52Base64Length || !base64Pattern.test(encoded)) {
    return null
  }

  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
