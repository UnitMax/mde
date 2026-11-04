import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatMcpServer, ChatMessage, ChatPart } from '../src/shared/types'
import { MCP_SERVER_NAME } from '../src/shared/mcp'
import {
  argsPreview, callArguments, callCountLabel, highlightJson, inlineAnswer, mcpAuthCommand, mcpCallCounts, mcpCalls, mcpKey,
  mcpSummary, resultView, scriptDuration, scriptOf, serverNamespaces, splitCall,
} from '../src/renderer/lib/mcp'
import { toolSummary } from '../src/renderer/lib/chat'
import { ServiceShapeError, parseMcpServers, parseMessagesPage, redactMcpError } from '../src/main/opencode/service/parse'

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/opencode-chat', name), 'utf8'))

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** Every tool part of the MCP fixture by its call ID, oldest message first. */
function toolParts(): Map<string, ToolPart> {
  const { messages } = parseMessagesPage(fixture('messages-mcp.json'), false, 100)
  const parts = new Map<string, ToolPart>()
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    for (const part of message.parts) if (part.kind === 'tool') parts.set(part.id, part)
  }
  return parts
}

describe('MCP server names', () => {
  it('accepts what a user may write in the configuration, and nothing that could leave a URL path or hide in a log', () => {
    for (const name of ['demo_math', 'context 7', 'a.b', 'v1.2', 'é', '.well-known', 'x'.repeat(200)]) expect(MCP_SERVER_NAME.test(name)).toBe(true)
    for (const name of ['', '.', '..', '....', 'x'.repeat(201), 'a\nb', 'a\u0000b', 'a\u007fb', 'a\u0085b']) expect(MCP_SERVER_NAME.test(name)).toBe(false)
  })
})

describe('parseMcpServers', () => {
  const list = (...servers: unknown[]) => ({ data: servers })

  it('maps OpenCode’s states, calls an unknown one unknown, and keeps no other field', () => {
    const servers = parseMcpServers(list(
      { name: 'a', status: { status: 'connected' }, command: ['x'], url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' } },
      { name: 'b', status: { status: 'pending' } },
      { name: 'c', status: { status: 'disabled' } },
      { name: 'd', status: { status: 'failed', error: 'spawn ENOENT' } },
      { name: 'e', status: { status: 'needs_auth', error: 'Sign in' } },
      { name: 'f', status: { status: 'registering' } },
      { name: 'g' },
      { name: 'h', status: 'connected' },
    ))
    expect(servers).toEqual([
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'connecting' },
      { name: 'c', status: 'disabled' },
      { name: 'd', status: 'failed', error: 'spawn ENOENT' },
      { name: 'e', status: 'needs-auth', error: 'Sign in' },
      { name: 'f', status: 'unknown' },
      { name: 'g', status: 'unknown' },
      { name: 'h', status: 'unknown' },
    ])
    expect(JSON.stringify(servers)).not.toMatch(/secret|example\.com|command/)
  })

  it('keeps an error only for the states it explains, and a title only when it differs from the name', () => {
    const servers = parseMcpServers(list(
      { name: 'connected', status: { status: 'connected', error: 'stale' } },
      { name: 'titled', title: 'Tools of the trade', status: { status: 'connected' } },
      { name: 'same', title: 'same', status: { status: 'connected' } },
    ))
    const named = (name: string) => servers.find((server) => server.name === name)
    expect(named('connected')).toEqual({ name: 'connected', status: 'connected' })
    expect(named('titled')?.title).toBe('Tools of the trade')
    expect(named('same')).toEqual({ name: 'same', status: 'connected' })
  })

  it('skips names that could not be switched, repeats, and anything that is not a server', () => {
    const servers = parseMcpServers(list(
      { name: '..', status: { status: 'connected' } },
      { name: '', status: { status: 'connected' } },
      { name: 'x'.repeat(201), status: { status: 'connected' } },
      { name: 'ok', status: { status: 'connected' } },
      { name: 'ok', status: { status: 'failed', error: 'again' } },
      { name: 7 },
      null,
      'text',
      [],
    ))
    expect(servers).toEqual([{ name: 'ok', status: 'connected' }])
  })

  it('lists servers in name order without regard to case, and caps the list', () => {
    expect(parseMcpServers(list({ name: 'beta' }, { name: 'Alpha' }, { name: 'alpha2' }, { name: 'Zed' })).map((server) => server.name))
      .toEqual(['Alpha', 'alpha2', 'beta', 'Zed'])
    const many = parseMcpServers(list(...Array.from({ length: 150 }, (_, index) => ({ name: `server-${index}` }))))
    expect(many).toHaveLength(100)
  })

  it('refuses an answer that is not a list', () => {
    expect(() => parseMcpServers({})).toThrow(ServiceShapeError)
    expect(() => parseMcpServers(null)).toThrow(ServiceShapeError)
    expect(parseMcpServers({ data: 'nope' })).toEqual([])
  })
})

