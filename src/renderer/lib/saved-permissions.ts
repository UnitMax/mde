import type { ChatSavedPermission } from '@shared/types'

/** What kind of tool a saved approval is for; the sidebar picks the icon by it. */
export type SavedPermissionKind = 'shell' | 'edit' | 'read' | 'outside' | 'web' | 'mcp' | 'code' | 'other'

export interface SavedPermissionGroup {
  action: string
  label: string
  kind: SavedPermissionKind
  /** The MCP server, for an MCP tool's action (`<server>_<tool>`). */
  server?: string
  permissions: ChatSavedPermission[]
}

const ACTIONS: Record<string, { label: string; kind: SavedPermissionKind }> = {
  shell: { label: 'Commands', kind: 'shell' },
  bash: { label: 'Commands', kind: 'shell' },
  edit: { label: 'File edits', kind: 'edit' },
  write: { label: 'File writes', kind: 'edit' },
  read: { label: 'File reads', kind: 'read' },
  glob: { label: 'File searches', kind: 'read' },
  grep: { label: 'Text searches', kind: 'read' },
  external_directory: { label: 'Outside the project', kind: 'outside' },
  webfetch: { label: 'Web pages', kind: 'web' },
  websearch: { label: 'Web searches', kind: 'web' },
  execute: { label: 'Code Mode', kind: 'code' },
  skill: { label: 'Skills', kind: 'other' },
  subagent: { label: 'Subagents', kind: 'other' },
  question: { label: 'Questions', kind: 'other' },
  todowrite: { label: 'To-do list', kind: 'other' },
}
const ORDER: readonly SavedPermissionKind[] = ['shell', 'edit', 'read', 'outside', 'web', 'code', 'mcp', 'other']

/**
 * How an action reads in the sidebar. An MCP tool's action is `<server>_<tool>`; it is named after the server when
 * the server is one OpenCode lists (a server name may hold `_` itself, so the longest listed name that fits wins).
 */
export function savedPermissionAction(action: string, mcpServers: readonly string[] = []): Omit<SavedPermissionGroup, 'action' | 'permissions'> {
  const known = ACTIONS[action]
  if (known) return known
  const server = [...mcpServers]
    .sort((a, b) => b.length - a.length)
    .find((name) => action.startsWith(`${name}_`) && action.length > name.length + 1)
  if (server) return { label: action.slice(server.length + 1), kind: 'mcp', server }
  if (action.startsWith('opencode_') && action.endsWith('_mcp_resource') || action === 'opencode_list_mcp_resources') {
    return { label: 'MCP resources', kind: 'mcp' }
  }
  return { label: action, kind: 'other' }
}

/** The approvals grouped by action, the usual kinds first (commands, edits, reads…), each group oldest first. */
export function groupSavedPermissions(permissions: readonly ChatSavedPermission[], mcpServers: readonly string[] = []): SavedPermissionGroup[] {
  const groups = new Map<string, SavedPermissionGroup>()
  for (const permission of permissions) {
    let group = groups.get(permission.action)
    if (!group) {
      group = { action: permission.action, ...savedPermissionAction(permission.action, mcpServers), permissions: [] }
      groups.set(permission.action, group)
    }
    group.permissions.push(permission)
  }
  return [...groups.values()].sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
    (a.server ?? '').localeCompare(b.server ?? '') ||
    a.label.localeCompare(b.label))
}

/** The pattern as it reads: `*` alone allows anything of that kind. */
export function savedPermissionPattern(resource: string): { text: string; anything: boolean } {
  return resource === '*' ? { text: 'Anything', anything: true } : { text: resource, anything: false }
}

const NOUNS: Partial<Record<string, string>> = {
  shell: 'command',
  bash: 'command',
  edit: 'file edit',
  write: 'file edit',
  read: 'file read',
  glob: 'file search',
  grep: 'text search',
  external_directory: 'use of a folder outside the project',
  webfetch: 'web page',
  websearch: 'web search',
  execute: 'Code Mode script',
}

/**
 * What answering a permission request "Always allow" would save, said before it is chosen: OpenCode saves the
 * request's patterns for the whole project, and for some tools (file edits) that is `*`, every one of them.
 */
export function alwaysAllowHint(action: string, save: readonly string[] | undefined): { broad: boolean; noun: string; patterns: string[] } | null {
  if (!save || save.length === 0) return null
  const noun = NOUNS[action] ?? `use of ${action}`
  return { broad: save.includes('*'), noun, patterns: save.filter((pattern) => pattern !== '*') }
}
