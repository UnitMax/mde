import type { Socket } from 'node:net'
import {
  MDE_MCP_BRIDGE_FLAG,
  MDE_MCP_DATA_FLAG,
  MDE_MCP_REQUEST_BYTES,
  MDE_MCP_TARGET_FLAG,
  parseMdeMcpTarget,
  type MdeMcpRequest,
  type MdeMcpResponse,
} from '@shared/mde-mcp'
import type { OpenCodeTarget } from '@shared/types'
import { LineSplitter } from './lines'
import { McpStdioServer, type McpToolCall, type McpToolOutcome } from './protocol'

/**
 * The bridge: the process OpenCode starts as the `mde` MCP server. It speaks MCP on stdin/stdout, and hands each
 * tool call to the running MDE as one request on a fresh socket connection. Holding no connection between calls
 * means MDE can be closed and opened again while OpenCode keeps the bridge running.
 */

/** A message from OpenCode larger than this is refused (a prompt is at most 100,000 characters). */
const STDIN_LINE_BYTES = 4_000_000
/** Starting a thread may cut a Git worktree first, which can take a while on a large repository. */
const CALL_TIMEOUT_MS = 5 * 60_000
export const MDE_NOT_RUNNING = 'MDE is not running, so it cannot start threads. Open MDE and try again.'

export function isMcpBridgeLaunch(argv: readonly string[]): boolean {
  return argv.includes(MDE_MCP_BRIDGE_FLAG)
}

/** The target named by `--mcp-target=<native|wsl:distro>` (or `--mcp-target <value>`); native when absent. */
export function bridgeTarget(argv: readonly string[]): OpenCodeTarget | null {
  const index = argv.findIndex((arg) => arg === MDE_MCP_TARGET_FLAG || arg.startsWith(`${MDE_MCP_TARGET_FLAG}=`))
  if (index === -1) return { kind: 'native' }
  const arg = argv[index] as string
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1]
  return value ? parseMdeMcpTarget(value) : null
}

/** The data folder named by `--mcp-user-data=<folder>`: undefined when absent, null when it is not an absolute path. */
export function bridgeDataFolder(argv: readonly string[]): string | undefined | null {
  const arg = argv.find((entry) => entry.startsWith(`${MDE_MCP_DATA_FLAG}=`))
  if (arg === undefined) return undefined
  const value = arg.slice(MDE_MCP_DATA_FLAG.length + 1)
  const absolute = value.startsWith('/') || /^[A-Za-z]:\\/.test(value) || value.startsWith('\\\\')
  return absolute && value.length <= 1024 && !/[\u0000-\u001f]/.test(value) ? value : null
}

/**
 * The command OpenCode's configuration names for the bridge. A packaged MDE is one executable; in development
 * Electron needs the app folder before the arguments.
 */
export function bridgeCommand(options: { executable: string; appPath?: string; userDataDir?: string; target: OpenCodeTarget }): string[] {
  const value = options.target.kind === 'wsl' ? `wsl:${options.target.distro}` : 'native'
  return [
    options.executable,
    ...(options.appPath ? [options.appPath] : []),
    MDE_MCP_BRIDGE_FLAG,
    `${MDE_MCP_TARGET_FLAG}=${value}`,
    // An MDE started with its own data folder listens on that folder's socket and keeps its token there; the
    // bridge has to look in the same place. It is a path on MDE's side, so it is never translated for WSL.
    ...(options.userDataDir ? [`${MDE_MCP_DATA_FLAG}=${options.userDataDir}`] : []),
  ]
}

export interface BridgeConnection {
  connect(): Socket
  readToken(): Promise<string | null>
}

/** Sends one request to MDE and reads its one-line answer. Never throws: a failure is the answer's error. */
export function callMde(connection: BridgeConnection, request: Omit<MdeMcpRequest, 'token'>, timeoutMs = CALL_TIMEOUT_MS): Promise<MdeMcpResponse> {
  return connection.readToken().then((token) => {
    if (!token) return { ok: false, error: MDE_NOT_RUNNING }
    return new Promise<MdeMcpResponse>((resolve) => {
      let settled = false
      const socket = connection.connect()
      const finish = (response: MdeMcpResponse): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(response)
      }
      const timer = setTimeout(() => finish({ ok: false, error: 'MDE did not answer in time.' }), timeoutMs)
      const lines = new LineSplitter(MDE_MCP_REQUEST_BYTES, (line) => {
        try {
          const parsed = JSON.parse(line) as MdeMcpResponse
          finish(parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean'
            ? parsed
            : { ok: false, error: 'MDE sent an answer the bridge does not understand.' })
        } catch {
          finish({ ok: false, error: 'MDE sent an answer the bridge does not understand.' })
        }
      }, () => finish({ ok: false, error: 'MDE sent an answer larger than the bridge accepts.' }))
      socket.on('connect', () => socket.write(`${JSON.stringify({ ...request, token })}\n`))
      socket.on('data', (data) => lines.push(data))
      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish({ ok: false, error: error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? MDE_NOT_RUNNING : `Could not reach MDE: ${error.message}` })
      })
      socket.on('close', () => finish({ ok: false, error: 'MDE closed the connection without answering.' }))
    })
  })
}

export interface BridgeOptions extends BridgeConnection {
  input: NodeJS.ReadableStream
  write(text: string): void
  target: OpenCodeTarget
  cwd: string
  version: string
}

/** Serves MCP on `input`/`write` until the input ends and every call has been answered. */
export function runBridge(options: BridgeOptions): Promise<void> {
  const server = new McpStdioServer({
    version: options.version,
    write: (line) => options.write(`${line}\n`),
    callTool: async (call: McpToolCall): Promise<McpToolOutcome> => {
      const response = await callMde(options, {
        version: 1,
        target: options.target,
        cwd: options.cwd,
        ...(call.sessionId ? { sessionId: call.sessionId } : {}),
        tool: call.name,
        arguments: call.arguments,
      })
      return response.ok ? { text: response.text, isError: false } : { text: response.error, isError: true }
    },
  })
  const lines = new LineSplitter(STDIN_LINE_BYTES, (line) => { void server.handleLine(line) }, () => {
    options.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } })}\n`)
  })
  return new Promise((resolve) => {
    let ended = false
    const end = (): void => {
      if (ended) return
      ended = true
      void server.settled().then(resolve)
    }
    options.input.on('data', (data: Buffer | string) => lines.push(data))
    options.input.on('end', end)
    options.input.on('close', end)
    options.input.on('error', end)
  })
}
