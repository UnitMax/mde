import type { HostPlatform, ProjectKind } from '@shared/types'

export type TerminalClipboardAction = 'copy' | 'native-paste'

export type TerminalPrimarySelectionMode = 'native' | 'local' | 'none'

export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

export type TerminalMouseClipboardAction = 'copy' | 'local-paste'

export interface TerminalPrimarySelectionStore {
  get(): string | null
  set(ownerTerminalId: string, text: string): void
  clear(ownerTerminalId: string): void
}

export function terminalPrimarySelectionMode(
  platform: HostPlatform,
  sessionKind: ProjectKind
): TerminalPrimarySelectionMode {
  if (platform === 'linux') return 'native'
  if (platform === 'win32' && sessionKind === 'wsl') return 'local'
  return 'none'
}

export function terminalRightClickAction(
  hasSelection: boolean,
  mouseTrackingMode: TerminalMouseTrackingMode
): TerminalMouseClipboardAction | null {
  return hasSelection && mouseTrackingMode === 'none' ? 'copy' : null
}

export function terminalMiddleClickAction(
  selectionMode: TerminalPrimarySelectionMode,
  hasPrimarySelection: boolean,
  mouseTrackingMode: TerminalMouseTrackingMode
): TerminalMouseClipboardAction | null {
  return selectionMode === 'local' && hasPrimarySelection && mouseTrackingMode === 'none'
    ? 'local-paste'
    : null
}

export function createTerminalPrimarySelectionStore(): TerminalPrimarySelectionStore {
  let selection: { ownerTerminalId: string; text: string } | null = null

  return {
    get: () => selection?.text ?? null,
    set: (ownerTerminalId, text) => {
      if (text.length > 0) selection = { ownerTerminalId, text }
    },
    clear: (ownerTerminalId) => {
      if (selection?.ownerTerminalId === ownerTerminalId) selection = null
    }
  }
}

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

/**
 * Encoded-length ceiling for an OSC 52 payload. A real editor yank is a few
 * kilobytes at most; the previous 10 MiB allowance only ever helped an attacker
 * force a large allocation from terminal output alone.
 */
export const OSC52_MAX_BASE64_LENGTH = 256 * 1024

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export type Osc52DecodeResult =
  /** Not a clipboard-set payload: a query, another selection, or malformed data. */
  | { kind: 'ignored' }
  /** Well-formed but over `OSC52_MAX_BASE64_LENGTH`. */
  | { kind: 'too-large' }
  | { kind: 'text'; text: string }

const ignored: Osc52DecodeResult = { kind: 'ignored' }

/** Decodes an OSC 52 clipboard payload after xterm has removed its terminator. */
export function decodeOsc52Clipboard(data: string): Osc52DecodeResult {
  const separator = data.indexOf(';')
  if (separator < 0 || data.slice(0, separator) !== 'c') return ignored

  const encoded = data.slice(separator + 1).replace(/\s/g, '')
  // A query asks MDE to report the clipboard back to the program. Never answer
  // it: that would turn the terminal into a clipboard read channel.
  if (encoded === '?') return ignored
  // Checked before atob so an oversized payload is never allocated.
  if (encoded.length > OSC52_MAX_BASE64_LENGTH) return { kind: 'too-large' }
  if (!base64Pattern.test(encoded)) return ignored

  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return ignored
  }
}
