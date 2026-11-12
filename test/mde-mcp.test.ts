import { promises as fs } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MDE_MCP_MAX_DEPTH, MDE_MCP_SPAWNS_PER_MINUTE, MDE_MCP_TERMINALS_PER_MINUTE, MDE_MCP_TOOLS, terminalCommandProblem, type MdeMcpRequest } from '../src/shared/mde-mcp'
import type { ChatCreateRequest, InboxComposerState, InboxFolder, InboxThread, OpenCodeTarget } from '../src/shared/types'
import { LineSplitter } from '../src/main/mcp/lines'
import { McpStdioServer, MCP_PROTOCOL_VERSIONS } from '../src/main/mcp/protocol'
import { bridgeCommand, bridgeDataFolder, bridgeTarget, callMde, isMcpBridgeLaunch, MDE_NOT_RUNNING, runBridge } from '../src/main/mcp/bridge'
import { ensureMcpToken, mcpEndpoint, readMcpToken } from '../src/main/mcp/endpoint'
import { McpListener, parseMcpRequest } from '../src/main/mcp/listener'
import { callerDirectory, MdeMcpTools, parseModelArgument, type MdeMcpHost, type McpTerminalRequest, type McpThreadOptions } from '../src/main/mcp/tools'
import { mdeMcpCommand } from '../src/main/mcp'
import { bridgeInput } from '../src/main/mcp/bridge-main'
import { installMdeMcp, readMdeMcpState, removeMdeMcp } from '../src/main/opencode/config/mde-mcp'

const wsl: OpenCodeTarget = { kind: 'wsl', distro: 'Ubuntu-24.04' }
const native: OpenCodeTarget = { kind: 'native' }
const model = { id: 'model-1', providerId: 'provider-1' }

function server() {
  const lines: Record<string, unknown>[] = []
  const calls: unknown[] = []
  const mcp = new McpStdioServer({
    version: '0.1.14',
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    callTool: async (call) => {
      calls.push(call)
      return { text: 'done', isError: false }
    },
  })
  return { mcp, lines, calls }
}

describe('MDE MCP protocol', () => {
  it('answers initialize with the client’s version when it knows it, and its own newest otherwise', async () => {
    const { mcp, lines } = server()
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }))
    expect(lines[0]).toMatchObject({ id: 0, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mde', version: '0.1.14' } } })
    expect(lines[1]).toMatchObject({ id: 1, result: { protocolVersion: MCP_PROTOCOL_VERSIONS[0] } })
  })

  it('lists the tools, answers ping, and ignores notifications', async () => {
    const { mcp, lines } = server()
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'ping' }))
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 'a', result: { tools: MDE_MCP_TOOLS } },
      { jsonrpc: '2.0', id: 'b', result: {} },
    ])
  })

  it('passes a call on with the OpenCode session from _meta, and wraps the answer as text', async () => {
    const { mcp, lines, calls } = server()
    await mcp.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'create_thread', arguments: { prompt: 'Hi' }, _meta: { 'ai.opencode/sessionID': 'ses_parent', progressToken: 2 } },
    }))
    expect(calls).toEqual([{ name: 'create_thread', arguments: { prompt: 'Hi' }, sessionId: 'ses_parent' }])
    expect(lines[0]).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'done' }], isError: false } })
  })

  it('answers bad input with JSON-RPC errors', async () => {
    const { mcp, lines, calls } = server()
    await mcp.handleLine('{not json')
    await mcp.handleLine(JSON.stringify({ id: 1, method: 'ping' }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/list' }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rm_rf' } }))
    await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_projects', arguments: [] } }))
    expect(lines.map((line) => (line.error as { code: number }).code)).toEqual([-32700, -32600, -32601, -32602, -32602])
    expect(calls).toEqual([])
  })
})

describe('MDE MCP line framing', () => {
  it('splits across chunks, drops CR and blank lines, and skips a line that is too long', () => {
    const lines: string[] = []
    let overflows = 0
    const splitter = new LineSplitter(10, (line) => lines.push(line), () => { overflows += 1 })
    splitter.push('ab')
    splitter.push('c\r\n\n')
    splitter.push('0123456789ABC')
    splitter.push('DEF\nok\n')
    expect(lines).toEqual(['abc', 'ok'])
    expect(overflows).toBe(1)
  })
})