describe('redactMcpError', () => {
  it('takes credentials, tokens and the home directory out of a server’s error', () => {
    const cases: Array<[string, RegExp, string?]> = [
      ['connect https://user:hunter2@example.com/mcp failed', /user|hunter2/, 'connect https://example.com/mcp failed'],
      ['GET https://example.com/mcp?access_token=abc123&x=1 returned 401', /abc123|access_token/, 'GET https://example.com/mcp returned 401'],
      ['GET https://example.com/mcp#frag returned 500', /frag/],
      ['Authorization: Bearer abcdefghij', /abcdefghij/],
      ['bearer abcdefghij was refused', /abcdefghij/],
      ['api_key=sk-12345 is invalid', /sk-12345/],
      ['password: hunter2', /hunter2/],
      ['Cannot find /home/someone/work/server.mjs', /someone/, 'Cannot find ~/work/server.mjs'],
      ['Cannot find /Users/someone/work/server.mjs', /someone/],
      ['Cannot find C:\\Users\\Someone\\work\\server.mjs', /Someone/],
      [`token ${'a'.repeat(40)} expired`, /a{32}/],
    ]
    for (const [input, forbidden, expected] of cases) {
      const output = redactMcpError(input)!
      expect(output, input).not.toMatch(forbidden)
      if (expected) expect(output).toBe(expected)
    }
  })

  it('shows one line of at most 300 characters, and nothing for an empty or missing error', () => {
    expect(redactMcpError('spawn\n  ENOENT\t\u0000 node')).toBe('spawn ENOENT node')
    expect(redactMcpError('a b '.repeat(300))!.length).toBeLessThanOrEqual(300)
    expect(redactMcpError('   ')).toBeUndefined()
    expect(redactMcpError(undefined)).toBeUndefined()
    expect(redactMcpError({ message: 'x' })).toBeUndefined()
  })

  it('leaves an ordinary message alone', () => {
    expect(redactMcpError('Connection closed')).toBe('Connection closed')
    expect(redactMcpError('exit code 127: node not found')).toBe('exit code 127: node not found')
  })
})

