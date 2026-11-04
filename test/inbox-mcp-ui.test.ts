// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMessagesPage } from '../src/main/opencode/service/parse'
import { McpCallView } from '../src/renderer/components/inbox/ChatMcpCall'
import { ToolCallView } from '../src/renderer/components/inbox/ChatMessageView'
import { McpChip } from '../src/renderer/components/inbox/McpChip'
import { McpServerNamesContext } from '../src/renderer/components/inbox/mcp-context'
import { mcpCalls } from '../src/renderer/lib/mcp'
import { useInboxMcp } from '../src/renderer/store/inbox-mcp'
import type { ChatMcpServer, ChatMcpSetRequest, ChatMcpState, ChatMessage, ChatPart } from '../src/shared/types'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/opencode-chat', name), 'utf8'))
const { messages: FIXTURE_MESSAGES } = parseMessagesPage(fixture('messages-mcp.json'), false, 100)
const PARTS = new Map<string, ToolPart>()
for (const message of FIXTURE_MESSAGES) {
  if (message.kind !== 'assistant') continue
  for (const part of message.parts) if (part.kind === 'tool') PARTS.set(part.id, part)
}
const part = (id: string): ToolPart => {
  const found = PARTS.get(id)
  if (!found) throw new Error(`No fixture part ${id}`)
  return found
}

let dispose: (() => void) | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  await act(async () => dispose?.())
  dispose = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(element))
  return container
}

const q = (selector: string, root: ParentNode = document.body): HTMLElement | null => root.querySelector<HTMLElement>(selector)
const all = (selector: string, root: ParentNode = document.body): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector))
const text = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
const click = (element: HTMLElement | null) => act(async () => { element?.click() })

// ---------------------------------------------------------------------------------------------
// The chip and its popover
// ---------------------------------------------------------------------------------------------