describe('MDE MCP bridge arguments', () => {
  it('recognises a bridge launch and its target', () => {
    expect(isMcpBridgeLaunch(['/app/mde', '--mcp-bridge'])).toBe(true)
    expect(isMcpBridgeLaunch(['/app/mde'])).toBe(false)
    expect(bridgeTarget(['mde', '--mcp-bridge'])).toEqual(native)
    expect(bridgeTarget(['mde', '--mcp-bridge', '--mcp-target=wsl:Ubuntu-24.04'])).toEqual(wsl)
    expect(bridgeTarget(['mde', '--mcp-bridge', '--mcp-target', 'native'])).toEqual(native)
    expect(bridgeTarget(['mde', '--mcp-target=wsl:../x'])).toBeNull()
    expect(bridgeTarget(['mde', '--mcp-target=remote'])).toBeNull()
    expect(bridgeDataFolder(['mde', '--mcp-bridge'])).toBeUndefined()
    expect(bridgeDataFolder(['mde', '--mcp-user-data=C:\\dev\\mde-data'])).toBe('C:\\dev\\mde-data')
    expect(bridgeDataFolder(['mde', '--mcp-user-data=/Users/me/mde-data'])).toBe('/Users/me/mde-data')
    expect(bridgeDataFolder(['mde', '--mcp-user-data=relative'])).toBeNull()
  })

  it('builds the command for a packaged app, a development app, and a WSL distro', async () => {
    expect(bridgeCommand({ executable: '/Applications/mde.app/Contents/MacOS/mde', target: native }))
      .toEqual(['/Applications/mde.app/Contents/MacOS/mde', '--mcp-bridge', '--mcp-target=native'])
    expect(bridgeCommand({ executable: '/repo/node_modules/electron/dist/electron', appPath: '/repo', target: native }))
      .toEqual(['/repo/node_modules/electron/dist/electron', '/repo', '--mcp-bridge', '--mcp-target=native'])
    // A separate data folder travels as-is: it is MDE's own path, also when OpenCode runs in WSL.
    await expect(mdeMcpCommand(wsl, { executable: 'C:\\mde\\mde.exe', userDataDir: 'C:\\dev\\mde-data' }, async () => '/mnt/c/mde/mde.exe'))
      .resolves.toEqual(['/mnt/c/mde/mde.exe', '--mcp-bridge', '--mcp-target=wsl:Ubuntu-24.04', '--mcp-user-data=C:\\dev\\mde-data'])
    const toWsl = async (_distro: string, path: string) => `/mnt/c/${path.slice(3).replace(/\\/g, '/')}`
    await expect(mdeMcpCommand(wsl, { executable: 'C:\\Users\\Me\\mde\\mde.exe' }, toWsl))
      .resolves.toEqual(['/mnt/c/Users/Me/mde/mde.exe', '--mcp-bridge', '--mcp-target=wsl:Ubuntu-24.04'])
    await expect(mdeMcpCommand(wsl, { executable: 'C:\\mde.exe' }, async () => null)).rejects.toThrow('Is the distro running?')
  })
})

describe('MDE MCP bridge input', () => {
  it('reads OpenCode’s pipe from file descriptor 0 on Windows, where Electron’s process.stdin ends at once', () => {
    const input = bridgeInput('win32') as ReturnType<typeof import('node:fs').createReadStream>
    expect(input).not.toBe(process.stdin)
    expect((input as unknown as { fd: number }).fd).toBe(0)
    input.destroy()
    expect(bridgeInput('darwin')).toBe(process.stdin)
  })
})

describe('MDE MCP endpoint and token', () => {
  let folder: string
  beforeEach(async () => { folder = await fs.mkdtemp(join(tmpdir(), 'mde-mcp-')) })
  afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }) })

  it('makes one private token and reads it back', async () => {
    expect(await readMcpToken(folder)).toBeNull()
    const token = await ensureMcpToken(folder)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(await ensureMcpToken(folder)).toBe(token)
    expect(await readMcpToken(folder)).toBe(token)
    if (process.platform !== 'win32') expect((await fs.stat(join(folder, 'mcp-token'))).mode & 0o777).toBe(0o600)
  })

  it('uses a named pipe on Windows and a socket file elsewhere, shortened when the path is too long', () => {
    expect(mcpEndpoint('C:\\Users\\Me\\AppData\\Roaming\\mde', 'win32')).toMatch(/^\\\\\.\\pipe\\mde-mcp-[0-9a-f]{16}$/)
    expect(mcpEndpoint('/Users/me/Library/Application Support/mde', 'darwin')).toBe('/Users/me/Library/Application Support/mde/mcp.sock')
    expect(mcpEndpoint(`/Users/me/${'x'.repeat(120)}`, 'darwin')).toMatch(/mde-mcp-[0-9a-f]{16}\.sock$/)
  })
})