describe('the tools a Code Mode script called', () => {
  const parts = toolParts()

  it('keeps each call’s tool, status and compact arguments, and how long the script ran', () => {
    const one = parts.get('call_one')!
    expect(one).toMatchObject({ name: 'execute', status: 'completed', output: '{\n  "sum": 12\n}' })
    expect(one.calls).toEqual([{ tool: 'demo_math.add', status: 'completed', input: '{"a":7,"b":5}' }])
    expect(one.durationMs).toBe(11)
    expect(one.truncated).toBeUndefined()
  })

  it('keeps several calls in order', () => {
    const two = parts.get('call_two')!
    expect(two.calls?.map((call) => call.tool)).toEqual(['demo_display.sample', 'demo_math.add'])
    expect(two.calls?.[0]?.input).toBe('{"kind":"markdown"}')
    expect(two.durationMs).toBe(640)
  })

  it('reads the calls of a script that is still running, with no duration yet', () => {
    const running = parts.get('call_running')!
    expect(running.status).toBe('running')
    expect(running.calls).toEqual([{ tool: 'demo_display.sample', status: 'running', input: '{"kind":"plain","delayMs":3000}' }])
    expect(running.durationMs).toBeUndefined()
  })

  it('reads a failed script with its error and its failed call', () => {
    const failed = parts.get('call_error')!
    expect(failed).toMatchObject({ status: 'error', error: 'demo_display.sample failed: intentional fixture error' })
    expect(failed.calls).toEqual([{ tool: 'demo_display.sample', status: 'error', input: '{"kind":"error"}' }])
    expect(failed.durationMs).toBe(7)
  })

  it('keeps calls to tools that are not MCP servers, for the reader to tell apart', () => {
    expect(parts.get('call_browser')!.calls).toEqual([{ tool: 'browser.open', status: 'completed', input: '{"url":"https://example.com/"}' }])
  })

  it('has no calls for a part without them, or one whose input is still streaming', () => {
    expect(parts.get('call_search')!.calls).toBeUndefined()
    expect(parts.get('call_search')!.input).toContain('demo_math')
    const streaming = parts.get('call_stream')!
    expect(streaming).toMatchObject({ status: 'pending' })
    expect(streaming.calls).toBeUndefined()
    expect(streaming.durationMs).toBeUndefined()
  })

  it('takes a call without a usable status from the script, skips entries that are not calls, and passes on that OpenCode cut the output', () => {
    const cut = parts.get('call_cut')!
    expect(cut.calls).toEqual([
      { tool: 'demo_math.add', status: 'completed', input: '{"a":1,"b":2}' },
      { tool: 'demo_math.add', status: 'completed', input: '' },
    ])
    expect(cut.truncated).toBe(true)
  })

  it('limits how many calls, and how much of their arguments, reach the reader', () => {
    const call = (index: number) => ({ tool: `demo_math.add${index}`, status: 'completed', input: { text: 'x'.repeat(10_000) } })
    const page = parseMessagesPage({
      data: [{
        id: 'msg_1', time: { created: 1 }, type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' },
        content: [{ type: 'tool', id: 'call_big', name: 'execute', state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }], metadata: { toolCalls: Array.from({ length: 30 }, (_, index) => call(index)) } }, time: { created: 1 } }],
      }],
    }, false, 10)
    const part = (page.messages[0] as { parts: ToolPart[] }).parts[0]!
    expect(part.calls).toHaveLength(20)
    expect(part.calls!.every((entry) => entry.input.length <= 4 * 1024)).toBe(true)
    expect(part.calls!.reduce((sum, entry) => sum + entry.input.length, 0)).toBeLessThanOrEqual(32 * 1024)
  })

  it('reports no duration for times that cannot be a duration', () => {
    const page = (time: unknown) => {
      const { messages } = parseMessagesPage({
        data: [{ id: 'msg_1', time: { created: 1 }, type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' },
          content: [{ type: 'tool', id: 'call_t', name: 'bash', state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] }, time }] }],
      }, false, 10)
      return (messages[0] as { parts: ToolPart[] }).parts[0]?.durationMs
    }
    expect(page({ created: 1, ran: 10, completed: 30 })).toBe(20)
    expect(page({ created: 1, ran: 30, completed: 10 })).toBeUndefined()
    expect(page({ created: 1, ran: 10 })).toBeUndefined()
    expect(page({ created: 1, ran: '10', completed: 30 })).toBeUndefined()
    expect(page({ created: 1, ran: 0, completed: 1e15 })).toBeUndefined()
    expect(page(undefined)).toBeUndefined()
  })
})

