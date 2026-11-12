import type { TerminalPalette } from './ipc'
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
/** Terminals agents may open, across all of them, within a minute. */
export const MDE_MCP_TERMINALS_PER_MINUTE = 10
/** Agents open no pane once the Inbox terminal has this many (the largest layout it offers). */
export const MDE_MCP_TERMINAL_PANE_LIMIT = 9
/** The longest command an agent may have typed into a terminal it opens. */
export const MDE_MCP_COMMAND_LIMIT = 2000
/** The longest title an agent may give a terminal pane. */
export const MDE_MCP_TERMINAL_TITLE_LIMIT = 60
/** "Allow for the next hour" on a command's approval bar. */
export const MDE_MCP_ALLOW_COMMANDS_MS = 60 * 60 * 1000

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
  {
    name: 'open_terminal',
    title: 'Open an MDE terminal',
    description: [
      'Opens a new pane in the MDE Inbox terminal, the shell the person keeps beside their threads, and returns at once.',
      'Use it to launch something the person should see or keep running, such as a dev server or a watcher, rather',
      'than for commands whose output you need: you do not see this terminal. The shell starts in this thread\'s',
      'directory unless `directory` names another. `command` is typed into the new shell and run; depending on the',
      'person\'s settings MDE may first ask them to approve it, and the answer says whether it is running or waiting.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'One shell command line to run in the new terminal, for example "npm run dev". Leave it out to open an empty shell.' },
        directory: { type: 'string', description: 'Absolute directory the shell starts in. Defaults to this thread\'s directory.' },
        title: { type: 'string', description: 'Short title for the pane, for example "Dev server". Defaults to the command.' },
      },
      additionalProperties: false,
    },
  },
]

export type MdeMcpToolName = 'list_projects' | 'create_thread' | 'open_terminal'

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

/** Bidirectional formatting characters, which can make a command read differently from what runs. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/**
 * Why text cannot be a command an agent has typed into a terminal, or null. One visible line only: no line
 * breaks (which would run a second command), no escape or other control characters (which a terminal or the
 * shell's line editor would act on) and no bidirectional overrides (which could make the approval bar show
 * something other than what runs).
 */
export function terminalCommandProblem(command: string): string | null {
  if (!command.trim()) return 'is empty'
  if (command.length > MDE_MCP_COMMAND_LIMIT) return `is longer than ${MDE_MCP_COMMAND_LIMIT} characters`
  if (CONTROL_CHARACTERS.test(command)) return 'must be one line without control characters'
  if (BIDI_CONTROLS.test(command)) return 'holds bidirectional formatting characters'
  return null
}

/** Whether a command an agent asks to run in a terminal it opens runs at once, or waits for the person. */
export type MdeMcpTerminalCommands = 'ask' | 'run'

export interface MdeMcpTerminalSettings {
  commands: MdeMcpTerminalCommands
  /** Until when commands run without asking although `commands` is `ask` ("Allow for the next hour"); null if not. */
  allowedUntil: number | null
}

/** Changes the setting; `allowedUntil` may only be cleared from the settings, never extended. */
export interface MdeMcpTerminalSettingsUpdate {
  commands: MdeMcpTerminalCommands
  allowedUntil?: null
}

/** Main asks the window for a new Inbox terminal pane an agent opens. */
export interface AgentTerminalOpenRequest {
  requestId: string
  /** The pane's title. */
  title: string
  /** The command main will type into the shell, shown on the approval bar; null for an empty shell. */
  command: string | null
  /** The command waits for the person's approval. */
  approval: boolean
  /** The thread whose agent asked, for the approval bar. */
  from: string | null
}

/** The window's answer: the pane it is adding, whose shell main then starts in the agent's directory. */
export interface AgentTerminalClaim {
  requestId: string
  terminalId: string
  palette: TerminalPalette
}

/** The window could not add the pane; the agent reads the reason. */
export interface AgentTerminalRefusal {
  requestId: string
  reason: string
}

export type AgentTerminalDecisionKind = 'run' | 'run-for-hour' | 'cancel'

export interface AgentTerminalDecision {
  terminalId: string
  decision: AgentTerminalDecisionKind
}