describe('MDE MCP bridge and listener', () => {
  let folder: string
  let listener: McpListener | null
  beforeEach(async () => {
    folder = await fs.mkdtemp(join(tmpdir(), 'mde-mcp-'))
    listener = null
  })
  afterEach(async () => {
    await listener?.close()
    await fs.rm(folder, { recursive: true, force: true })
  })

  async function listen(handle: (request: MdeMcpRequest) => Promise<{ ok: true; text: string } | { ok: false; error: string }>) {
    const token = await ensureMcpToken(folder)
    // Where MDE itself would listen: a socket file in the folder, or a named pipe on Windows.
    const path = mcpEndpoint(folder, process.platform)
    listener = new McpListener({ path, platform: process.platform, token: () => token, handle })
    await listener.start()
    return { path, connection: { connect: () => createConnection(path), readToken: () => readMcpToken(folder) } }
  }

  it('carries a tool call from stdin through the socket and back, with the caller’s session', async () => {
    const seen: MdeMcpRequest[] = []
    const { connection } = await listen(async (request) => {
      seen.push(request)
      return { ok: true, text: `started from ${request.cwd}` }
    })
    const input = new PassThrough()
    const output: string[] = []
    const done = runBridge({ ...connection, input, write: (text) => output.push(text), target: native, cwd: '/home/me/app', version: '1' })
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } })}\n`)
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_thread', arguments: { prompt: 'Hi' }, _meta: { 'ai.opencode/sessionID': 'ses_parent' } } })}\n`)
    await done
    const answers = output.join('').trim().split('\n').map((line) => JSON.parse(line) as { id: number; result: { content?: { text: string }[]; isError?: boolean } })
    expect(answers.find((answer) => answer.id === 1)?.result).toEqual({ content: [{ type: 'text', text: 'started from /home/me/app' }], isError: false })
    expect(seen).toEqual([{ version: 1, token: expect.any(String), target: native, cwd: '/home/me/app', sessionId: 'ses_parent', tool: 'create_thread', arguments: { prompt: 'Hi' } }])
  })

  it('refuses a request with the wrong token', async () => {
    const { connection } = await listen(async () => ({ ok: true, text: 'should not run' }))
    const response = await callMde({ connect: connection.connect, readToken: async () => 'f'.repeat(64) }, { version: 1, target: native, cwd: '/', tool: 'list_projects', arguments: {} })
    expect(response).toEqual({ ok: false, error: expect.stringContaining('token does not match') })
  })

  it('says MDE is not running when nothing listens', async () => {
    await ensureMcpToken(folder)
    const response = await callMde(
      { connect: () => createConnection(join(folder, 'missing.sock')), readToken: () => readMcpToken(folder) },
      { version: 1, target: native, cwd: '/', tool: 'list_projects', arguments: {} },
    )
    expect(response).toEqual({ ok: false, error: MDE_NOT_RUNNING })
    // Without a token MDE has never run here.
    await fs.rm(join(folder, 'mcp-token'))
    expect(await callMde({ connect: () => createConnection(join(folder, 'missing.sock')), readToken: () => readMcpToken(folder) }, { version: 1, target: native, cwd: '/', tool: 'x', arguments: {} }))
      .toEqual({ ok: false, error: MDE_NOT_RUNNING })
  })

  it('replaces a socket file a crashed MDE left behind, and makes the socket private', async () => {
    const first = await listen(async () => ({ ok: true, text: 'one' }))
    // Simulate a crash: the server goes, the file stays.
    const stale = listener
    listener = null
    await new Promise<void>((resolve) => { (stale as unknown as { server: { close(cb: () => void): void } }).server.close(() => resolve()) })
    await fs.writeFile(join(folder, 'ignored'), '')
    await listen(async () => ({ ok: true, text: 'two' }))
    if (process.platform !== 'win32') expect((await fs.stat(first.path)).mode & 0o777).toBe(0o600)
  })

  it('checks the request’s shape', () => {
    const base = { version: 1, token: 't', target: native, cwd: '/', tool: 'list_projects', arguments: {} }
    expect(parseMcpRequest(base)).toEqual(base)
    expect(parseMcpRequest({ ...base, version: 2 })).toMatch(/different version/)
    expect(parseMcpRequest({ ...base, target: { kind: 'wsl', distro: '../x' } })).toMatch(/target/)
    expect(parseMcpRequest({ ...base, sessionId: 'ses_../x' })).toMatch(/session/)
    expect(parseMcpRequest({ ...base, arguments: [] })).toMatch(/object/)
  })
})

