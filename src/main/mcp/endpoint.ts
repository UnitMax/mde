import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the running MDE listens for the bridge, and the secret the bridge must show. Both are derived from MDE's
 * data folder, so the app and a bridge started from the same installation agree without being told.
 */

export const MDE_MCP_TOKEN_FILE = 'mcp-token'
const SOCKET_FILE = 'mcp.sock'
/** A Unix socket path must fit in `sockaddr_un.sun_path` (104 bytes on macOS, with its terminator). */
const UNIX_SOCKET_PATH_MAX = 100

function folderHash(userData: string): string {
  return createHash('sha256').update(userData).digest('hex').slice(0, 16)
}

/** A named pipe on Windows; a socket file in the data folder elsewhere, or in the temporary folder when that path is too long. */
export function mcpEndpoint(userData: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\mde-mcp-${folderHash(userData)}`
  const inData = join(userData, SOCKET_FILE)
  if (Buffer.byteLength(inData) <= UNIX_SOCKET_PATH_MAX) return inData
  return join(tmpdir(), `mde-mcp-${folderHash(userData)}.sock`)
}

const TOKEN = /^[0-9a-f]{64}$/

/** The token the bridge must send, made on first use; the file is readable only by this user. */
export async function ensureMcpToken(userData: string): Promise<string> {
  const path = join(userData, MDE_MCP_TOKEN_FILE)
  const existing = await readMcpToken(userData)
  if (existing) return existing
  const token = randomBytes(32).toString('hex')
  await fs.mkdir(userData, { recursive: true })
  await fs.writeFile(path, token, { mode: 0o600 })
  // An existing file with looser permissions (or one written by an older copy) is tightened too.
  await fs.chmod(path, 0o600).catch(() => undefined)
  return token
}

export async function readMcpToken(userData: string): Promise<string | null> {
  try {
    const value = (await fs.readFile(join(userData, MDE_MCP_TOKEN_FILE), 'utf8')).trim()
    return TOKEN.test(value) ? value : null
  } catch {
    return null
  }
}
