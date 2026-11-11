import type { OpenCodeTarget } from './types'

/**
 * The MDE MCP server: OpenCode starts MDE's own executable with `--mcp-bridge` as a local (stdio) MCP server,
 * and that bridge passes each tool call to the running MDE over a private socket. These are the names, the
 * tool list both sides agree on, and the small request/answer format used on that socket.
 */

/** The server's key in `mcp.servers` of OpenCode's configuration, and so the `tools.mde.*` prefix agents see. */
export const MDE_MCP_SERVER_NAME = 'mde'

/** The argument that starts MDE as the bridge rather than as the app. */
export const MDE_MCP_BRIDGE_FLAG = '--mcp-bridge'
/** Names the OpenCode the bridge was configured for: `native` or `wsl:<distro>`. */
export const MDE_MCP_TARGET_FLAG = '--mcp-target'

/**
 * MDE's data folder, when it is not the default one (MDE started with `--user-data-dir`). The bridge finds the
 * socket and the token from it. Electron does not apply `--user-data-dir` to a bridge that never becomes ready,
 * so the bridge takes the folder itself.
 */
export const MDE_MCP_DATA_FLAG = '--mcp-user-data'

/** Threads an agent may start, across all of them, within a minute. */
export const MDE_MCP_SPAWNS_PER_MINUTE = 10
/** How deep a chain of threads that started threads may go: a person's thread is depth 0. */
export const MDE_MCP_MAX_DEPTH = 3
/** The most bytes one request on the socket may hold (a prompt is at most 100,000 characters). */
export const MDE_MCP_REQUEST_BYTES = 1_000_000

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

export const MDE_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_projects',
    title: 'List MDE projects',
    description:
      'Lists the projects (folders) in the MDE Inbox that threads can be started in: name, directory and whether it is a Git worktree MDE made.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_thread',
    title: 'Start an MDE thread',
    description: [
      'Starts a new thread (a separate agent session) in the MDE Inbox with the given prompt, and returns at once;',
      'the new thread works on its own and the person sees it in MDE. Use it to hand off independent work.',
      'It runs in the same directory as this thread unless `directory` names another one (a folder MDE does not',
      'know yet becomes a new project), or `worktree` asks for a new Git worktree so its file changes stay apart.',
      'It uses this thread\'s model unless `model` is given.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The first message of the new thread. Make it self-contained: the new thread does not see this conversation.' },
        directory: { type: 'string', description: 'Absolute directory to work in. Defaults to this thread\'s directory.' },
        agent: { type: 'string', description: 'OpenCode agent, for example "build" or "plan". Defaults to the one last chosen in MDE.' },
        model: { type: 'string', description: 'Model as "provider/model", for example "anthropic/claude-sonnet-4". Defaults to this thread\'s model.' },
        mode: { type: 'string', enum: ['gui', 'terminal'], description: 'Show the thread as a chat ("gui", the default) or in OpenCode\'s terminal interface.' },
        worktree: {
          type: 'object',
          description: 'Run the thread in a new Git worktree of the directory\'s repository.',
          properties: {
            base: { type: 'string', description: 'Branch to start from. Defaults to the current branch.' },
            branch: { type: 'string', description: 'Name of the new branch. Defaults to mde/<id>.' },
          },
          additionalProperties: false,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
]

export type MdeMcpToolName = 'list_projects' | 'create_thread'

/** One tool call, sent by the bridge as the only line of a connection. */
export interface MdeMcpRequest {
  version: 1
  /** The secret in MDE's data folder, which only this user can read. */
  token: string
  /** The OpenCode the bridge was configured for. */
  target: OpenCodeTarget
  /** The bridge's working directory: OpenCode starts it in the project's directory. */
  cwd: string
  /** The calling OpenCode session, from the call's `_meta`, when OpenCode says. */
  sessionId?: string
  tool: string
  arguments: Record<string, unknown>
}

/** MDE's answer, the only line it sends back. `ok: false` is a tool error the agent should read. */
export type MdeMcpResponse =
  | { ok: true; text: string; data?: unknown }
  | { ok: false; error: string }

/** Whether the MDE MCP is in one OpenCode configuration, and whether it starts this copy of MDE. */
export type MdeMcpInstallState = 'missing' | 'installed' | 'outdated'

export interface MdeMcpStatus {
  state: MdeMcpInstallState
  /** The configuration file, `~`-shortened. */
  file: string
  /** Set when the file cannot be read as JSONC; nothing is written to it then. */
  parseError: string | null
}

export function formatMdeMcpTarget(target: OpenCodeTarget): string {
  return target.kind === 'wsl' ? `wsl:${target.distro}` : 'native'
}

/** A WSL distribution's name, by the same rule the IPC validator uses; it travels as one argv entry, never through a shell. */
const DISTRO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,126}[A-Za-z0-9._-])?$/

export function parseMdeMcpTarget(value: string): OpenCodeTarget | null {
  if (value === 'native') return { kind: 'native' }
  if (!value.startsWith('wsl:')) return null
  const distro = value.slice(4)
  return DISTRO_NAME.test(distro) ? { kind: 'wsl', distro } : null
}
