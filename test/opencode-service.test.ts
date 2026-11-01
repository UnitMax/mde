import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatPart } from '../src/shared/types'
import {
  OpenCodeServiceClient,
  OpenCodeServiceError,
  SERVICE_UNREACHABLE,
  serviceUrl,
} from '../src/main/opencode/service/client'
import {
  parseServiceState,
  serviceDiscoveryLaunch,
  serviceTargetKey,
  type OpenCodeServiceEndpoint,
} from '../src/main/opencode/service/discovery'
import {
  parseServiceEvent,
  serviceEventSessionId,
  ServiceEventStreams,
  SseParser,
  type ServiceEvent,
} from '../src/main/opencode/service/events'
import {
  CHAT_TOOL_TEXT_LIMIT,
  parseActiveSessions,
  parseAgents,
  parseCreatedSession,
  parseDefaultModel,
  parseForms,
  parseMessage,
  parseMessagesPage,
  parseModels,
  parsePermissions,
  parseProviderNames,
  parseSessionUsage,
  parseTokens,
} from '../src/main/opencode/service/parse'

const fixtures = join(__dirname, 'fixtures/opencode-chat')
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8')
const wsl = { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function authorized(request: IncomingMessage, password: string): boolean {
  return request.headers.authorization === `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
}

describe('OpenCode service discovery', () => {
  it('starts the service and prints its state file through the login shell', () => {
    const { spec, begin, end } = serviceDiscoveryLaunch(wsl, 'opencode', 'test', {
      file: 'D:\\Windows\\System32\\wsl.exe', cwd: 'D:\\Windows\\System32',
    })
    expect(spec.args).toEqual(expect.arrayContaining(['-d', 'Ubuntu-24.04', '/bin/sh', '-c']))
    const script = spec.args.find((arg) => arg.includes('mde_executable=$1'))!
    expect(script).toContain('service start')
    expect(script).toContain('${XDG_STATE_HOME:-$HOME/.local/state}/opencode/service.json')
    // The executable and markers are separate arguments, never spliced into the script.
    expect(spec.args.slice(-3)).toEqual(['opencode', begin, end])
    expect(() => serviceDiscoveryLaunch(wsl, 'open\ncode', 'test')).toThrow('Invalid OpenCode executable.')
  })

  it('accepts only a loopback HTTP origin and a printable password', () => {
    expect(parseServiceState({ url: 'http://127.0.0.1:49374', password: 'secret', pid: 4 }))
      .toEqual({ url: 'http://127.0.0.1:49374', password: 'secret' })
    expect(parseServiceState({ url: 'http://localhost:1/', password: 'x' }).url).toBe('http://localhost:1')
    for (const url of ['https://127.0.0.1:1', 'http://example.com:1', 'http://127.0.0.1', 'http://u:p@127.0.0.1:1',
      'http://127.0.0.1:1/api', 'http://10.0.0.2:1', 'not a url']) {
      expect(() => parseServiceState({ url, password: 'secret' })).toThrow()
    }
    for (const password of ['', 'has space', 'x'.repeat(257), 'tab\t']) {
      expect(() => parseServiceState({ url: 'http://127.0.0.1:1', password })).toThrow()
    }
    expect(() => parseServiceState(null)).toThrow()
  })

  it('keys services by target', () => {
    expect(serviceTargetKey({ kind: 'native' })).toBe('native')
    expect(serviceTargetKey(wsl)).toBe('wsl:Ubuntu-24.04')
  })
})

describe('OpenCode service client', () => {
  it('sends native title regeneration as an authenticated PATCH and accepts no content', async () => {
    const bodies: unknown[] = []
    const url = await serve((request, response) => {
      expect(authorized(request, 'p')).toBe(true)
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        bodies.push({ method: request.method, url: request.url, body: JSON.parse(body) })
        response.writeHead(204).end()
      })
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    await expect(client.request(wsl, 'session.update', {
      params: { sessionID: 'ses_one' }, body: { title: '' },
    })).resolves.toBeNull()
    expect(bodies).toEqual([{ method: 'PATCH', url: '/api/session/ses_one', body: { title: '' } }])
  })
  it('builds URLs only from the fixed operation table and checked parameters', () => {
    expect(serviceUrl('http://127.0.0.1:1', 'session.permission.reply', { params: { sessionID: 'ses_a', requestID: 'per_b' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/permission/per_b/reply')
    expect(serviceUrl('http://127.0.0.1:1', 'model.list', { query: { 'location[directory]': '/home/me/my app' } }))
      .toBe('http://127.0.0.1:1/api/model?location%5Bdirectory%5D=%2Fhome%2Fme%2Fmy+app')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.get', { params: { sessionID: '../x' } })).toThrow('Invalid OpenCode sessionID.')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.get', { params: { sessionID: 'ses_a', formID: 'frm_b' } })).toThrow()
    expect(() => serviceUrl('http://127.0.0.1:1', 'model.list', { query: { evil: '1' } })).toThrow()
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.delete' as never)).toThrow('Unsupported')
  })

  it('sends Basic auth and JSON, and rediscovers once after a refused password', async () => {
    let password = 'old'
    const bodies: unknown[] = []
    const url = await serve((request, response) => {
      if (!authorized(request, 'new')) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"_tag":"UnauthorizedError","message":"Authentication required"}')
        return
      }
      let text = ''
      request.on('data', (chunk) => { text += chunk })
      request.on('end', () => {
        bodies.push({ method: request.method, url: request.url, type: request.headers['content-type'], body: JSON.parse(text) })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"id":"ses_new"}}')
      })
    })
    const discover = vi.fn(async (): Promise<OpenCodeServiceEndpoint> => {
      const endpoint = { url, password }
      password = 'new'
      return endpoint
    })
    const client = new OpenCodeServiceClient({ discover, executable: () => 'opencode' })
    await expect(client.request(wsl, 'session.create', { body: { agent: 'build' } })).resolves.toEqual({ data: { id: 'ses_new' } })
    expect(discover).toHaveBeenCalledTimes(2)
    expect(discover).toHaveBeenCalledWith(wsl, 'opencode')
    expect(bodies).toEqual([{ method: 'POST', url: '/api/session', type: 'application/json', body: { agent: 'build' } }])
    // The endpoint is cached after that.
    await client.request(wsl, 'session.create', { body: {} })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('reports service errors with their message and gives up after one retry', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"_tag":"SessionNotFoundError","message":"Session not found"}')
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    const error = await client.request(wsl, 'session.get', { params: { sessionID: 'ses_x' } }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OpenCodeServiceError)
    expect(error).toMatchObject({ message: 'Session not found', status: 404, tag: 'SessionNotFoundError' })
  })

  it('explains an unreachable service and rejects oversized answers', async () => {
    const closed = await serve(() => {})
    servers.pop()!.close()
    const unreachable = new OpenCodeServiceClient({ discover: async () => ({ url: closed, password: 'p' }), executable: () => 'opencode' })
    await expect(unreachable.request(wsl, 'agent.list')).rejects.toThrow(SERVICE_UNREACHABLE)

    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(`{"data":"${'x'.repeat(2000)}"}`)
    })
    const small = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode', maxResponseBytes: 1000 })
    await expect(small.request(wsl, 'agent.list')).rejects.toThrow('more data than MDE accepts')
  })

  it('times out a silent service', async () => {
    const url = await serve(() => {})
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode', timeoutMs: 50 })
    await expect(client.request(wsl, 'agent.list')).rejects.toThrow('did not answer in time')
  })

  it('does not cache a failed discovery', async () => {
    const discover = vi.fn()
      .mockRejectedValueOnce(new Error('not installed'))
      .mockResolvedValue({ url: await serve((_q, r) => r.end('{"data":[]}')), password: 'p' })
    const client = new OpenCodeServiceClient({ discover, executable: () => 'opencode' })
    await expect(client.request(wsl, 'agent.list')).rejects.toThrow('not installed')
    await expect(client.request(wsl, 'agent.list')).resolves.toEqual({ data: [] })
  })
})

describe('OpenCode service events', () => {
  it('decodes server-sent events split across chunks and skips heartbeats', () => {
    const parser = new SseParser()
    expect(parser.push('data: {"type":"a","da')).toEqual([])
    expect(parser.push('ta":{}}\n\n: heartbeat\n\r\ndata: {"type":"b",\r\ndata: "data":{}}\r\n\r\n')).toEqual([
      '{"type":"a","data":{}}',
      '{"type":"b",\n"data":{}}',
    ])
  })

  it('validates events and finds their session wherever it is kept', () => {
    expect(parseServiceEvent('nope')).toBeNull()
    expect(parseServiceEvent('{"type":"BAD TYPE","data":{}}')).toBeNull()
    expect(parseServiceEvent('{"type":"x.y","data":[]}')).toBeNull()
    const lines = fixture('question.jsonl').trim().split('\n').map(parseServiceEvent)
    expect(lines.every(Boolean)).toBe(true)
    const created = lines.find((event) => event?.type === 'form.created')!
    expect(serviceEventSessionId(created)).toMatch(/^ses_/)
    expect(serviceEventSessionId({ type: 'x', data: {} })).toBeNull()
  })

  it('streams events, reconnects after a drop, and stops after repeated failures', async () => {
    let connections = 0
    const url = await serve((request, response) => {
      connections += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"type":"server.connected","data":{}}\n\n')
      response.write(`data: {"type":"session.execution.started","data":{"sessionID":"ses_${connections}"}}\n\n`)
      // The first stream drops; the second stays open.
      if (connections === 1) response.end()
      request.on('close', () => response.end())
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    const events: ServiceEvent[] = []
    const connected: boolean[] = []
    const streams = new ServiceEventStreams(client, {
      onEvent: (_target, event) => events.push(event),
      onConnected: (_target, reconnected) => connected.push(reconnected),
      backoffMs: () => 5,
    })
    streams.ensure(wsl)
    streams.ensure(wsl)
    await vi.waitFor(() => expect(events.map((event) => event.data.sessionID)).toEqual(['ses_1', 'ses_2']))
    expect(connected).toEqual([false, true])
    expect(streams.isOpen(wsl)).toBe(true)
    streams.stop(wsl)
    expect(streams.isOpen(wsl)).toBe(false)

    const failing = new ServiceEventStreams({ openEvents: async () => { throw new Error('down') } }, {
      onEvent: () => {}, backoffMs: () => 1, maxFailures: 3,
    })
    failing.ensure(wsl)
    await vi.waitFor(() => expect(failing.isOpen(wsl)).toBe(false))
  })
})

describe('OpenCode service parsing', () => {
  it('keeps only selectable agents', () => {
    const agents = parseAgents({ data: [
      { id: 'build', name: 'Build', mode: 'primary', hidden: false },
      { id: 'general', name: 'General', mode: 'subagent', hidden: false },
      { id: 'title', name: 'Title', mode: 'primary', hidden: true },
      { id: 'plan', name: 'Plan', mode: 'primary', hidden: false, description: 'Read-only planning', color: '#ff0000' },
      { id: 'review', mode: 'all' },
      { id: 'build', name: 'Duplicate', mode: 'primary' },
    ] })
    expect(agents).toEqual([
      { id: 'build', name: 'Build' },
      { id: 'plan', name: 'Plan', description: 'Read-only planning', color: '#ff0000' },
      { id: 'review', name: 'review' },
    ])
    expect(() => parseAgents({ nope: true })).toThrow('MDE does not understand')
  })

  it('reduces the model list to enabled models with provider names', () => {
    const providers = parseProviderNames({ data: [{ id: 'opencode', name: 'OpenCode' }, { id: 'bad id\u0007' }] })
    const models = parseModels({ data: [
      { id: 'free-1', providerID: 'opencode', name: 'Free 1', enabled: true, status: 'active', cost: [], variants: [] },
      { id: 'old', providerID: 'opencode', name: 'Old', enabled: true, status: 'deprecated' },
      { id: 'off', providerID: 'opencode', name: 'Off', enabled: false },
      { id: 'vendor/model', providerID: 'router', name: 'Model' },
    ] }, providers)
    expect(models).toEqual([
      { id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Free 1' },
      { id: 'vendor/model', providerId: 'router', providerName: 'router', name: 'Model' },
    ])
    expect(parseDefaultModel({ data: { id: 'free-1', providerID: 'opencode', name: 'x' } })).toEqual({ id: 'free-1', providerId: 'opencode' })
    expect(parseDefaultModel({ data: null })).toBeNull()
  })

  it('keeps a model\'s context window and reply limit when they are plausible', () => {
    const models = parseModels({ data: [
      { id: 'big', providerID: 'p', name: 'Big', limit: { context: 1_048_576, output: 65_536.9 } },
      { id: 'odd', providerID: 'p', name: 'Odd', limit: { context: -5, output: 'many' } },
      { id: 'zero', providerID: 'p', name: 'Zero', limit: { context: 0, output: 0 } },
      { id: 'none', providerID: 'p', name: 'None' },
    ] }, new Map())
    expect(models.map(({ id, contextLimit, outputLimit }) => ({ id, contextLimit, outputLimit }))).toEqual([
      { id: 'big', contextLimit: 1_048_576, outputLimit: 65_536 },
      { id: 'odd', contextLimit: undefined, outputLimit: undefined },
      { id: 'zero', contextLimit: undefined, outputLimit: undefined },
      { id: 'none', contextLimit: undefined, outputLimit: undefined },
    ])
    expect(models[1]).not.toHaveProperty('contextLimit')
  })

  it('reads token counts, treating missing or invalid ones as 0', () => {
    expect(parseTokens({ input: 246, output: 13, reasoning: 5, cache: { read: 7808, write: 12 } }))
      .toEqual({ input: 246, output: 13, reasoning: 5, cacheRead: 7808, cacheWrite: 12 })
    expect(parseTokens({ input: 10, output: NaN, cache: { read: -1 } }))
      .toEqual({ input: 10, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    expect(parseTokens(null)).toBeUndefined()
    expect(parseTokens([])).toBeUndefined()
    expect(parseTokens('lots')).toBeUndefined()

    const raw = JSON.parse(fixture('messages-tools.json'))
    const steps = parseMessagesPage(raw, false, raw.data.length).messages.filter((message) => message.kind === 'assistant')
    expect(steps.map((step) => step.kind === 'assistant' && step.tokens)).toEqual([
      { input: 3551, output: 83, reasoning: 0, cacheRead: 4224, cacheWrite: 0 },
      { input: 251, output: 105, reasoning: 0, cacheRead: 7680, cacheWrite: 0 },
      { input: 246, output: 13, reasoning: 0, cacheRead: 7808, cacheWrite: 0 },
    ])
    expect(parseMessage({ id: 'msg_1', type: 'assistant', model: { id: 'm', providerID: 'p' }, time: { created: 1 }, content: [] }))
      .not.toHaveProperty('tokens')
  })

  it('reads the thread totals from a session answer', () => {
    expect(parseSessionUsage({ data: { id: 'ses_1', cost: 1.25, tokens: { input: 5, output: 4, reasoning: 3, cache: { read: 2, write: 1 } } } }))
      .toEqual({ cost: 1.25, tokens: { input: 5, output: 4, reasoning: 3, cacheRead: 2, cacheWrite: 1 } })
    expect(parseSessionUsage({ data: { tokens: { input: 5 }, cost: 'free' } })?.cost).toBe(0)
    expect(parseSessionUsage({ data: { id: 'ses_1' } })).toBeNull()
    expect(parseSessionUsage(null)).toBeNull()
    expect(parseSessionUsage({ nope: true })).toBeNull()
  })

  it('maps a recorded conversation oldest first, with tools and their output', () => {
    const raw = JSON.parse(fixture('messages-tools.json'))
    const page = parseMessagesPage(raw, false, raw.data.length)
    expect(page.running).toBe(false)
    expect(page.older).toMatch(/^[A-Za-z0-9_=.-]+$/)
    // OpenCode returns a cursor on the last page too; a short page has nothing older.
    expect(parseMessagesPage(raw, false, raw.data.length + 1).older).toBeNull()
    expect(page.messages.map((message) => message.kind)).toEqual(['user', 'assistant', 'assistant', 'assistant'])
    const [user, read, write, answer] = page.messages
    expect(user).toMatchObject({ kind: 'user', text: expect.stringContaining('Read note.txt') })
    expect(read).toMatchObject({
      kind: 'assistant', agent: 'build', completed: true,
      model: { id: 'deepseek-v4.1-flash-free', providerId: 'opencode' },
      parts: [{ kind: 'tool', name: 'read', status: 'completed', output: expect.stringContaining('hello from spike') }],
    })
    expect(write?.kind === 'assistant' && write.parts[0]?.kind === 'tool' && JSON.parse(write.parts[0].input))
      .toEqual({ path: '/home/me/app/copy.txt', content: 'HELLO FROM SPIKE\n' })
    expect(answer).toMatchObject({ parts: [{ kind: 'text', text: 'Created copy.txt with "HELLO FROM SPIKE".' }] })
  })

  it('maps a rejected tool, reasoning, and notes', () => {
    const page = parseMessagesPage(JSON.parse(fixture('messages-permission.json')), true, 50)
    expect(page.running).toBe(true)
    const parts = page.messages.flatMap((message) => message.kind === 'assistant' ? message.parts : [])
    expect(parts).toContainEqual(expect.objectContaining({ kind: 'tool', status: 'error', error: 'Not now' }))
    expect(parts).toContainEqual(expect.objectContaining({ kind: 'reasoning', text: expect.stringContaining('rejected') }))
    expect(parseMessage({ id: 'msg_1', type: 'agent-switched', agent: 'plan', time: { created: 1 } }))
      .toEqual({ kind: 'note', id: 'msg_1', time: 1, tone: 'info', text: 'Switched to the plan agent' })
    expect(parseMessage({ id: 'msg_2', type: 'idle', outcome: 'failed', error: { type: 'x', message: 'Rate limited' }, time: { created: 2 } }))
      .toMatchObject({ tone: 'error', text: 'Rate limited' })
    expect(parseMessage({ id: 'msg_3', type: 'idle', outcome: 'succeeded', time: { created: 3 } })).toBeNull()
    expect(parseMessage({ id: 'msg_4', type: 'future-type', time: { created: 4 } })).toBeNull()
  })

  it('truncates huge tool output and strips control characters', () => {
    const message = parseMessage({
      id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1 },
      content: [{ type: 'tool', id: 'call_1', name: 'shell', time: { created: 1 },
        state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: `\u001b[31m${'y'.repeat(CHAT_TOOL_TEXT_LIMIT + 10)}` }] } }],
    })
    const tool = message?.kind === 'assistant' ? message.parts[0] : null
    expect(tool).toMatchObject({ kind: 'tool', truncated: true })
    expect(tool?.kind === 'tool' && tool.output?.length).toBe(CHAT_TOOL_TEXT_LIMIT)
    expect(tool?.kind === 'tool' && tool.output?.includes('\u001b')).toBe(false)
  })

  describe('file changes', () => {
    const patch = [
      'Index: /home/me/app/src/a.ts', '='.repeat(67), '--- /home/me/app/src/a.ts', '+++ /home/me/app/src/a.ts',
      '@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' const c = 4', '',
    ].join('\n')
    const edit = (state: Record<string, unknown>) => parseMessage({
      id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1 },
      content: [{ type: 'tool', id: 'call_1', name: 'edit', time: { created: 1 }, state: { input: { filePath: '/home/me/app/src/a.ts' }, ...state } }],
    })
    const tool = (message: ReturnType<typeof edit>) => (message?.kind === 'assistant' ? message.parts[0] : null) as
      Extract<ChatPart, { kind: 'tool' }> | null

    it('reads the diff of a finished edit from either shape OpenCode has used', () => {
      const single = tool(edit({ status: 'completed', content: [], metadata: { diff: patch, filediff: { file: '/home/me/app/src/a.ts', patch, additions: 1, deletions: 1 } } }))
      expect(single?.patches).toEqual([{ path: '/home/me/app/src/a.ts', patch }])
      const several = tool(edit({ status: 'completed', content: [], metadata: { files: [
        { file: 'src/a.ts', patch, status: 'modified' }, { file: 'src/b.ts', patch, status: 'added' }, { file: 'src/empty.ts', patch: '  ' }, { patch },
      ] } }))
      expect(several?.patches?.map((entry) => entry.path)).toEqual(['src/a.ts', 'src/b.ts'])
      expect(several).not.toHaveProperty('truncated')
    })

    it('shows no diff for an edit that has not finished or failed', () => {
      const metadata = { filediff: { file: 'src/a.ts', patch } }
      expect(tool(edit({ status: 'running', metadata }))).not.toHaveProperty('patches')
      expect(tool(edit({ status: 'error', error: { message: 'No match' }, metadata }))).not.toHaveProperty('patches')
      expect(tool(edit({ status: 'completed', content: [] }))).not.toHaveProperty('patches')
      expect(tool(edit({ status: 'completed', content: [], metadata: { filediff: 'nope', files: 'nope' } }))).not.toHaveProperty('patches')
    })

    it('cuts one huge diff, and caps how many files and how much text a call carries', () => {
      const huge = tool(edit({ status: 'completed', metadata: { filediff: { file: 'src/a.ts', patch: `@@ -1 +1 @@\n+${'x'.repeat(CHAT_TOOL_TEXT_LIMIT)}` } } }))
      expect(huge?.patches?.[0]?.patch).toHaveLength(CHAT_TOOL_TEXT_LIMIT)
      expect(huge?.truncated).toBe(true)

      const many = tool(edit({ status: 'completed', metadata: { files: Array.from({ length: 30 }, (_, index) => ({ file: `src/${index}.ts`, patch })) } }))
      expect(many?.patches).toHaveLength(20)
      expect(many?.truncated).toBe(true)

      const big = 'y'.repeat(CHAT_TOOL_TEXT_LIMIT - 20)
      const total = tool(edit({ status: 'completed', metadata: { files: Array.from({ length: 8 }, (_, index) => ({ file: `src/${index}.ts`, patch: big })) } }))
      expect(total?.patches?.reduce((sum, entry) => sum + entry.patch.length, 0)).toBeLessThanOrEqual(256 * 1024)
      expect(total?.truncated).toBe(true)
    })

    it('remembers whether a written file was already there', () => {
      const write = (state: Record<string, unknown>) => tool(parseMessage({
        id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1 },
        content: [{ type: 'tool', id: 'call_1', name: 'write', time: { created: 1 }, state: { input: { filePath: 'a.md', content: 'Hi' }, ...state } }],
      }))
      expect(write({ status: 'completed', metadata: { exists: true } })?.existed).toBe(true)
      expect(write({ status: 'completed', metadata: { exists: false } })?.existed).toBe(false)
      expect(write({ status: 'completed', metadata: { truncated: false } })).not.toHaveProperty('existed')
      expect(write({ status: 'running', metadata: { exists: true } })).not.toHaveProperty('existed')
    })
  })

  it('maps permission requests and question forms', () => {
    expect(parsePermissions({ data: [
      { id: 'per_1', sessionID: 'ses_1', action: 'read', resources: ['.env'], save: ['*'] },
      { id: 'bad', action: 'read', resources: [] },
    ] })).toEqual([{ id: 'per_1', action: 'read', resources: ['.env'] }])

    const question = fixture('question.jsonl').trim().split('\n').map(parseServiceEvent)
      .find((event) => event?.type === 'form.created')!
    const [form] = parseForms({ data: [question.data.form] })
    expect(form).toEqual({
      id: expect.stringMatching(/^frm_/),
      title: 'Questions',
      unsupported: false,
      fields: [{
        key: 'q0', type: 'string', title: 'Beverage', description: 'Would you like tea or coffee?', required: false, custom: true,
        options: [
          { value: 'Tea', label: 'Tea', description: 'A nice cup of tea' },
          { value: 'Coffee', label: 'Coffee', description: 'A cup of coffee' },
        ],
      }],
    })
    const [external] = parseForms({ data: [{ id: 'frm_2', title: 'Sign in', fields: [{ key: 'k', type: 'external', url: 'x' }] }] })
    expect(external?.unsupported).toBe(true)
  })

  it('reads new sessions and active sessions', () => {
    expect(parseCreatedSession({ data: { id: 'ses_1', title: 'New' } })).toEqual({ id: 'ses_1', title: 'New' })
    expect(() => parseCreatedSession({ data: { id: '../x' } })).toThrow()
    expect([...parseActiveSessions({ data: { ses_1: { type: 'running' }, ses_2: { type: 'idle' }, bad: { type: 'running' } } })])
      .toEqual(['ses_1'])
  })
})