describe('telling a script’s calls apart', () => {
  const parts = toolParts()
  const names = ['demo_math', 'demo_display']

  it('splits a call at the first dot, because a tool’s own name may hold dots', () => {
    expect(splitCall('demo_math.add')).toEqual({ namespace: 'demo_math', name: 'add' })
    expect(splitCall('files.read.text')).toEqual({ namespace: 'files', name: 'read.text' })
    expect(splitCall('add')).toEqual({ namespace: '', name: 'add' })
  })

  it('knows a server by the names Code Mode may give its group', () => {
    expect(serverNamespaces('demo_math')).toEqual(['demo_math'])
    expect(serverNamespaces('context 7')).toEqual(['context_7'])
    expect(serverNamespaces('my-server')).toEqual(['my_server', 'my-server'])
    expect(serverNamespaces('a.b')).toEqual(['a_b'])
  })

  it('marks calls to known servers, and leaves other groups as they are', () => {
    expect(mcpCalls(parts.get('call_one')!, names)).toEqual([
      { namespace: 'demo_math', tool: 'add', server: 'demo_math', status: 'completed', input: '{"a":7,"b":5}' },
    ])
    expect(mcpCalls(parts.get('call_browser')!, names)).toEqual([
      { namespace: 'browser', tool: 'open', server: null, status: 'completed', input: '{"url":"https://example.com/"}' },
    ])
  })

  it('shows the calls of a script even when the server list has not loaded', () => {
    const calls = mcpCalls(parts.get('call_two')!, [])
    expect(calls.map((call) => [call.namespace, call.tool, call.server])).toEqual([['demo_display', 'sample', null], ['demo_math', 'add', null]])
  })

  it('maps a server named with a space or a hyphen to its group', () => {
    const part = { kind: 'tool', id: 'c', name: 'execute', status: 'completed', input: '{}', calls: [{ tool: 'context_7.search', status: 'completed', input: '{}' }, { tool: 'my_server.go', status: 'completed', input: '{}' }] } as const satisfies ToolPart
    expect(mcpCalls(part, ['context 7', 'my-server']).map((call) => call.server)).toEqual(['context 7', 'my-server'])
  })

  it('recognises a direct tool by the longest server name it starts with, not the first underscore', () => {
    const direct = (name: string): ToolPart => ({ kind: 'tool', id: 'c', name, status: 'completed', input: '{"a":1}' })
    expect(mcpCalls(direct('demo_math_add'), ['demo', 'demo_math'])).toEqual([
      { namespace: 'demo_math', tool: 'add', server: 'demo_math', status: 'completed', input: '{"a":1}' },
    ])
    expect(mcpCalls(direct('demo_math_add'), ['demo'])[0]).toMatchObject({ server: 'demo', tool: 'math_add' })
    expect(mcpCalls(direct('demo_math'), ['demo_math'])).toEqual([])
    expect(mcpCalls(direct('bash'), ['demo_math'])).toEqual([])
    expect(mcpCalls(direct('demo_math_add'), [])).toEqual([])
  })

  it('counts calls per known server and failures, over the shown messages', () => {
    const { messages } = parseMessagesPage(fixture('messages-mcp.json'), false, 100)
    const counts = mcpCallCounts(messages, names)
    // The first part lists a malformed entry (no tool name), which the parser drops: 2 + 1 + 1.
    expect(counts.get('demo_math')).toEqual({ calls: 4, failed: 0 })
    expect(counts.get('demo_display')).toEqual({ calls: 3, failed: 1 })
    expect(counts.has('browser')).toBe(false)
    expect(mcpCallCounts([] as ChatMessage[], names).size).toBe(0)
  })

  it('reads the script out of a Code Mode part, and none out of one still streaming', () => {
    expect(scriptOf(parts.get('call_one')!)).toContain('tools.demo_math.add')
    expect(scriptOf(parts.get('call_stream')!)).toBeNull()
    expect(scriptOf(parts.get('call_search')!)).toBeNull()
  })

  it('summarises a script by what it called', () => {
    const summary = (id: string) => toolSummary(parts.get(id)!, '/home/me/app')
    expect(summary('call_one')).toBe('Called demo_math.add')
    expect(summary('call_two')).toBe('Called 2 tools')
    expect(summary('call_running')).toBe('Calling demo_display.sample')
    expect(summary('call_stream')).toBe('Running a script')
    expect(summary('call_search')).toBe('Looked up demo_math tools')
    expect(toolSummary({ kind: 'tool', id: 'x', name: 'execute', status: 'completed', input: '{}' }, '/')).toBe('Ran a script')
    // The ordinary search still reads as a search.
    expect(toolSummary({ kind: 'tool', id: 'x', name: 'search', status: 'completed', input: '{"query":"todo"}' }, '/')).toBe('Searched for todo')
  })
})

