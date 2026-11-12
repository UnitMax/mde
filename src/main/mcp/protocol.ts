import { MDE_MCP_SERVER_NAME, MDE_MCP_TOOLS } from '@shared/mde-mcp'

/**
 * The MCP server side of the bridge: JSON-RPC 2.0 over newline-delimited stdio, with only what MDE needs —
 * `initialize`, `ping`, `tools/list` and `tools/call`. The tool list is fixed, so the bridge answers everything
 * but a call itself, and OpenCode sees the server connected even while MDE is closed.
 */

/** Newest first; the client's version is used when it is one of these, the newest otherwise. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

/** OpenCode puts the calling session here in each call's `_meta` (verified with OpenCode 2.2.6). */
export const OPENCODE_SESSION_META = 'ai.opencode/sessionID'

export interface McpToolCall {
  name: string
  arguments: Record<string, unknown>
  sessionId?: string
}

export interface McpToolOutcome {
  text: string
  isError: boolean
}

export interface McpStdioServerOptions {
  write(line: string): void
  callTool(call: McpToolCall): Promise<McpToolOutcome>
  version: string
}

type JsonRpcId = string | number | null

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

const INSTRUCTIONS =
  'MDE is the desktop app this agent runs in. Its tools start new agent threads in the MDE Inbox (each one works on its own and the person follows it in MDE), open terminals beside them, and show the person views (charts, tables, dashboards) in the chat.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export class McpStdioServer {
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly options: McpStdioServerOptions) {}

  /** Handles one line from the client. The returned promise settles once any answer has been written. */
  handleLine(line: string): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.error(null, PARSE_ERROR, 'Parse error')
      return Promise.resolve()
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      this.error(isRecord(message) && isId(message.id) ? message.id : null, INVALID_REQUEST, 'Invalid request')
      return Promise.resolve()
    }
    // A notification, or the client's answer to a request MDE never makes: nothing to say back.
    if (typeof message.method !== 'string' || !('id' in message)) return Promise.resolve()
    if (!isId(message.id)) {
      this.error(null, INVALID_REQUEST, 'Invalid request id')
      return Promise.resolve()
    }
    const run = this.dispatch(message.id, message.method, message.params)
    this.pending.add(run)
    void run.finally(() => this.pending.delete(run))
    return run
  }

  /** Waits for the calls still running, so their answers are written before the bridge exits. */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  private async dispatch(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    if (method === 'initialize') {
      const requested = isRecord(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0]
      this.result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MDE_MCP_SERVER_NAME, title: 'MDE', version: this.options.version },
        instructions: INSTRUCTIONS,
      })
      return
    }
    if (method === 'ping') return this.result(id, {})
    if (method === 'tools/list') return this.result(id, { tools: MDE_MCP_TOOLS })
    if (method !== 'tools/call') return this.error(id, METHOD_NOT_FOUND, `Method not found: ${method}`)
    if (!isRecord(params) || typeof params.name !== 'string') return this.error(id, INVALID_PARAMS, 'tools/call needs a tool name.')
    const name = params.name
    if (!MDE_MCP_TOOLS.some((tool) => tool.name === name)) return this.error(id, INVALID_PARAMS, `Unknown tool: ${name}`)
    if (params.arguments !== undefined && !isRecord(params.arguments)) return this.error(id, INVALID_PARAMS, 'Tool arguments must be an object.')
    const meta = isRecord(params._meta) ? params._meta[OPENCODE_SESSION_META] : undefined
    let outcome: McpToolOutcome
    try {
      outcome = await this.options.callTool({
        name,
        arguments: params.arguments ?? {},
        ...(typeof meta === 'string' ? { sessionId: meta } : {}),
      })
    } catch (error) {
      outcome = { text: error instanceof Error ? error.message : String(error), isError: true }
    }
    this.result(id, { content: [{ type: 'text', text: outcome.text }], isError: outcome.isError })
  }

  private result(id: JsonRpcId, result: unknown): void {
    this.options.write(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  private error(id: JsonRpcId, code: number, message: string): void {
    this.options.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
  }
}
