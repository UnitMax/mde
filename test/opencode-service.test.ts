import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatPart } from '../src/shared/types'
import { turnStats } from '../src/renderer/lib/chat'
import {
  OpenCodeServiceClient,
  OpenCodeServiceError,
  SERVICE_OPERATIONS,
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
  holdsCompaction,
  parseInboxItem,
  parseMessage,
  parseMessagesPage,
  parseModels,
  parsePendingMessages,
  parsePermissions,
  parseProviderNames,
  parsePromptAnswer,
  parseSessionRevert,
  parseSessionUsage,
  parseStagedRevert,
  parseTurnMarkers,
  unfinishedTurnStart,
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
  it('sends a redo as an authenticated DELETE with no body, and accepts no content', async () => {
    const seen: unknown[] = []
    const url = await serve((request, response) => {
      expect(authorized(request, 'p')).toBe(true)
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        seen.push({ method: request.method, url: request.url, body, contentType: request.headers['content-type'] })
        response.writeHead(204).end()
      })
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    await expect(client.request(wsl, 'session.revert.clear', { params: { sessionID: 'ses_one' } })).resolves.toBeNull()
    expect(seen).toEqual([{ method: 'DELETE', url: '/api/session/ses_one/revert', body: '', contentType: undefined }])
  })

  it('sends a revert stage as an authenticated POST with a fixed JSON body', async () => {
    const seen: unknown[] = []
    const url = await serve((request, response) => {
      expect(authorized(request, 'p')).toBe(true)
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        seen.push({ method: request.method, url: request.url, body: JSON.parse(body) })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"messageID":"msg_3","files":[]}}')
      })
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    await expect(client.request(wsl, 'session.revert.stage', { params: { sessionID: 'ses_one' }, body: { messageID: 'msg_3', files: false } }))
      .resolves.toEqual({ data: { messageID: 'msg_3', files: [] } })
    expect(seen).toEqual([{ method: 'POST', url: '/api/session/ses_one/revert/stage', body: { messageID: 'msg_3', files: false } }])
    expect(serviceUrl('http://127.0.0.1:1', 'session.revert.stage', { params: { sessionID: 'ses_a' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/revert/stage')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.revert.stage', { params: { sessionID: 'ses_a', messageID: 'msg_1' } })).toThrow()
  })

  it('forks through a fixed route that carries only the message to cut before', async () => {
    const seen: { method?: string; url?: string; body: unknown }[] = []
    const url = await serve((request, response) => {
      expect(authorized(request, 'p')).toBe(true)
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        seen.push({ method: request.method, url: request.url, body: JSON.parse(body) })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"id":"ses_fork"}}')
      })
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode' })
    await client.request(wsl, 'session.fork', { params: { sessionID: 'ses_one' }, body: { before: null } })
    await client.request(wsl, 'session.fork', { params: { sessionID: 'ses_one' }, body: { before: 'msg_3' } })
    expect(seen).toEqual([
      { method: 'POST', url: '/api/session/ses_one/fork', body: { before: null } },
      { method: 'POST', url: '/api/session/ses_one/fork', body: { before: 'msg_3' } },
    ])
    expect(serviceUrl('http://127.0.0.1:1', 'session.fork', { params: { sessionID: 'ses_a' } })).toBe('http://127.0.0.1:1/api/session/ses_a/fork')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.fork', { params: { sessionID: '../x' } })).toThrow('Invalid OpenCode sessionID.')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.fork', { params: { sessionID: 'ses_a', messageID: 'msg_1' } })).toThrow()
  })

  it('reduces a message list to where turns begin and end, newest first', () => {
    const page = {
      data: [
        { id: 'msg_9', type: 'idle', outcome: 'succeeded' },
        { id: 'msg_8', type: 'assistant', content: [] },
        { id: 'msg_7', type: 'user', text: 'Second request' },
        { id: 'msg_6', type: 'synthetic', text: 'Context' },
        { id: 'bad id', type: 'user', text: 'Skipped' },
        { id: 'msg_5', type: 'user', text: 'x\u0000y' },
      ],
      cursor: { next: 'cursor-2' },
    }
    expect(parseTurnMarkers(page)).toEqual({
      markers: [
        { id: 'msg_9', kind: 'idle' },
        { id: 'msg_8', kind: 'other' },
        { id: 'msg_7', kind: 'user', text: 'Second request' },
        { id: 'msg_6', kind: 'other' },
        { id: 'msg_5', kind: 'user', text: 'xy' },
      ],
      next: 'cursor-2',
      count: 6,
    })
    expect(parseTurnMarkers({ data: [], cursor: { next: '../no' } })).toEqual({ markers: [], next: null, count: 0 })
    expect(() => parseTurnMarkers({})).toThrow()
    expect(() => parseTurnMarkers(null)).toThrow()
  })

  it('finds the user message the current turn began with', () => {
    const user = (id: string, text = id) => ({ id, kind: 'user' as const, text })
    const other = (id: string) => ({ id, kind: 'other' as const })
    const idle = (id: string) => ({ id, kind: 'idle' as const })
    // Newest first: a turn in progress after a finished one.
    expect(unfinishedTurnStart([other('m6'), user('m5'), idle('m4'), other('m3'), user('m2')])).toMatchObject({ id: 'm5' })
    // Two messages sent while the agent worked belong to the same turn, which began with the older.
    expect(unfinishedTurnStart([user('m7'), other('m6'), user('m5'), idle('m4'), user('m3')])).toMatchObject({ id: 'm5' })
    // The first turn has no idle before it.
    expect(unfinishedTurnStart([other('m3'), other('m2'), user('m1')])).toMatchObject({ id: 'm1' })
    // Nothing started it: the last thing written was the agent stopping, or a run the service resumed.
    expect(unfinishedTurnStart([idle('m3'), other('m2'), user('m1')])).toBeNull()
    expect(unfinishedTurnStart([other('m2'), other('m1')])).toBeNull()
    expect(unfinishedTurnStart([])).toBeNull()
  })

  it('keeps the revert route tied to a session ID', () => {
    expect(serviceUrl('http://127.0.0.1:1', 'session.revert.clear', { params: { sessionID: 'ses_a' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/revert')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.revert.clear', { params: { sessionID: '../x' } })).toThrow('Invalid OpenCode sessionID.')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.revert.clear', { params: { sessionID: 'ses_a', messageID: 'msg_1' } })).toThrow()
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.revert.clear')).toThrow('Invalid OpenCode sessionID.')
  })

  it('keeps the routes for held messages tied to checked session and message IDs', () => {
    expect(serviceUrl('http://127.0.0.1:1', 'session.inbox.list', { params: { sessionID: 'ses_a' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/inbox')
    expect(serviceUrl('http://127.0.0.1:1', 'session.inbox.cancel', { params: { sessionID: 'ses_a', inboxID: 'msg_1a3f33' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/inbox/msg_1a3f33')
    expect(SERVICE_OPERATIONS['session.inbox.list'].method).toBe('GET')
    expect(SERVICE_OPERATIONS['session.inbox.cancel'].method).toBe('DELETE')
    // Switching how a held message is delivered is the same path with another method.
    expect(SERVICE_OPERATIONS['session.inbox.update']).toEqual({ method: 'PATCH', path: SERVICE_OPERATIONS['session.inbox.cancel'].path })
    expect(serviceUrl('http://127.0.0.1:1', 'session.inbox.update', { params: { sessionID: 'ses_a', inboxID: 'msg_1a3f33' } }))
      .toBe('http://127.0.0.1:1/api/session/ses_a/inbox/msg_1a3f33')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.inbox.update', { params: { sessionID: 'ses_a', inboxID: '../x' } })).toThrow('Invalid OpenCode inboxID.')
    for (const inboxID of ['../x', 'ses_a', 'msg_', 'msg_a/b', 'msg_a?b', '']) {
      expect(() => serviceUrl('http://127.0.0.1:1', 'session.inbox.cancel', { params: { sessionID: 'ses_a', inboxID } })).toThrow('Invalid OpenCode inboxID.')
    }
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.inbox.cancel', { params: { sessionID: 'ses_a' } })).toThrow('Invalid OpenCode inboxID.')
    // The list takes no message ID.
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.inbox.list', { params: { sessionID: 'ses_a', inboxID: 'msg_1' } })).toThrow()
  })

  it('reaches the side-question route only with a checked session ID', () => {
    expect(SERVICE_OPERATIONS['session.generate']).toEqual({ method: 'POST', path: '/api/session/{sessionID}/generate' })
    expect(serviceUrl('http://127.0.0.1:1', 'session.generate', { params: { sessionID: 'ses_a' } })).toBe('http://127.0.0.1:1/api/session/ses_a/generate')
    for (const sessionID of ['../x', 'msg_1', 'ses_', 'ses_a/b', '']) {
      expect(() => serviceUrl('http://127.0.0.1:1', 'session.generate', { params: { sessionID } })).toThrow('Invalid OpenCode sessionID.')
    }
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.generate', { params: { sessionID: 'ses_a', inboxID: 'msg_1' } })).toThrow()
  })

  it('reaches the MCP routes only with a checked, encoded server name', () => {
    const origin = 'http://127.0.0.1:1'
    expect(SERVICE_OPERATIONS['mcp.list']).toEqual({ method: 'GET', path: '/api/mcp' })
    expect(serviceUrl(origin, 'mcp.list', { query: { 'location[directory]': '/home/me/app' } }))
      .toBe(`${origin}/api/mcp?location%5Bdirectory%5D=%2Fhome%2Fme%2Fapp`)
    expect(SERVICE_OPERATIONS['mcp.connect'].method).toBe('POST')
    expect(SERVICE_OPERATIONS['mcp.disconnect'].method).toBe('POST')
    expect(serviceUrl(origin, 'mcp.connect', { params: { server: 'demo_math' } })).toBe(`${origin}/api/experimental/mcp/demo_math/connect`)
    expect(serviceUrl(origin, 'mcp.disconnect', { params: { server: 'demo_math' } })).toBe(`${origin}/api/experimental/mcp/demo_math/disconnect`)
    // A name may hold anything a path step can not, so it is encoded and stays one step.
    expect(serviceUrl(origin, 'mcp.connect', { params: { server: 'context 7' } })).toBe(`${origin}/api/experimental/mcp/context%207/connect`)
    expect(serviceUrl(origin, 'mcp.connect', { params: { server: 'a/b?c#d%2e' } })).toBe(`${origin}/api/experimental/mcp/a%2Fb%3Fc%23d%252e/connect`)
    expect(serviceUrl(origin, 'mcp.connect', { params: { server: 'v1.2' } })).toBe(`${origin}/api/experimental/mcp/v1.2/connect`)
    // Dot steps would be resolved by the URL parser and leave the route.
    for (const server of ['.', '..', '...', '', 'x'.repeat(201), 'a\nb']) {
      expect(() => serviceUrl(origin, 'mcp.connect', { params: { server } })).toThrow('Invalid OpenCode server.')
    }
    expect(() => serviceUrl(origin, 'mcp.connect')).toThrow('Invalid OpenCode server.')
    // The list takes no name.
    expect(() => serviceUrl(origin, 'mcp.list', { params: { server: 'demo_math' } })).toThrow()
    // Resolving the finished URL keeps it under the route, even for the nastiest names allowed.
    expect(new URL(serviceUrl(origin, 'mcp.disconnect', { params: { server: '..%2f..' } })).pathname)
      .toBe('/api/experimental/mcp/..%252f../disconnect')
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

  it('lets one request wait longer than the client\'s usual limit, as a model call must, and no other', async () => {
    const url = await serve((_request, response) => {
      setTimeout(() => response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"text":"late"}}'), 150)
    })
    const client = new OpenCodeServiceClient({ discover: async () => ({ url, password: 'p' }), executable: () => 'opencode', timeoutMs: 50 })
    await expect(client.request(wsl, 'session.generate', { params: { sessionID: 'ses_a' }, body: { prompt: 'x' }, timeoutMs: 2_000 })).resolves.toEqual({ data: { text: 'late' } })
    await expect(client.request(wsl, 'session.generate', { params: { sessionID: 'ses_a' }, body: { prompt: 'x' } })).rejects.toThrow('did not answer in time')
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
  it('bounds multiline and multibyte events across chunks', () => {
    const parser = new SseParser()
    const line = `data: ${'é'.repeat(256 * 1024)}\n`
    expect(() => { for (let i = 0; i < 17; i++) parser.push(line) }).toThrow('size limit')
    expect(() => new SseParser().push('x'.repeat(8 * 1024 * 1024 + 1))).toThrow('size limit')
  })
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
  it('identifies routine notes for compact activity without classifying switches and failures as routine', () => {
    expect(parseMessage({ id: 'notice', type: 'synthetic', description: 'python3 server.py', text: 'Process finished.' }))
      .toMatchObject({ kind: 'note', text: 'python3 server.py', detail: 'Process finished.', activity: 'notice' })
    expect(parseMessage({ id: 'system', type: 'system', text: 'Context' })).toMatchObject({ activity: 'notice' })
    expect(parseMessage({ id: 'shell', type: 'shell', command: 'echo ok' })).toMatchObject({ activity: 'shell' })
    expect(parseMessage({ id: 'skill', type: 'skill', name: 'review' })).toMatchObject({ activity: 'skill' })
    for (const raw of [
      { id: 'agent', type: 'agent-switched', agent: 'build' },
      { id: 'model', type: 'model-switched', model: { id: 'model', providerID: 'p' } },
      { id: 'failed', type: 'idle', outcome: 'failed' },
      { id: 'compacted', type: 'compaction', status: 'completed', summary: 'Summary' },
      { id: 'goal', type: 'synthetic', text: 'An unfamiliar goal notification.', metadata: { source: 'goal' } },
    ]) expect(parseMessage(raw)).not.toHaveProperty('activity')
  })

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

  it('keeps the variants OpenCode offers, including custom IDs, without inventing levels', () => {
    const models = parseModels({ data: [
      { id: 'reasoner', providerID: 'local', variants: [
        { id: 'low' }, { id: 'deep-review' }, { id: 'none' }, { id: 'low' },
        { id: 'default' }, { id: 'disabled', disabled: true },
        { id: '' }, { id: 'bad\nvalue' }, { id: 'x'.repeat(513) }, null, 'high', {},
      ] },
      { id: 'fixed-high', providerID: 'local', capabilities: { reasoning: { supported: true } } },
      { id: 'empty', providerID: 'local', variants: [] },
      { id: 'malformed', providerID: 'local', variants: { high: {} } },
    ] }, new Map())
    expect(models[0]?.variants).toEqual(['low', 'deep-review', 'none'])
    for (const model of models.slice(1)) expect(model).not.toHaveProperty('variants')
    expect(parseDefaultModel({ data: { id: 'reasoner', providerID: 'local', variant: 'deep-review' } }))
      .toEqual({ id: 'reasoner', providerId: 'local', variant: 'deep-review' })
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

  it('reads when a step finished, and nothing while it runs', () => {
    const step = (time: Record<string, unknown>) =>
      parseMessage({ id: 'msg_1', type: 'assistant', model: { id: 'm', providerID: 'p' }, time, content: [] })
    expect(step({ created: 1_000, streamed: 1_500, completed: 6_000 })).toMatchObject({ completed: true, completedAt: 6_000 })
    expect(step({ created: 1_000, streamed: 1_500 })).toMatchObject({ completed: false })
    expect(step({ created: 1_000 })).not.toHaveProperty('completedAt')
    expect(step({ created: 1_000, completed: -1 })).not.toHaveProperty('completedAt')
    // The end of the stream comes before the end of the step, which includes the tools it ran.
    expect(step({ created: 1_000, streamed: 1_500, completed: 6_000 })).toMatchObject({ streamedAt: 1_500, completedAt: 6_000 })
    expect(step({ created: 1_000, streamed: 1_500 })).toMatchObject({ streamedAt: 1_500 })
    expect(step({ created: 1_000 })).not.toHaveProperty('streamedAt')
    expect(step({ created: 1_000, streamed: 'soon' })).not.toHaveProperty('streamedAt')
  })

  it('gives the tokens per second OpenCode itself shows for a recorded turn', () => {
    // Three steps: (13 + 105 + 83) output tokens over 844 + 1,090 + 1,851 ms of generating. The
    // milliseconds each step then spent finishing up are not part of it.
    const raw = JSON.parse(fixture('messages-tools.json'))
    const { messages } = parseMessagesPage(raw, false, raw.data.length)
    const stats = turnStats(messages)
    const last = messages.filter((message) => message.kind === 'assistant').at(-1)!
    expect([...stats.finished.keys()]).toEqual([last.id])
    const stat = stats.finished.get(last.id)!
    expect(stat.ms).toBe(3_832)
    expect(stat.tokensPerSecond).toBeCloseTo(201 / 3.785, 6)
    expect(stat.tokensPerSecond!.toFixed(1)).toBe('53.1')
  })

  it('reads the staged revert from a session answer, leaving out what MDE cannot use', () => {
    const answer = {
      data: {
        id: 'ses_1',
        revert: {
          messageID: 'msg_3',
          snapshot: 'abc',
          files: [
            { file: 'src/a.ts', patch: 'diff --git a/src/a.ts b/src/a.ts', additions: 2, deletions: 1, status: 'modified' },
            { file: 'b.txt', additions: 0, deletions: 1, status: 'deleted' },
            { file: '', additions: 1, deletions: 0, status: 'added' },
            { file: 'c.txt', additions: 1, deletions: 0, status: 'renamed' },
            'junk',
          ],
        },
      },
    }
    // The diff text stays in OpenCode: the banner needs the file, what happened to it and the counts.
    expect(parseSessionRevert(answer)).toEqual({
      messageId: 'msg_3',
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
        { path: 'b.txt', status: 'deleted', additions: 0, deletions: 1 },
      ],
    })
    expect(parseSessionRevert({ data: { revert: { messageID: 'msg_3' } } })).toEqual({ messageId: 'msg_3', files: [] })
    expect(parseSessionRevert({ data: { revert: { messageID: 'msg_3', files: [{ file: 'a.ts', status: 'added', additions: -1, deletions: 'x' }] } } }))
      .toEqual({ messageId: 'msg_3', files: [{ path: 'a.ts', status: 'added', additions: 0, deletions: 0 }] })
    const many = Array.from({ length: 250 }, (_, index) => ({ file: `f${index}.ts`, status: 'modified', additions: 1, deletions: 0 }))
    expect(parseSessionRevert({ data: { revert: { messageID: 'msg_3', files: many } } })?.files).toHaveLength(200)
  })

  it('reads the revert a stage answer reports, which is shaped like the session\'s own', () => {
    const answer = {
      data: {
        messageID: 'msg_3',
        snapshot: 'abc',
        files: [{ file: 'src/a.ts', patch: 'diff --git a/src/a.ts b/src/a.ts', additions: 2, deletions: 1, status: 'modified' }],
      },
    }
    expect(parseStagedRevert(answer)).toEqual({ messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] })
    expect(parseStagedRevert({ data: { messageID: 'msg_3', snapshot: 'abc', files: [] } })).toEqual({ messageId: 'msg_3', files: [] })
    expect(parseStagedRevert({ data: { messageID: 'nope' } })).toBeNull()
    expect(parseStagedRevert({ data: {} })).toBeNull()
    expect(parseStagedRevert(null)).toBeNull()
  })

  it('treats a missing or unusable revert as none, so the conversation is never hidden by mistake', () => {
    expect(parseSessionRevert({ data: { id: 'ses_1' } })).toBeNull()
    expect(parseSessionRevert({ data: { id: 'ses_1', revert: null } })).toBeNull()
    expect(parseSessionRevert({ data: { revert: { files: [] } } })).toBeNull()
    expect(parseSessionRevert({ data: { revert: { messageID: 'not a message' } } })).toBeNull()
    expect(parseSessionRevert({ data: { revert: { messageID: 'ses_1' } } })).toBeNull()
    expect(parseSessionRevert({ data: { revert: 'msg_3' } })).toBeNull()
    expect(parseSessionRevert(null)).toBeNull()
    expect(parseSessionRevert({ nope: true })).toBeNull()
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

  describe('compaction notes', () => {
    const compaction = (extra: Record<string, unknown>) => parseMessage({ id: 'msg_c1', type: 'compaction', reason: 'manual', time: { created: 5 }, ...extra })

    it('says that it is running, with nothing to open', () => {
      expect(compaction({ status: 'running', summary: '' }))
        .toEqual({ kind: 'note', id: 'msg_c1', time: 5, tone: 'info', text: 'Compacting the conversation…', compaction: { status: 'running', reason: 'manual' } })
      expect(compaction({ status: 'running', reason: 'auto' })).toMatchObject({ text: 'Compacting the conversation automatically…', compaction: { status: 'running', reason: 'auto' } })
    })

    it('shows the summary as the detail of a completed one, with how many tokens it took', () => {
      expect(compaction({ status: 'completed', summary: '## Objective\n- Fix login\n', tokens: { input: 580, output: 724, cache: { read: 8192, write: 0 } } }))
        .toEqual({
          kind: 'note', id: 'msg_c1', time: 5, tone: 'info', text: 'Conversation compacted', detail: '## Objective\n- Fix login',
          compaction: { status: 'completed', reason: 'manual', summaryTokens: 724 },
        })
      expect(compaction({ status: 'completed', reason: 'auto', summary: 'S' })).toMatchObject({ text: 'Conversation compacted automatically', compaction: { status: 'completed', reason: 'auto' } })
      // No summary or token count to show: nothing is made up for them.
      const bare = compaction({ status: 'completed' })
      expect(bare).not.toHaveProperty('detail')
      expect((bare as { compaction: object }).compaction).toEqual({ status: 'completed', reason: 'manual' })
    })

    it('reports a failure as an error with its reason, and keeps credentials out of it', () => {
      const failed = compaction({
        status: 'failed',
        error: { type: 'provider.auth', message: 'API key expired.', status: 401, response: { body: '{"headers":{"Authorization":"Bearer sk-secret"}}' } },
      })
      expect(failed).toEqual({
        kind: 'note', id: 'msg_c1', time: 5, tone: 'error', text: 'Could not compact the conversation: API key expired.',
        compaction: { status: 'failed', reason: 'manual' },
      })
      expect(JSON.stringify(failed)).not.toContain('sk-secret')
      expect(compaction({ status: 'failed', error: { type: 'compaction.unavailable', message: 'Nothing to compact yet' } }))
        .toMatchObject({ text: 'Could not compact the conversation: Nothing to compact yet' })
      expect(compaction({ status: 'failed' })).toMatchObject({ tone: 'error', text: 'Could not compact the conversation' })
    })

    it('still shows a compaction whose status it does not know, as plain compacted', () => {
      const odd = compaction({ status: 'paused', summary: 'S' })
      expect(odd).toMatchObject({ kind: 'note', tone: 'info', text: 'Conversation compacted' })
      expect(odd).not.toHaveProperty('compaction')
    })
  })

  it('sees a compaction in the inbox, which is not one of the user\'s messages', () => {
    const inbox = (...types: string[]) => ({ data: types.map((type, index) => ({ id: `msg_p${index}`, type, delivery: 'queue', payload: {} })) })
    expect(holdsCompaction(inbox('compaction'))).toBe(true)
    expect(holdsCompaction(inbox('user', 'compaction'))).toBe(true)
    expect(holdsCompaction(inbox('user', 'synthetic'))).toBe(false)
    expect(holdsCompaction(inbox())).toBe(false)
    for (const odd of [null, {}, { data: 'compaction' }, { data: [null, 'compaction', 3] }, 'compaction']) expect(holdsCompaction(odd)).toBe(false)
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

  it('reads validated child session IDs only from subagent metadata, results and errors', () => {
    const tool = (name: string, state: Record<string, unknown>) => {
      const message = parseMessage({
        id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' },
        content: [{ type: 'tool', id: 'call_1', name, state: { status: 'running', input: {}, ...state } }],
      })
      return message?.kind === 'assistant' ? message.parts[0] : null
    }
    expect(tool('subagent', { metadata: { sessionID: 'ses_child', secret: 'not forwarded' } }))
      .toMatchObject({ subagent: { sessionId: 'ses_child' } })
    expect(tool('subagent', { status: 'completed', content: [{ type: 'text', text: '<subagent sessionID="ses_child" state="completed">Done</subagent>' }] }))
      .toMatchObject({ subagent: { sessionId: 'ses_child' } })
    expect(tool('subagent', { status: 'error', error: { message: 'Subagent failed (sessionID: ses_child): no credits' } }))
      .toMatchObject({ subagent: { sessionId: 'ses_child' } })
    for (const sessionID of ['../ses_child', 'ses_bad/path', 'ses_', 123, null]) {
      expect(tool('subagent', { metadata: { sessionID } })).not.toHaveProperty('subagent')
    }
    expect(tool('shell', { metadata: { sessionID: 'ses_child' } })).not.toHaveProperty('subagent')
    expect(tool('subagent', {})).not.toHaveProperty('subagent')
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

    it('keeps the exit code of a shell command once it has finished', () => {
      const shell = (state: Record<string, unknown>) => tool(parseMessage({
        id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1 },
        content: [{ type: 'tool', id: 'call_1', name: 'shell', time: { created: 1 }, state: { input: { command: 'npm test' }, ...state } }],
      }))
      expect(shell({ status: 'completed', metadata: { exit: 0 } })?.exitCode).toBe(0)
      expect(shell({ status: 'completed', metadata: { exit: 2 } })?.exitCode).toBe(2)
      expect(shell({ status: 'error', error: { message: 'Failed' }, metadata: { exit: 127 } })?.exitCode).toBe(127)
      expect(shell({ status: 'running', metadata: { exit: 0 } })).not.toHaveProperty('exitCode')
      expect(shell({ status: 'completed', metadata: { exit: 'nope' } })).not.toHaveProperty('exitCode')
      expect(shell({ status: 'completed', metadata: { exit: 1.5 } })).not.toHaveProperty('exitCode')
      expect(shell({ status: 'completed' })).not.toHaveProperty('exitCode')
    })

    it('keeps what was answered to the question tool, cut to a sane size', () => {
      const ask = (state: Record<string, unknown>, name = 'question') => tool(parseMessage({
        id: 'msg_1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1 },
        content: [{ type: 'tool', id: 'call_1', name, time: { created: 1 }, state: { input: { questions: [] }, ...state } }],
      }))
      expect(ask({ status: 'completed', metadata: { answers: [['Paris'], ['Red', 'Blue'], []] } })?.answers).toEqual([['Paris'], ['Red', 'Blue'], []])
      expect(ask({ status: 'completed', metadata: { answers: [['  ', 7, 'ok '], 'nope'] } })?.answers).toEqual([['ok'], []])
      expect(ask({ status: 'completed', metadata: { answers: [['x'.repeat(900)]] } })?.answers?.[0]?.[0]).toHaveLength(500)
      expect(ask({ status: 'completed', metadata: { answers: Array.from({ length: 30 }, () => ['a']) } })?.answers).toHaveLength(20)
      expect(ask({ status: 'completed', metadata: { answers: [] } })).not.toHaveProperty('answers')
      expect(ask({ status: 'completed', metadata: { answers: 'Paris' } })).not.toHaveProperty('answers')
      expect(ask({ status: 'running', metadata: { answers: [['Paris']] } })).not.toHaveProperty('answers')
      expect(ask({ status: 'completed', metadata: { answers: [['Paris']] } }, 'read')).not.toHaveProperty('answers')
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

  it('marks incomplete permission scopes so they cannot be approved', () => {
    for (const resources of [Array(51).fill('visible'), ['x'.repeat(4097)], ['safe', null], ['spoof\u202efile']]) {
      expect(parsePermissions({ data: [{ id: 'per_1', action: 'read', resources }] })[0]?.incomplete).toBe(true)
    }
  })

  it('reads new sessions and active sessions', () => {
    expect(parseCreatedSession({ data: { id: 'ses_1', title: 'New' } })).toEqual({ id: 'ses_1', title: 'New' })
    expect(() => parseCreatedSession({ data: { id: '../x' } })).toThrow()
    expect([...parseActiveSessions({ data: { ses_1: { type: 'running' }, ses_2: { type: 'idle' }, bad: { type: 'running' } } })])
      .toEqual(['ses_1'])
  })
})


it('returns attachment metadata and bounded previews without forwarding file bytes', () => {
  const page = parseMessagesPage({ data: [{ type: 'user', id: 'msg_image', time: { created: 1 }, text: '', files: [
    { name: 'screen.png', mime: 'image/png', data: 'AQID' },
    { name: 'notes.txt', mime: 'text/plain', data: 'aGVsbG8=' },
  ] }] }, false, 50, () => 'data:image/png;base64,eA==')
  const message = page.messages[0]!
  expect(message.kind).toBe('user')
  if (message.kind !== 'user') throw new Error('Expected user message')
  expect(message.attachments).toEqual([
    { id: 'msg_image-0', name: 'screen.png', mime: 'image/png', size: 3, thumbnail: 'data:image/png;base64,eA==' },
    { id: 'msg_image-1', name: 'notes.txt', mime: 'text/plain', size: 5 },
  ])
  expect(JSON.stringify(message)).not.toContain('aGVsbG8=')
})

describe('messages the service holds for the agent', () => {
  /** An item of the session inbox, as the service sends it. */
  const item = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'msg_p1', sessionID: 'ses_a', time: { created: 1_700_000_000_000 }, type: 'user', delivery: 'steer',
    payload: { text: 'Also add a test' },
    ...overrides,
  })

  it('reads an item as the user message it will become, with its way of delivery', () => {
    expect(parseInboxItem(item())).toEqual({
      id: 'msg_p1', delivery: 'steer',
      message: { kind: 'user', id: 'msg_p1', time: 1_700_000_000_000, text: 'Also add a test' },
    })
    expect(parseInboxItem(item({ delivery: 'queue' }))?.delivery).toBe('queue')
  })

  it('reads skills and files the way the delivered message will show them', () => {
    const png = Buffer.from('not really a png').toString('base64')
    const thumbnail = vi.fn(() => 'data:image/png;base64,AAAA')
    const held = parseInboxItem(item({
      payload: {
        text: 'Use $demo on this',
        skills: [{ id: 'demo', name: 'Demo', text: 'x', mention: { start: 4, end: 9, text: '$demo' } }],
        files: [{ data: png, mime: 'image/png', name: 'notes.png', source: { type: 'inline' } }],
      },
    }), thumbnail)
    expect(held?.message).toEqual({
      kind: 'user', id: 'msg_p1', time: 1_700_000_000_000, text: 'Use $demo on this',
      skills: [{ id: 'demo', name: 'Demo' }],
      attachments: [{ id: 'msg_p1-0', name: 'notes.png', mime: 'image/png', size: Buffer.from(png, 'base64').length, thumbnail: 'data:image/png;base64,AAAA' }],
    })
    expect(thumbnail).toHaveBeenCalledOnce()
  })

  it('has no message for work the agent queued for itself, or for an item it cannot read', () => {
    expect(parseInboxItem(item({ type: 'synthetic' }))).toBeNull()
    expect(parseInboxItem(item({ type: 'compaction' }))).toBeNull()
    expect(parseInboxItem(item({ type: 'move' }))).toBeNull()
    expect(parseInboxItem(item({ delivery: 'later' }))).toBeNull()
    expect(parseInboxItem(item({ delivery: undefined }))).toBeNull()
    expect(parseInboxItem(item({ id: 'not a message' }))).toBeNull()
    expect(parseInboxItem(item({ payload: undefined }))).toBeNull()
    expect(parseInboxItem(null)).toBeNull()
    expect(parseInboxItem('msg_p1')).toBeNull()
  })

  it('reads the inbox in the order the service gives, keeping only the user\'s messages', () => {
    const list = {
      data: [
        item({ id: 'msg_p1', payload: { text: 'First' } }),
        item({ id: 'msg_p2', type: 'synthetic', payload: { text: 'Agent note' } }),
        item({ id: 'msg_p3', delivery: 'queue', payload: { text: 'Third' } }),
        'junk',
      ],
    }
    expect(parsePendingMessages(list).map((held) => [held.id, held.delivery, held.message.text])).toEqual([
      ['msg_p1', 'steer', 'First'],
      ['msg_p3', 'queue', 'Third'],
    ])
    expect(parsePendingMessages({ data: [] })).toEqual([])
  })

  it('shows a bounded number, and refuses an answer that is not a list', () => {
    const many = { data: Array.from({ length: 80 }, (_, index) => item({ id: `msg_p${index}` })) }
    expect(parsePendingMessages(many)).toHaveLength(50)
    expect(() => parsePendingMessages(null)).toThrow('inbox list')
    expect(() => parsePendingMessages({ data: {} })).toThrow('inbox list')
  })

  it('reads the answer to a prompt, which is one item', () => {
    expect(parsePromptAnswer({ data: item({ delivery: 'queue' }) })).toMatchObject({ id: 'msg_p1', delivery: 'queue' })
    expect(parsePromptAnswer({ data: { id: 'msg_p1' } })).toBeNull()
    expect(parsePromptAnswer({})).toBeNull()
    expect(parsePromptAnswer(null)).toBeNull()
  })
})