describe('the MCP chip', () => {
  let servers: ChatMcpServer[]
  let mcp: ReturnType<typeof vi.fn<() => Promise<ChatMcpState>>>
  let setMcp: ReturnType<typeof vi.fn<(request: ChatMcpSetRequest) => Promise<void>>>
  let counter = 0

  const server = (name: string, status: ChatMcpServer['status'] = 'connected', error?: string): ChatMcpServer =>
    error ? { name, status, error } : { name, status }

  beforeEach(() => {
    servers = [server('demo_display'), server('demo_math')]
    mcp = vi.fn(async () => ({ servers, supported: true }))
    // Like OpenCode: the change is made, and the list afterwards says so.
    setMcp = vi.fn(async (request: ChatMcpSetRequest) => {
      servers = servers.map((item) => (item.name === request.server ? { ...item, status: request.enabled ? 'connected' : 'disabled' } : item))
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: { mcp, setMcp } } })
  })

  async function chip(props: Partial<ComponentProps<typeof McpChip>> = {}): Promise<HTMLElement> {
    // The store is shared by the whole file; each test has a place of its own.
    counter += 1
    useInboxMcp.setState({ entries: {} })
    const place = { request: { folderId: 'folder_one' }, target: { kind: 'native' as const }, directory: `/home/me/app-${counter}` }
    return mount(createElement(McpChip, { place, ...props }))
  }
  const trigger = (): HTMLElement => q('[data-testid="chat-mcp-chip"]')!
  const open = () => act(async () => { trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  const row = (name: string): HTMLElement | null => q(`[data-testid="chat-mcp-server-${name}"]`)

  it('is not there while OpenCode has no MCP server for the place, and not when the list cannot be read', async () => {
    servers = []
    const empty = await chip()
    expect(q('[data-testid="chat-mcp-chip"]', empty)).toBeNull()
    expect(empty.textContent).toBe('')

    mcp.mockImplementation(async () => ({ servers: [], supported: false }))
    const unsupported = await chip()
    expect(q('[data-testid="chat-mcp-chip"]', unsupported)).toBeNull()

    Object.defineProperty(window, 'api', { configurable: true, value: { chat: {} } })
    const missing = await chip()
    expect(q('[data-testid="chat-mcp-chip"]', missing)).toBeNull()
  })

  it('counts the connected servers and says so to a screen reader', async () => {
    await chip()
    expect(trigger().getAttribute('aria-label')).toBe('MCP servers: 2 connected')
    expect(trigger().getAttribute('data-tone')).toBe('ok')
    expect(text(trigger())).toContain('MCP')
    expect(text(trigger())).toContain('2')
  })

  it('shows connected out of all when some are switched off', async () => {
    servers = [server('demo_display', 'disabled'), server('demo_math')]
    await chip()
    expect(text(trigger())).toContain('1/2')
    expect(trigger().getAttribute('aria-label')).toBe('MCP servers: 1 connected, 1 disabled')
  })

  it('lists the servers as switches, each saying how it stands, after reading the list again on open', async () => {
    await chip()
    expect(mcp).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="chat-mcp-menu"]')).toBeNull()
    await open()
    expect(mcp).toHaveBeenCalledTimes(2)
    const rows = all('[role="menuitemcheckbox"]')
    expect(rows.map((item) => item.getAttribute('data-testid'))).toEqual(['chat-mcp-server-demo_display', 'chat-mcp-server-demo_math'])
    expect(rows.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    expect(text(row('demo_math'))).toContain('Connected')
    expect(text(q('[data-testid="chat-mcp-menu"]'))).toContain('Changes last until OpenCode restarts. Your configuration is not changed.')
  })

  it('disconnects a server when its switch is turned off, keeps the menu open, and reconnects it when turned on again', async () => {
    await chip()
    await open()
    await click(row('demo_math'))
    expect(setMcp).toHaveBeenCalledWith({ folderId: 'folder_one', server: 'demo_math', enabled: false })
    expect(q('[data-testid="chat-mcp-menu"]')).not.toBeNull()
    expect(row('demo_math')?.getAttribute('aria-checked')).toBe('false')
    expect(text(row('demo_math'))).toContain('Disabled')
    expect(row('demo_display')?.getAttribute('aria-checked')).toBe('true')
    expect(text(trigger())).toContain('1/2')
    expect(text(q('[role="status"]'))).toBe('demo_math: Disabled')

    await click(row('demo_math'))
    expect(setMcp).toHaveBeenLastCalledWith({ folderId: 'folder_one', server: 'demo_math', enabled: true })
    expect(row('demo_math')?.getAttribute('aria-checked')).toBe('true')
    expect(text(row('demo_math'))).toContain('Connected')
    expect(text(q('[role="status"]'))).toBe('demo_math: Connected')
  })

  it('shows a row as working, and not switchable, until OpenCode has answered', async () => {
    await chip()
    await open()
    let finish!: () => void
    setMcp.mockImplementationOnce(() => new Promise<void>((done) => { finish = done }))
    await click(row('demo_math'))
    expect(text(row('demo_math'))).toContain('Disconnecting…')
    expect(row('demo_math')?.getAttribute('aria-disabled')).toBe('true')
    expect(trigger().getAttribute('data-tone')).toBe('busy')
    // Another server can still be switched meanwhile.
    expect(row('demo_display')?.getAttribute('aria-disabled')).toBeNull()
    await click(row('demo_math'))
    expect(setMcp).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(text(row('demo_math'))).not.toContain('Disconnecting')
  })

  it('says on the row why a switch failed', async () => {
    await chip()
    await open()
    setMcp.mockRejectedValueOnce(new Error('Error invoking remote method \'chat:mcp-set\': Error: This OpenCode cannot turn MCP servers on or off. Update OpenCode.'))
    await click(row('demo_math'))
    expect(text(q('[role="alert"]', row('demo_math')!))).toBe('This OpenCode cannot turn MCP servers on or off. Update OpenCode.')
    // The list was read back, and it did not change.
    expect(row('demo_math')?.getAttribute('aria-checked')).toBe('true')
  })

  it('shows a failed server with its reason, a warning mark, and a switch that tries again', async () => {
    servers = [server('demo_math'), server('broken', 'failed', 'spawn broken ENOENT')]
    await chip()
    expect(trigger().getAttribute('data-tone')).toBe('danger')
    expect(trigger().getAttribute('aria-label')).toContain('1 failed')
    expect(trigger().querySelector('svg.lucide-triangle-alert, svg.lucide-alert-triangle')).not.toBeNull()
    await open()
    expect(text(row('broken'))).toContain('Failed')
    expect(text(row('broken'))).toContain('spawn broken ENOENT')
    expect(row('broken')?.getAttribute('aria-checked')).toBe('false')
    await click(row('broken'))
    expect(setMcp).toHaveBeenCalledWith({ folderId: 'folder_one', server: 'broken', enabled: true })
  })

  it('leaves a server that needs a sign-in alone, and says how to sign in, without a switch', async () => {
    servers = [server('demo_math'), server('linear', 'needs-auth')]
    await chip()
    expect(trigger().getAttribute('data-tone')).toBe('warn')
    expect(trigger().getAttribute('aria-label')).toContain('1 needs a sign-in')
    await open()
    const linear = row('linear')!
    expect(linear.getAttribute('role')).toBe('menuitem')
    expect(text(linear)).toContain('Sign-in needed')
    expect(text(linear)).toContain('opencode mcp auth linear')
    expect(linear.getAttribute('aria-disabled')).toBeNull()
    await click(linear)
    expect(setMcp).not.toHaveBeenCalled()
    expect(q('[data-testid="chat-mcp-menu"]')).not.toBeNull()
  })

  it('quotes a server name in the sign-in command when it needs it', async () => {
    servers = [server('my server', 'needs-auth')]
    await chip()
    await open()
    expect(text(row('my server'))).toContain("opencode mcp auth 'my server'")
  })

  it('does not touch a server whose state it does not know', async () => {
    servers = [server('demo_math'), server('odd', 'unknown')]
    await chip()
    await open()
    expect(row('odd')?.getAttribute('role')).toBe('menuitem')
    expect(text(row('odd'))).toContain('leaves it alone')
    await click(row('odd'))
    expect(setMcp).not.toHaveBeenCalled()
  })

  it('shows the list but does not switch it when it is not the list the thread will run in', async () => {
    await chip({ readOnly: true })
    await open()
    expect(row('demo_math')?.getAttribute('aria-disabled')).toBe('true')
    await click(row('demo_math'))
    expect(setMcp).not.toHaveBeenCalled()
    expect(text(q('[data-testid="chat-mcp-menu"]'))).toContain('A new worktree loads its own servers')
  })

  it('says that a change applies from the agent’s next step while it is working', async () => {
    await chip({ running: true })
    await open()
    expect(text(q('[data-testid="chat-mcp-menu"]'))).toContain('The agent is working; changes apply from its next step.')
    await click(row('demo_math'))
    expect(setMcp).toHaveBeenCalledTimes(1)
  })

  describe('with the conversation', () => {
    const shown = FIXTURE_MESSAGES as ChatMessage[]

    it('counts each server’s calls', async () => {
      await chip({ messages: shown, complete: true })
      await open()
      expect(text(row('demo_math'))).toContain('Connected · 4 calls')
      expect(text(row('demo_display'))).toContain('Connected · 3 calls')
    })

    it('says "or more" when older messages that are not loaded may hold more', async () => {
      await chip({ messages: shown, complete: false })
      await open()
      expect(text(row('demo_math'))).toContain('4+ calls')
    })

    it('writes no count for a server that was never called', async () => {
      servers = [server('demo_math'), server('quiet')]
      await chip({ messages: shown, complete: true })
      await open()
      expect(text(row('quiet'))).toBe('quietConnected')
    })

    it('writes no counts on the new-thread page, where there is no conversation', async () => {
      await chip()
      await open()
      expect(text(row('demo_math'))).not.toContain('call')
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The card for a script's calls
// ---------------------------------------------------------------------------------------------

describe('the card for MCP calls', () => {
  const KNOWN = ['demo_display', 'demo_math']
  const card = async (id: string, servers: readonly string[] = KNOWN): Promise<HTMLElement> => {
    const source = part(id)
    return mount(createElement(McpCallView, { part: source, calls: mcpCalls(source, servers) }))
  }
  const header = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('button[aria-expanded]')!
  const expand = (container: HTMLElement) => click(header(container))

  it('reads a single call as one line: the server, the tool, its arguments, the answer and the time', async () => {
    const container = await card('call_one')
    const line = text(header(container))
    expect(line).toContain('demo_math')
    expect(line).toContain('add')
    expect(line).toContain('a: 7, b: 5')
    expect(line).toContain('→ sum: 12')
    expect(line).toContain('11 ms')
    expect(q('[data-kind="mcp"]', container)).not.toBeNull()
    expect(header(container).getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-testid="chat-mcp-call"]', container)).toBeNull()
    expect(q('[data-testid="chat-mcp-result"]', container)).toBeNull()
  })

  it('opens to the arguments and the result as JSON, with the script behind a button of its own', async () => {
    const container = await card('call_one')
    await expand(container)
    expect(header(container).getAttribute('aria-expanded')).toBe('true')
    expect(all('[data-testid="chat-mcp-call"]', container)).toHaveLength(1)
    const args = q('dl', container)!
    expect(all('dt', args).map(text)).toEqual(['a', 'b'])
    expect(all('dd', args).map(text)).toEqual(['7', '5'])
    const result = q('[data-testid="chat-mcp-result"]', container)!
    expect(result.getAttribute('data-kind')).toBe('json')
    expect(text(result)).toContain('"sum": 12')
    // JSON is coloured piece by piece, from text nodes only.
    expect(text(q('.text-syntax-property', result))).toBe('"sum"')
    expect(result.querySelector('script, img, iframe')).toBeNull()

    expect(q('[data-testid="chat-mcp-script"]', container)).toBeNull()
    const script = all('button', container).find((button) => text(button) === 'Script')!
    await click(script)
    expect(text(q('[data-testid="chat-mcp-script"]', container))).toContain('tools.demo_math.add')
  })

  it('reads several calls as a count and the servers they went to', async () => {
    const container = await card('call_two')
    const line = text(header(container))
    expect(line).toContain('Called 2 tools')
    expect(line).toContain('demo_display, demo_math')
    expect(line).toContain('640 ms')
    expect(line).not.toContain('→')
    await expand(container)
    expect(all('[data-testid="chat-mcp-call"]', container)).toHaveLength(2)
  })

  it('shows Markdown in a result as Markdown, and only once the card is open', async () => {
    const container = await card('call_two')
    expect(q('h1', container)).toBeNull()
    await expand(container)
    expect(q('[data-testid="chat-mcp-result"]', container)?.getAttribute('data-kind')).toBe('markdown')
    expect(text(q('h1', container))).toBe('Local MCP display demo')
    expect(text(q('strong', container))).toBe('bold')
  })

  it('shows a call that is still running without an answer or a time', async () => {
    const container = await card('call_running')
    const line = text(header(container))
    expect(line).toContain('demo_display')
    expect(line).toContain('sample')
    expect(line).not.toContain('→')
    expect(line).not.toMatch(/\d+ (ms|s)\b/)
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
  })

  it('shows a failed call in the colour of an error, with the reason in the row and in a block of its own', async () => {
    const container = await card('call_error')
    expect(header(container).className).toContain('text-danger')
    expect(text(header(container))).toContain('demo_display.sample failed')
    await expand(container)
    const blocks = all('p', container).map((block) => text(block))
    expect(blocks).toContain('Error')
    expect(all('pre', container).some((block) => text(block).includes('demo_display.sample failed'))).toBe(true)
  })

  it('marks a call to one of OpenCode’s own tool groups with a neutral badge, not as an MCP server', async () => {
    const container = await card('call_browser')
    const badge = q('[data-kind]', container)!
    expect(badge.getAttribute('data-kind')).toBe('builtin')
    expect(badge.getAttribute('title')).toBe('OpenCode tools: browser')
    expect(text(badge)).toBe('browser')
    expect(text(header(container))).toContain('→ opened')
  })

  it('looks the same before the server list has loaded, except that it cannot tell the servers from OpenCode’s tools', async () => {
    const container = await card('call_one', [])
    expect(text(header(container))).toContain('add')
    expect(q('[data-kind]', container)?.getAttribute('data-kind')).toBe('builtin')
    expect(text(q('[data-kind]', container))).toBe('demo_math')
  })

  it('says when OpenCode shortened the output', async () => {
    const container = await card('call_cut')
    await expand(container)
    expect(text(container)).toContain('Shortened; the full text is in OpenCode.')
  })

  it('cuts a long result after a dozen lines, and shows the rest on request', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `row ${index + 1}`).join('\n')
    const source: ToolPart = { ...part('call_one'), id: 'call_long', output: lines }
    const container = await mount(createElement(McpCallView, { part: source, calls: mcpCalls(source, KNOWN) }))
    await expand(container)
    const result = q('[data-testid="chat-mcp-result"]', container)!
    expect(result.getAttribute('data-kind')).toBe('text')
    expect(text(q('pre', result))).toContain('row 12')
    expect(text(q('pre', result))).not.toContain('row 13')
    const more = all('button', container).find((button) => text(button) === 'Show 18 more lines')!
    await click(more)
    expect(text(q('pre', result))).toContain('row 30')
    expect(all('button', container).some((button) => text(button).startsWith('Show '))).toBe(false)
  })

  it('does not interpret HTML in a result', async () => {
    const source: ToolPart = { ...part('call_one'), id: 'call_html', output: '<img src="x" onerror="alert(1)"><script>alert(1)</script>' }
    const container = await mount(createElement(McpCallView, { part: source, calls: mcpCalls(source, KNOWN) }))
    await expand(container)
    expect(container.querySelector('img, script')).toBeNull()
    expect(text(q('[data-testid="chat-mcp-result"]', container))).toContain('<img src="x"')
  })
})

describe('a tool part in the conversation', () => {
  const view = (id: string, servers?: readonly string[]) => {
    const element = createElement(ToolCallView, { part: part(id), directory: '/home/me/app' })
    return mount(servers ? createElement(McpServerNamesContext.Provider, { value: servers }, element) : element)
  }

  it('gets the card for a script’s calls, with or without the server list', async () => {
    const withServers = await view('call_one', ['demo_math'])
    expect(q('[data-mcp-calls="1"]', withServers)).not.toBeNull()
    expect(q('[data-kind="mcp"]', withServers)).not.toBeNull()
    await act(async () => dispose?.())
    document.body.innerHTML = ''
    const without = await view('call_one')
    expect(q('[data-mcp-calls="1"]', without)).not.toBeNull()
  })

  it('keeps the plain row for a script that has not called anything yet, and for the search of a server’s tools', async () => {
    const pending = await view('call_stream', ['demo_math'])
    expect(q('[data-mcp-calls]', pending)).toBeNull()
    expect(text(q('[data-testid="chat-tool-call_stream"]', pending))).toContain('Running a script')
    await act(async () => dispose?.())
    document.body.innerHTML = ''
    const search = await view('call_search', ['demo_math'])
    expect(q('[data-mcp-calls]', search)).toBeNull()
    expect(text(q('[data-testid="chat-tool-call_search"]', search))).toContain('Looked up demo_math tools')
  })
})
