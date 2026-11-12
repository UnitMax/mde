import { createReadStream } from 'node:fs'
import { createConnection } from 'node:net'
import { app } from 'electron'
import { bridgeDataFolder, bridgeTarget, runBridge } from './bridge'
import { mcpEndpoint, readMcpToken } from './endpoint'

/**
 * MDE started as the `mde` MCP server (`--mcp-bridge`): no window, no single-instance lock, no stores. stdout
 * carries the protocol, so anything that would log there goes to stderr instead.
 */
export function startMcpBridge(argv: readonly string[]): void {
  console.log = console.error
  console.info = console.error
  console.warn = console.error
  console.debug = console.error
  // A bridge is not an app the person switches to.
  app.dock?.hide()
  const target = bridgeTarget(argv)
  if (!target) {
    process.stderr.write('mde --mcp-bridge: --mcp-target must be "native" or "wsl:<distro>".\n')
    app.exit(2)
    return
  }
  // OpenCode went away: there is no one left to answer.
  process.stdout.on('error', () => app.exit(0))
  const dataFolder = bridgeDataFolder(argv)
  if (dataFolder === null) {
    process.stderr.write('mde --mcp-bridge: --mcp-user-data must be an absolute path.\n')
    app.exit(2)
    return
  }
  const userData = dataFolder ?? app.getPath('userData')
  const endpoint = mcpEndpoint(userData, process.platform)
  void runBridge({
    input: bridgeInput(process.platform),
    write: (text) => { process.stdout.write(text) },
    target,
    cwd: process.cwd(),
    version: app.getVersion(),
    connect: () => createConnection(endpoint),
    readToken: () => readMcpToken(userData),
  }).finally(() => app.exit(0))
}

/**
 * OpenCode's end of the pipe. On Windows MDE is a GUI program, and Electron gives its main process a
 * placeholder `process.stdin` that ends at once even when the parent passed a pipe (seen when OpenCode in WSL
 * starts mde.exe: the bridge exited with code 0 before reading anything). The pipe itself is there as file
 * descriptor 0, so it is read directly. `process.stdin` works elsewhere.
 */
export function bridgeInput(platform: NodeJS.Platform): NodeJS.ReadableStream {
  return platform === 'win32' ? createReadStream('', { fd: 0, autoClose: false }) : process.stdin
}
