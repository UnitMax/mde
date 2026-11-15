import { timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { MDE_MCP_REQUEST_BYTES, parseMdeMcpTarget, formatMdeMcpTarget, type MdeMcpRequest, type MdeMcpResponse } from '@shared/mde-mcp'
import { LineSplitter } from './lines'

/**
 * The running MDE's end of the bridge: a Unix socket or named pipe that takes one JSON request per connection and
 * sends one answer back. The endpoint is private to this user (the socket file's mode, the pipe's default ACL),
 * and every request must also carry the token from MDE's data folder, which only this user can read.
 */

/** Bridges calling at once; each call is short, so more than this is something going wrong. */
const MAX_CONNECTIONS = 16
/** A bridge sends its request as soon as it connects. */
const REQUEST_TIMEOUT_MS = 10_000

export interface McpListenerOptions {
  path: string
  platform: NodeJS.Platform
  token(): string
  handle(request: MdeMcpRequest): Promise<MdeMcpResponse>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The request's shape, or why it is not one; the token is checked separately. */
export function parseMcpRequest(value: unknown): MdeMcpRequest | string {
  if (!isRecord(value) || value.version !== 1) return 'This bridge is from a different version of MDE. Install the MDE MCP again from MDE’s settings.'
  const target = isRecord(value.target) ? parseMdeMcpTarget(value.target.kind === 'wsl' ? `wsl:${String(value.target.distro)}` : String(value.target.kind)) : null
  if (!target) return 'The request names no OpenCode target.'
  if (typeof value.cwd !== 'string' || value.cwd.length > 4096) return 'The request names no working directory.'
  if (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !/^ses_[A-Za-z0-9_-]{1,128}$/.test(value.sessionId))) {
    return 'The request names a session MDE does not understand.'
  }
  if (typeof value.tool !== 'string' || value.tool.length > 64) return 'The request names no tool.'
  if (!isRecord(value.arguments)) return 'Tool arguments must be an object.'
  return {
    version: 1,
    token: String(value.token ?? ''),
    target,
    cwd: value.cwd,
    ...(value.sessionId ? { sessionId: value.sessionId as string } : {}),
    tool: value.tool,
    arguments: value.arguments,
  }
}

export class McpListener {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()

  constructor(private readonly options: McpListenerOptions) {}

  async start(): Promise<void> {
    if (this.server) return
    if (this.options.platform !== 'win32') await this.removeStaleSocket()
    const server = createServer((socket) => this.accept(socket))
    server.maxConnections = MAX_CONNECTIONS
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => console.warn(`[mcp] listener error: ${error.message}`))
    if (this.options.platform !== 'win32') await fs.chmod(this.options.path, 0o600)
    this.server = server
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    for (const socket of this.sockets) socket.destroy()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Only one MDE runs per data folder (the single-instance lock), so a socket file left behind is a crashed one's. */
  private async removeStaleSocket(): Promise<void> {
    const stat = await fs.lstat(this.options.path).catch(() => null)
    if (stat?.isSocket()) await fs.unlink(this.options.path)
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy())
    let answered = false
    const answer = (response: MdeMcpResponse): void => {
      if (socket.destroyed) return
      socket.end(`${JSON.stringify(response)}\n`)
    }
    const lines = new LineSplitter(MDE_MCP_REQUEST_BYTES, (line) => {
      if (answered) return
      answered = true
      // The request has arrived; the work it asks for may take longer than reading it may.
      socket.setTimeout(0)
      void this.respond(line).then(answer)
    }, () => {
      answered = true
      answer({ ok: false, error: 'The request is larger than MDE accepts.' })
    })
    socket.on('data', (data) => lines.push(data))
  }

  private async respond(line: string): Promise<MdeMcpResponse> {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return { ok: false, error: 'MDE could not read the request.' }
    }
    if (!isRecord(value) || !sameToken(value.token, this.options.token())) {
      return { ok: false, error: 'MDE refused the request: its token does not match. Install the MDE MCP again from MDE’s settings.' }
    }
    const request = parseMcpRequest(value)
    if (typeof request === 'string') return { ok: false, error: request }
    try {
      return await this.options.handle(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[mcp] ${request.tool} for ${formatMdeMcpTarget(request.target)} failed: ${message}`)
      return { ok: false, error: message }
    }
  }
}
