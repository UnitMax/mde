import { MDE_MCP_SERVER_NAME, type MdeMcpInstallState } from '@shared/mde-mcp'
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { NEW_CONFIG_TEXT } from './edit'
import { removeIfEmpty, removeValue, setValue } from './jsonc-edit'

/**
 * The MDE MCP's entry in OpenCode's configuration: `mcp.servers.mde`, a local server whose command is this copy
 * of MDE in bridge mode. Only that one key is written or removed; the rest of the file stays as it was. (OpenCode
 * 2.2.6 accepts it beside old-style `mcp.<name>` entries, and picks up the change without a restart.)
 */

const ENTRY_PATH = ['mcp', 'servers', MDE_MCP_SERVER_NAME]

export function mdeMcpEntry(command: string[]): Record<string, unknown> {
  // Only the fields verified with OpenCode 2.2.6: a field it does not know could make it ignore the whole file.
  return { type: 'local', command }
}

function sameCommand(value: unknown, command: string[]): boolean {
  return Array.isArray(value) && value.length === command.length && value.every((part, index) => part === command[index])
}

/** Whether the text holds the entry, and whether it starts `command`; or why the text cannot be read. */
export function readMdeMcpState(text: string, command: string[]): { state: MdeMcpInstallState; parseError: string | null } {
  const errors: ParseError[] = []
  const root: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true })
  const first = errors.at(0)
  if (first) return { state: 'missing', parseError: `${printParseErrorCode(first.error)} at offset ${first.offset}` }
  let node: unknown = root
  for (const key of ENTRY_PATH) {
    node = node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>)[key] : undefined
  }
  if (node === undefined) return { state: 'missing', parseError: null }
  const entry = node as Record<string, unknown> | null
  const current = entry && typeof entry === 'object' && entry.type === 'local' && sameCommand(entry.command, command)
  return { state: current ? 'installed' : 'outdated', parseError: null }
}

/** The text with the entry added, or replaced by one for `command`. */
export function installMdeMcp(text: string, command: string[]): string {
  return setValue(text.trim() ? text : NEW_CONFIG_TEXT, ENTRY_PATH, mdeMcpEntry(command))
}

/** The text without the entry, and without `mcp.servers` / `mcp` when nothing else was in them. */
export function removeMdeMcp(text: string): string {
  let next = removeValue(text, ENTRY_PATH)
  next = removeIfEmpty(next, ['mcp', 'servers'])
  return removeIfEmpty(next, ['mcp'])
}