describe('showing a call', () => {
  it('writes arguments in one short line', () => {
    expect(argsPreview('{"a":7,"b":5}')).toBe('a: 7, b: 5')
    expect(argsPreview('{"kind":"plain","delayMs":3000}')).toBe('kind: plain, delayMs: 3000')
    expect(argsPreview('{"list":[1,2,3],"nested":{"x":1},"none":null,"yes":true}')).toBe('list: [3], nested: {…}, none: null, yes: true')
    expect(argsPreview(`{"text":"${'x'.repeat(60)}"}`)).toBe(`text: ${'x'.repeat(27)}…`)
    expect(argsPreview('{"a":1,"b":2}', 8)).toBe('a: 1, b…')
    expect(argsPreview('{"cut":"abc')).toBe('{"cut":"abc')
    expect(argsPreview('')).toBe('')
  })

  it('reads arguments as pairs, or says they are not an object', () => {
    expect(callArguments('{"a":1,"b":"x"}')).toEqual([['a', 1], ['b', 'x']])
    expect(callArguments('{}')).toEqual([])
    expect(callArguments('[1]')).toBeNull()
    expect(callArguments('{"cut')).toBeNull()
  })

  it('lays out JSON, recognises Markdown only when it is plainly some, and leaves the rest', () => {
    expect(resultView('{"sum":12}')).toEqual({ kind: 'json', text: '{\n  "sum": 12\n}' })
    expect(resultView(' [1, 2] ')).toEqual({ kind: 'json', text: '[\n  1,\n  2\n]' })
    expect(resultView('{"cut":').kind).toBe('text')
    expect(resultView('3').kind).toBe('text')
    expect(resultView('# Title\n\n- one\n- two').kind).toBe('markdown')
    expect(resultView('| a | b |\n| - | - |\n| 1 | 2 |').kind).toBe('markdown')
    expect(resultView('A heading\n# not a title').kind).toBe('text')
    expect(resultView('Just a sentence with a - dash.').kind).toBe('text')
    expect(resultView('').kind).toBe('text')
  })

  it('shows a small result in the collapsed row, and nothing for a big one', () => {
    expect(inlineAnswer('{\n  "sum": 12\n}')).toBe('sum: 12')
    expect(inlineAnswer('{"a":1,"b":"x","c":true}')).toBe('a: 1, b: x, c: true')
    expect(inlineAnswer('{"a":1,"b":2,"c":3,"d":4}')).toBeNull()
    expect(inlineAnswer('{"nested":{"x":1}}')).toBeNull()
    expect(inlineAnswer('[1,2]')).toBeNull()
    expect(inlineAnswer('{}')).toBeNull()
    expect(inlineAnswer('opened')).toBe('opened')
    expect(inlineAnswer('line one\nline two')).toBeNull()
    expect(inlineAnswer('x'.repeat(61))).toBeNull()
    expect(inlineAnswer('   ')).toBeNull()
  })

  it('splits JSON into pieces that join back into the input', () => {
    const text = JSON.stringify({ name: 'a "quoted" \\ value', n: -1500, ok: true, none: null, list: [1, 'two'], nested: {} }, null, 2)
    const tokens = highlightJson(text)
    expect(tokens.map((token) => token.text).join('')).toBe(text)
    expect(tokens.filter((token) => token.kind === 'key').map((token) => token.text)).toEqual(['"name"', '"n"', '"ok"', '"none"', '"list"', '"nested"'])
    expect(tokens.find((token) => token.text === '-1500')?.kind).toBe('number')
    expect(tokens.find((token) => token.text === 'true')?.kind).toBe('literal')
    expect(tokens.find((token) => token.text === '"two"')?.kind).toBe('string')
    // Whatever is not JSON still joins back.
    expect(highlightJson('not { json ☃').map((token) => token.text).join('')).toBe('not { json ☃')
  })

  it('writes how long a script ran', () => {
    expect(scriptDuration(0)).toBe('0 ms')
    expect(scriptDuration(11)).toBe('11 ms')
    expect(scriptDuration(999.6)).toBe('1000 ms')
    expect(scriptDuration(1234)).toBe('1.2 s')
    expect(scriptDuration(9999)).toBe('10.0 s')
    expect(scriptDuration(45_000)).toBe('45s')
    expect(scriptDuration(90_000)).toBe('1m 30s')
    expect(scriptDuration(-1)).toBe('')
    expect(scriptDuration(Number.NaN)).toBe('')
  })
})