function thread(id: string, extra: Partial<InboxThread> = {}): InboxThread {
  return {
    id, title: id, directory: '/home/me/app', target: wsl, branch: 'main', model, status: 'working',
    createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: 'fld_app', ...extra,
  }
}

function folderOf(id: string, directory: string, extra: Partial<InboxFolder> = {}): InboxFolder {
  return { id, name: directory.split('/').at(-1) ?? id, directory, target: wsl, createdAt: 1, lastUsedAt: 1, ...extra }
}

function tools(options: { threads?: InboxThread[]; folders?: InboxFolder[]; composer?: InboxComposerState; branch?: string | null; terminal?: 'running' | 'waiting' | 'none' | Error } = {}) {
  let now = 100_000
  const threads = new Map((options.threads ?? []).map((item) => [item.id, item]))
  const folders = [...(options.folders ?? [folderOf('fld_app', '/home/me/app')])]
  const created: { request: ChatCreateRequest; options: McpThreadOptions }[] = []
  const added: string[] = []
  const terminals: McpTerminalRequest[] = []
  const host: MdeMcpHost = {
    available: () => true,
    targetAllowed: (target) => target.kind === 'wsl',
    thread: (id) => threads.get(id),
    folders: () => folders,
    composer: () => options.composer ?? {},
    addFolder: async (_target, directory) => {
      if (directory === '/missing') throw new Error('That folder does not exist.')
      added.push(directory)
      const folder = folderOf(`fld_${added.length}`, directory)
      folders.push(folder)
      return folder
    },
    currentBranch: async () => (options.branch === undefined ? 'main' : options.branch),
    create: async (request, threadOptions) => {
      created.push({ request, options: threadOptions })
      const folder = folders.find((item) => item.id === request.folderId)!
      const made = thread(`ses_new${created.length}`, {
        directory: folder.directory,
        folderId: folder.id,
        spawnedBy: threadOptions.parentId ? { threadId: threadOptions.parentId } : {},
        ...(request.worktree ? { worktree: { repository: folder.directory, root: '/wt/1', branch: request.worktree.branch ?? 'mde/1', base: request.worktree.base } } : {}),
      })
      threads.set(made.id, made)
      return made
    },
    openTerminal: async (request) => {
      terminals.push(request)
      if (options.terminal instanceof Error) throw options.terminal
      return { command: options.terminal ?? (request.command ? 'waiting' : 'none'), directory: request.directory }
    },
    now: () => now,
  }
  const instance = new MdeMcpTools(host)
  const call = (args: Record<string, unknown>, extra: Partial<MdeMcpRequest> = {}) =>
    instance.handle({ version: 1, token: 't', target: wsl, cwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\app', tool: 'create_thread', arguments: args, ...extra })
  const openTerminal = (args: Record<string, unknown>, extra: Partial<MdeMcpRequest> = {}) => call(args, { tool: 'open_terminal', ...extra })
  return { host, created, added, terminals, call, openTerminal, folders, advance: (ms: number) => { now += ms } }
}

describe('MDE MCP open_terminal', () => {
  it('opens a pane in the calling thread\'s directory and says the command waits for approval', async () => {
    const parent = thread('ses_parent', { directory: '/home/me/app', title: 'Fix login' })
    const { openTerminal, terminals } = tools({ threads: [parent] })
    const response = await openTerminal({ command: 'npm run dev', title: 'Dev server' }, { sessionId: 'ses_parent', cwd: '/elsewhere' })
    expect(response).toMatchObject({ ok: true, data: { directory: '/home/me/app', title: 'Dev server', command: 'waiting' } })
    expect(response.ok && response.text).toContain('has not run yet')
    expect(terminals[0]).toMatchObject({ target: wsl, directory: '/home/me/app', command: 'npm run dev', title: 'Dev server', parent: { id: 'ses_parent' } })
  })

  it('says when the command is running, and titles the pane after the command', async () => {
    const { openTerminal, terminals } = tools({ terminal: 'running' })
    const response = await openTerminal({ command: '  npm test -- --watch  ' })
    expect(response).toMatchObject({ ok: true, data: { command: 'running', directory: '/home/me/app' } })
    expect(terminals[0]).toMatchObject({ command: 'npm test -- --watch', title: 'npm test -- --watch' })
    expect(response.ok && response.text).toContain('It is running `npm test -- --watch`.')
  })

  it('opens an empty shell without a command, in a named directory', async () => {
    const { openTerminal, terminals } = tools()
    const response = await openTerminal({ directory: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\lib' })
    expect(response).toMatchObject({ ok: true, data: { command: 'none', directory: '/home/me/lib', title: 'Agent terminal' } })
    expect(terminals[0]?.command).toBeNull()
  })

  it.each([
    ['two lines', { command: 'echo hi\nrm -rf ~' }],
    ['a carriage return', { command: 'echo hi\rrm -rf ~' }],
    ['an escape sequence', { command: 'echo \u001b[200~hi' }],
    ['a bidirectional override', { command: 'echo \u202egnp.exe' }],
    ['an over-long command', { command: 'x'.repeat(2001) }],
    ['a command that is not text', { command: ['ls'] }],
    ['an unknown argument', { command: 'ls', shell: 'bash' }],
    ['a relative directory', { directory: 'app' }],
    ['a directory with ..', { directory: '/home/me/../../etc' }],
    ['a directory in another distro', { directory: '\\\\wsl.localhost\\Debian\\home' }],
    ['a title with a line break', { title: 'a\nb' }],
  ])('refuses %s before anything opens', async (_name, args) => {
    const { openTerminal, terminals } = tools()
    expect(await openTerminal(args)).toMatchObject({ ok: false })
    expect(terminals).toHaveLength(0)
  })

  it('limits how many terminals agents open a minute', async () => {
    const { openTerminal, advance } = tools()
    for (let index = 0; index < MDE_MCP_TERMINALS_PER_MINUTE; index += 1) expect(await openTerminal({})).toMatchObject({ ok: true })
    expect(await openTerminal({})).toMatchObject({ ok: false, error: expect.stringContaining('at most') })
    advance(60_000)
    expect(await openTerminal({})).toMatchObject({ ok: true })
  })

  it('passes on why MDE could not open the terminal', async () => {
    const { openTerminal } = tools({ terminal: new Error('The Inbox terminal has no room for another pane.') })
    expect(await openTerminal({ command: 'ls' })).toEqual({ ok: false, error: 'The Inbox terminal has no room for another pane.' })
  })

  it('is listed with its arguments', () => {
    const tool = MDE_MCP_TOOLS.find((item) => item.name === 'open_terminal')
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual(['command', 'directory', 'title'])
  })

  it('accepts ordinary shell lines as commands', () => {
    expect(terminalCommandProblem('npm run dev -- --port 5173 && echo "ready ✓"')).toBeNull()
    expect(terminalCommandProblem('   ')).toBe('is empty')
  })
})

describe('MDE MCP tools', () => {
  it('lists the projects of the caller’s OpenCode only', async () => {
    const { host } = tools({ folders: [folderOf('fld_app', '/home/me/app'), folderOf('fld_mac', '/Users/me/x', { target: native }), folderOf('fld_wt', '/wt/1', { worktree: { repository: '/home/me/app', root: '/wt/1', branch: 'mde/1', base: 'main' } })] })
    const response = await new MdeMcpTools(host).handle({ version: 1, token: 't', target: wsl, cwd: '/', tool: 'list_projects', arguments: {} })
    expect(response).toMatchObject({ ok: true, data: { projects: [
      { name: 'app', directory: '/home/me/app' },
      { name: '1', directory: '/wt/1', worktree: { branch: 'mde/1', base: 'main' } },
    ] } })
  })

  it('starts a thread in the caller’s folder with its model, marked as the caller’s', async () => {
    const parentModel = { id: 'parent-model', providerId: 'p' }
    const { call, created } = tools({ threads: [thread('ses_parent', { model: parentModel })], composer: { agent: 'plan', model } })
    const response = await call({ prompt: 'Write the tests' }, { sessionId: 'ses_parent' })
    expect(response).toMatchObject({ ok: true, data: { threadId: 'ses_new1', directory: '/home/me/app', project: 'app' } })
    expect(created).toEqual([{ request: { folderId: 'fld_app', text: 'Write the tests', agent: 'plan', model: parentModel, mode: 'gui' }, options: { parentId: 'ses_parent' } }])
  })

  it('falls back to the bridge’s working directory and the page’s choices when the caller is not an Inbox thread', async () => {
    const { call, created } = tools({ composer: { model } })
    await call({ prompt: 'Hi', mode: 'terminal', agent: 'review', model: 'openrouter/anthropic/claude-sonnet-4' })
    expect(created[0]).toEqual({
      request: { folderId: 'fld_app', text: 'Hi', agent: 'review', model: { providerId: 'openrouter', id: 'anthropic/claude-sonnet-4' }, mode: 'terminal' },
      options: {},
    })
    await call({ prompt: 'Hi' })
    expect(created[1]?.request.agent).toBe('build')
  })

  it('adds a directory MDE does not know as a project, and reuses one it knows', async () => {
    const { call, created, added } = tools({ composer: { model } })
    await call({ prompt: 'Hi', directory: '/home/me/other/' })
    await call({ prompt: 'Hi', directory: '\\\\wsl$\\Ubuntu-24.04\\home\\me\\app' })
    expect(added).toEqual(['/home/me/other'])
    expect(created.map((item) => item.request.folderId)).toEqual(['fld_1', 'fld_app'])
    await expect(call({ prompt: 'Hi', directory: '/missing' })).rejects.toThrow('does not exist')
    for (const directory of ['relative/path', '/home/me/../etc', '\\\\wsl.localhost\\Debian\\home']) {
      expect(await call({ prompt: 'Hi', directory })).toMatchObject({ ok: false })
    }
  })

  it('cuts a worktree from the current branch unless told otherwise, never from a worktree', async () => {
    const worktreeFolder = folderOf('fld_wt', '/wt/1', { worktree: { repository: '/home/me/app', root: '/wt/1', branch: 'mde/1', base: 'main' } })
    const { call, created } = tools({ composer: { model }, folders: [folderOf('fld_app', '/home/me/app'), worktreeFolder] })
    const response = await call({ prompt: 'Hi', worktree: {} })
    expect(created[0]?.request.worktree).toEqual({ base: 'main' })
    expect(response).toMatchObject({ ok: true, data: { worktree: { branch: 'mde/1', base: 'main' } } })
    await call({ prompt: 'Hi', worktree: { base: 'origin/dev', branch: 'feature/x' } })
    expect(created[1]?.request.worktree).toEqual({ base: 'origin/dev', branch: 'feature/x' })
    expect(await call({ prompt: 'Hi', worktree: { branch: '-bad' } })).toMatchObject({ ok: false })
    expect(await call({ prompt: 'Hi', directory: '/wt/1', worktree: {} })).toMatchObject({ ok: false, error: expect.stringContaining('already a Git worktree') })
  })

  it('refuses bad arguments with a message the agent can act on', async () => {
    const { call, created } = tools({ composer: { model } })
    for (const args of [
      {}, { prompt: '   ' }, { prompt: 'x'.repeat(100_001) }, { prompt: 'a\u0000b' }, { prompt: 'Hi', extra: 1 },
      { prompt: 'Hi', mode: 'tui' }, { prompt: 'Hi', agent: '../x' }, { prompt: 'Hi', model: 'no-slash' }, { prompt: 'Hi', worktree: 'yes' },
    ]) {
      expect(await call(args)).toMatchObject({ ok: false, error: expect.any(String) })
    }
    expect(created).toEqual([])
  })

  it('needs a model from somewhere', async () => {
    const { call } = tools()
    expect(await call({ prompt: 'Hi' })).toMatchObject({ ok: false, error: expect.stringContaining('model') })
  })

  it(`stops chains of agent-started threads at ${MDE_MCP_MAX_DEPTH} levels`, async () => {
    // ses_a is a person's thread; ses_b, ses_c and ses_d are levels 1, 2 and 3.
    const chain = [
      thread('ses_a'),
      thread('ses_b', { spawnedBy: { threadId: 'ses_a' } }),
      thread('ses_c', { spawnedBy: { threadId: 'ses_b' } }),
      thread('ses_d', { spawnedBy: { threadId: 'ses_c' } }),
    ]
    const { call } = tools({ threads: chain, composer: { model } })
    expect(await call({ prompt: 'Hi' }, { sessionId: 'ses_c' })).toMatchObject({ ok: true })
    expect(await call({ prompt: 'Hi' }, { sessionId: 'ses_d' })).toMatchObject({ ok: false, error: expect.stringContaining('levels deep') })
  })

  it(`starts at most ${MDE_MCP_SPAWNS_PER_MINUTE} threads a minute`, async () => {
    const { call, advance } = tools({ composer: { model } })
    for (let index = 0; index < MDE_MCP_SPAWNS_PER_MINUTE; index += 1) expect(await call({ prompt: 'Hi' })).toMatchObject({ ok: true })
    expect(await call({ prompt: 'Hi' })).toMatchObject({ ok: false, error: expect.stringContaining('a minute') })
    advance(60_001)
    expect(await call({ prompt: 'Hi' })).toMatchObject({ ok: true })
  })

  it('refuses where the Inbox is unavailable, for another OpenCode, and for unknown tools', async () => {
    const { host, call } = tools({ composer: { model } })
    expect(await call({ prompt: 'Hi' }, { target: native })).toMatchObject({ ok: false })
    expect(await call({}, { tool: 'delete_everything' })).toMatchObject({ ok: false, error: expect.stringContaining('Unknown tool') })
    expect(await new MdeMcpTools({ ...host, available: () => false }).handle({ version: 1, token: 't', target: wsl, cwd: '/', tool: 'list_projects', arguments: {} }))
      .toMatchObject({ ok: false, error: expect.stringContaining('not available') })
  })

  it('reads the bridge’s working directory in the target’s own format', () => {
    expect(callerDirectory(wsl, '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\app')).toBe('/home/me/app')
    expect(callerDirectory(wsl, '\\\\wsl.localhost\\Debian\\home')).toBeNull()
    expect(callerDirectory(wsl, 'C:\\Windows\\System32')).toBeNull()
    expect(callerDirectory(native, '/Users/me/app')).toBe('/Users/me/app')
    expect(parseModelArgument('anthropic/claude')).toEqual({ providerId: 'anthropic', id: 'claude' })
  })
})

describe('MDE MCP in OpenCode’s configuration', () => {
  const command = ['/Applications/mde.app/Contents/MacOS/mde', '--mcp-bridge', '--mcp-target=native']

  it('adds only its own entry, keeping comments and other servers as they were', () => {
    const text = [
      '{',
      '  // my model',
      '  "model": "llama.cpp/qwen",',
      '  "mcp": {',
      '    "servers": {',
      '      "demo": { "type": "local", "command": ["node", "demo.mjs"] }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    expect(readMdeMcpState(text, command)).toEqual({ state: 'missing', parseError: null })
    const installed = installMdeMcp(text, command)
    expect(installed.startsWith('{\n  // my model\n  "model": "llama.cpp/qwen",\n  "mcp": {\n    "servers": {\n      "demo": { "type": "local", "command": ["node", "demo.mjs"] }')).toBe(true)
    expect(readMdeMcpState(installed, command)).toEqual({ state: 'installed', parseError: null })
    expect(readMdeMcpState(installed, ['/other/mde', '--mcp-bridge'])).toEqual({ state: 'outdated', parseError: null })
    // Removing puts the file back as it was.
    expect(removeMdeMcp(installed)).toBe(text)
  })

  it('starts a new file, and removes the objects it made when nothing else is in them', () => {
    const installed = installMdeMcp('', command)
    expect(JSON.parse(installed)).toEqual({ $schema: 'https://opencode.ai/config.json', mcp: { servers: { mde: { type: 'local', command } } } })
    expect(JSON.parse(removeMdeMcp(installed))).toEqual({ $schema: 'https://opencode.ai/config.json' })
    const updated = installMdeMcp(installMdeMcp('{}', ['/old/mde']), command)
    expect(JSON.parse(updated)).toEqual({ mcp: { servers: { mde: { type: 'local', command } } } })
  })

  it('reports a file it cannot parse', () => {
    expect(readMdeMcpState('{ "mcp": ', command).parseError).toBeTruthy()
  })
})
