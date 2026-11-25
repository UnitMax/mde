import type { PermissionRule } from '@shared/opencode-config'

/**
 * How much a thread's agent may do without asking, picked per thread. `default` sends nothing, so the OpenCode
 * configuration (global and project) decides alone. Every other mode is a set of rules OpenCode keeps with the
 * session and applies after the configuration's, so a mode stands on its own: what it says about an action wins.
 *
 * A mode only speaks about the actions that change things or reach out: edits, shell commands, Code Mode scripts,
 * work outside the project, the web and MCP tools. It never sets `*`, because that would also override what OpenCode
 * itself asks about (reading `.env` files) and what it forbids subagents (starting subagents of their own), and a
 * subagent takes its thread's rules with it. A tool a mode denies is taken from the agent, not refused when called.
 *
 * Approvals saved with "Always" still count where a mode asks; only a deny is final.
 *
 * `reviewed` gives OpenCode the same rules as `ask`: what makes it different happens in MDE, which hands each request
 * to the tool reviewer before showing it, approves the ones the reviewer finds safe and asks about the rest.
 */
export const THREAD_PERMISSION_MODES = ['default', 'read-only', 'ask', 'reviewed', 'auto-edit', 'full', 'full-web-asks'] as const
export type ThreadPermissionMode = (typeof THREAD_PERMISSION_MODES)[number]

export function isThreadPermissionMode(value: unknown): value is ThreadPermissionMode {
  return typeof value === 'string' && (THREAD_PERMISSION_MODES as readonly string[]).includes(value)
}

/** An MCP tool's action is `<server>_<tool>`. Actions match like file names, so this one stands for every MCP tool. */
const MCP_TOOLS = '*_*'

/**
 * Reading an MCP server's resources is reading, and both actions have an underscore, so a rule for every MCP tool
 * catches them too; they are let through again after it.
 */
const MCP_RESOURCE_READS = ['opencode_list_mcp_resources', 'opencode_read_mcp_resource']

/**
 * The actions that change something or reach outside the project. `edit` covers writing and patching files too.
 * `external_directory` comes after `*_*`, which matches it as well.
 */
const ACTIONS = ['edit', 'shell', 'execute', 'webfetch', 'websearch', MCP_TOOLS, 'external_directory'] as const
type Action = (typeof ACTIONS)[number]
type Effects = Record<Action, PermissionRule['effect']>

function rules(effects: Effects): PermissionRule[] {
  return [
    ...ACTIONS.map((action) => ({ action, resource: '*', effect: effects[action] })),
    ...(effects[MCP_TOOLS] === 'allow' ? [] : MCP_RESOURCE_READS.map((action) => ({ action, resource: '*', effect: 'allow' as const }))),
  ]
}

const all = (effect: PermissionRule['effect']): Effects =>
  Object.fromEntries(ACTIONS.map((action) => [action, effect])) as Effects

const RULES: Record<Exclude<ThreadPermissionMode, 'default'>, PermissionRule[]> = {
  // Looking outside the project is still looking, so it asks rather than being refused.
  'read-only': rules({ ...all('deny'), external_directory: 'ask' }),
  ask: rules(all('ask')),
  reviewed: rules(all('ask')),
  'auto-edit': rules({ ...all('ask'), edit: 'allow' }),
  full: rules(all('allow')),
  'full-web-asks': rules({ ...all('allow'), webfetch: 'ask', websearch: 'ask' }),
}

/** The rules a mode gives OpenCode for the session; empty for `default`, which leaves the configuration alone. */
export function threadPermissionRules(mode: ThreadPermissionMode): PermissionRule[] {
  return mode === 'default' ? [] : RULES[mode].map((rule) => ({ ...rule }))
}

export interface ThreadPermissionModeInfo {
  id: ThreadPermissionMode
  label: string
  /** One line for the menu. */
  description: string
}

export const THREAD_PERMISSION_MODE_INFO: readonly ThreadPermissionModeInfo[] = [
  { id: 'default', label: 'Default permissions', description: 'Your OpenCode settings, global and project.' },
  { id: 'read-only', label: 'Read-only', description: 'Can read and search; no edits, commands, web or MCP tools.' },
  { id: 'ask', label: 'Ask first', description: 'Asks before edits, commands, web and MCP tools.' },
  { id: 'reviewed', label: 'Auto (reviewed)', description: 'A reviewer model approves safe actions; risky ones ask you.' },
  { id: 'auto-edit', label: 'Auto-accept edits', description: 'Edits go through; commands, web and MCP tools ask.' },
  { id: 'full', label: 'Full access', description: 'Nothing asks.' },
  { id: 'full-web-asks', label: 'Full access, web asks', description: 'Nothing asks except web fetch and search.' },
]

export function threadPermissionModeInfo(mode: ThreadPermissionMode): ThreadPermissionModeInfo {
  return THREAD_PERMISSION_MODE_INFO.find((item) => item.id === mode)!
}