describe('the server list', () => {
  const server = (name: string, status: ChatMcpServer['status']): ChatMcpServer => ({ name, status })

  it('says how the servers stand together, the most pressing first', () => {
    expect(mcpSummary([server('a', 'connected'), server('b', 'connected')])).toMatchObject({ tone: 'ok', label: '2', total: 2, connected: 2 })
    expect(mcpSummary([server('a', 'connected'), server('b', 'disabled')])).toMatchObject({ tone: 'ok', label: '1/2' })
    expect(mcpSummary([server('a', 'disabled'), server('b', 'disabled')])).toMatchObject({ tone: 'idle', label: '0/2' })
    expect(mcpSummary([server('a', 'connected'), server('b', 'connecting')])).toMatchObject({ tone: 'busy', label: '1/2' })
    expect(mcpSummary([server('a', 'connecting'), server('b', 'needs-auth')])).toMatchObject({ tone: 'warn' })
    expect(mcpSummary([server('a', 'needs-auth'), server('b', 'failed')])).toMatchObject({ tone: 'danger' })
    expect(mcpSummary([server('a', 'unknown')]).tone).toBe('idle')
  })

  it('describes the list for a screen reader', () => {
    expect(mcpSummary([server('a', 'connected'), server('b', 'failed'), server('c', 'needs-auth'), server('d', 'disabled'), server('e', 'connecting')]).description)
      .toBe('MCP servers: 1 connected, 1 connecting, 1 failed, 1 needs a sign-in, 1 disabled')
  })

  it('keys a place by the service and the directory', () => {
    expect(mcpKey({ kind: 'native' }, '/home/me/app')).toBe('native\n/home/me/app')
    expect(mcpKey({ kind: 'wsl', distro: 'Ubuntu' }, '/home/me/app')).toBe('wsl:Ubuntu\n/home/me/app')
  })

  it('writes the sign-in command, quoted when the name needs it', () => {
    expect(mcpAuthCommand('linear')).toBe('opencode mcp auth linear')
    expect(mcpAuthCommand('my server')).toBe("opencode mcp auth 'my server'")
    expect(mcpAuthCommand("it's")).toBe("opencode mcp auth 'it'\\''s'")
    expect(mcpAuthCommand('a;rm -rf ~')).toBe("opencode mcp auth 'a;rm -rf ~'")
  })

  it('writes call counts, with a plus when older messages may hold more', () => {
    expect(callCountLabel(1, true)).toBe('1 call')
    expect(callCountLabel(3, true)).toBe('3 calls')
    expect(callCountLabel(3, false)).toBe('3+ calls')
    expect(callCountLabel(1, false)).toBe('1+ calls')
  })
})
