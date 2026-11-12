import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MDE_MCP_ALLOW_COMMANDS_MS, type AgentTerminalOpenRequest } from '../src/shared/mde-mcp'
import {
  AGENT_TERMINAL_CLAIM_TIMEOUT_MS,
  AGENT_TERMINAL_PENDING_LIMIT,
  AgentTerminals,
  type AgentTerminalHost,
  type AgentTerminalOpening,
} from '../src/main/mcp/agent-terminals'

const palette = { foreground: '#ffffff', background: '#000000' }
const opening: AgentTerminalOpening = {
  target: { kind: 'native' },
  directory: '/home/me/app',
  title: 'Dev server',
  command: 'npm run dev',
  from: 'Fix login',
}

let folder: string

beforeEach(async () => {
  folder = await fs.mkdtemp(join(tmpdir(), 'mde-agent-terminals-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(folder, { recursive: true, force: true })
})

function setup(options: { window?: boolean; start?: (terminalId: string) => Promise<void> } = {}) {
  let now = 1_000_000
  const sent: AgentTerminalOpenRequest[] = []
  const ran: [string, string][] = []
  const started: string[] = []
  const host: AgentTerminalHost = {
    send: (request) => {
      if (options.window === false) return false
      sent.push(request)
      return true
    },
    start: async (terminalId) => {
      started.push(terminalId)
      await options.start?.(terminalId)
    },
    run: (terminalId, command) => { ran.push([terminalId, command]) },
    now: () => now,
  }
  const terminals = new AgentTerminals(folder)
  terminals.attach(host)
  /** Lets the open's settings load, so the request reaches the window. */
  const opened = async (value: AgentTerminalOpening = opening) => {
    const result = terminals.open(value)
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    return result
  }
  return { terminals, sent, ran, started, opened, advance: (ms: number) => { now += ms } }
}

describe('AgentTerminals', () => {
  it('asks the window for a pane, starts its shell and keeps the command for approval by default', async () => {
    const { terminals, sent, ran, started, opened } = setup()
    const result = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ title: 'Dev server', command: 'npm run dev', approval: true, from: 'Fix login' })
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'inbox-terminal:tab:default:pane:2', palette })
    await expect(result).resolves.toEqual({ terminalId: 'inbox-terminal:tab:default:pane:2', command: 'waiting' })
    expect(started).toEqual(['inbox-terminal:tab:default:pane:2'])
    expect(ran).toEqual([])
    expect(terminals.waiting('inbox-terminal:tab:default:pane:2')).toBe('npm run dev')

    terminals.decide({ terminalId: 'inbox-terminal:tab:default:pane:2', decision: 'run' })
    expect(ran).toEqual([['inbox-terminal:tab:default:pane:2', 'npm run dev']])
    // Answered once: a second answer, or one for a pane with nothing waiting, runs nothing.
    terminals.decide({ terminalId: 'inbox-terminal:tab:default:pane:2', decision: 'run' })
    terminals.decide({ terminalId: 'inbox-terminal:tab:default:pane:9', decision: 'run' })
    expect(ran).toHaveLength(1)
  })

  it('drops a command the person declines, or one whose pane closed', async () => {
    const { terminals, sent, ran, opened } = setup()
    const first = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await first
    terminals.decide({ terminalId: 'p1', decision: 'cancel' })
    terminals.decide({ terminalId: 'p1', decision: 'run' })

    const second = terminals.open(opening)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    await terminals.claim({ requestId: sent[1]!.requestId, terminalId: 'p2', palette })
    await second
    terminals.forget('p2')
    terminals.decide({ terminalId: 'p2', decision: 'run' })
    expect(ran).toEqual([])
  })

  it('runs commands without asking for an hour after "Run, and allow for an hour", then asks again', async () => {
    const { terminals, sent, ran, opened, advance } = setup()
    const first = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await first
    terminals.decide({ terminalId: 'p1', decision: 'run-for-hour' })
    expect(ran).toEqual([['p1', 'npm run dev']])
    expect((await terminals.settings()).allowedUntil).toBe(1_000_000 + MDE_MCP_ALLOW_COMMANDS_MS)

    const second = terminals.open({ ...opening, command: 'npm test' })
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]?.approval).toBe(false)
    await terminals.claim({ requestId: sent[1]!.requestId, terminalId: 'p2', palette })
    await expect(second).resolves.toMatchObject({ command: 'running' })
    expect(ran.at(-1)).toEqual(['p2', 'npm test'])

    advance(MDE_MCP_ALLOW_COMMANDS_MS)
    expect((await terminals.settings()).allowedUntil).toBeNull()
    const third = terminals.open(opening)
    await vi.waitFor(() => expect(sent).toHaveLength(3))
    expect(sent[2]?.approval).toBe(true)
    await terminals.claim({ requestId: sent[2]!.requestId, terminalId: 'p3', palette })
    await expect(third).resolves.toMatchObject({ command: 'waiting' })
  })

  it('applies a stricter setting made while the window was adding the pane', async () => {
    const { terminals, sent, ran, opened } = setup()
    await terminals.setSettings({ commands: 'run' })
    const result = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.approval).toBe(false)
    await terminals.setSettings({ commands: 'ask' })
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await expect(result).resolves.toMatchObject({ command: 'waiting' })
    expect(ran).toEqual([])
  })

  it('runs at once when the person chose to run without asking, and keeps that choice', async () => {
    const { terminals, sent, ran, opened } = setup()
    await terminals.setSettings({ commands: 'run' })
    const result = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await expect(result).resolves.toMatchObject({ command: 'running' })
    expect(ran).toEqual([['p1', 'npm run dev']])
    expect(JSON.parse(await fs.readFile(join(folder, 'mde-mcp.json'), 'utf8'))).toEqual({ terminalCommands: 'run' })
    expect((await new AgentTerminals(folder).settings()).commands).toBe('run')
  })

  it('revokes the hour from the settings, and ignores an unreadable settings file', async () => {
    await fs.writeFile(join(folder, 'mde-mcp.json'), '{ not json')
    const { terminals, sent, opened } = setup()
    expect(await terminals.settings()).toEqual({ commands: 'ask', allowedUntil: null })
    const result = opened()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await result
    terminals.decide({ terminalId: 'p1', decision: 'run-for-hour' })
    expect((await terminals.settings()).allowedUntil).not.toBeNull()
    expect(await terminals.setSettings({ commands: 'ask', allowedUntil: null })).toEqual({ commands: 'ask', allowedUntil: null })
  })

  it('opens an empty shell without anything to approve', async () => {
    const { terminals, sent, ran, opened } = setup()
    const result = opened({ ...opening, command: null })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.approval).toBe(false)
    await terminals.claim({ requestId: sent[0]!.requestId, terminalId: 'p1', palette })
    await expect(result).resolves.toMatchObject({ command: 'none' })
    expect(ran).toEqual([])
  })

  it('tells the agent why when the window refuses, the shell cannot start, or nobody answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { terminals, sent } = setup({ start: async () => { throw new Error('The terminal cannot start in /gone.') } })
    const refused = terminals.open(opening)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    terminals.refuse({ requestId: sent[0]!.requestId, reason: 'No room for another pane.' })
    await expect(refused).rejects.toThrow('No room for another pane.')

    const failed = terminals.open(opening)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    await expect(terminals.claim({ requestId: sent[1]!.requestId, terminalId: 'p1', palette })).rejects.toThrow('/gone')
    await expect(failed).rejects.toThrow('/gone')
    expect(terminals.waiting('p1')).toBeUndefined()

    const unanswered = terminals.open(opening)
    await vi.waitFor(() => expect(sent).toHaveLength(3))
    const check = expect(unanswered).rejects.toThrow('did not open the terminal')
    vi.advanceTimersByTime(AGENT_TERMINAL_CLAIM_TIMEOUT_MS)
    await check
    // A late answer no longer starts anything.
    await expect(terminals.claim({ requestId: sent[2]!.requestId, terminalId: 'p2', palette })).rejects.toThrow('no longer waiting')
  })

  it('refuses without a window, and when too many requests wait', async () => {
    await expect(setup({ window: false }).terminals.open(opening)).rejects.toThrow('no window')
    const { terminals, sent } = setup()
    const waiting = Array.from({ length: AGENT_TERMINAL_PENDING_LIMIT }, () => terminals.open(opening))
    await vi.waitFor(() => expect(sent).toHaveLength(AGENT_TERMINAL_PENDING_LIMIT))
    await expect(terminals.open(opening)).rejects.toThrow('still opening')
    for (const request of sent) terminals.refuse({ requestId: request.requestId, reason: 'no' })
    await Promise.allSettled(waiting)
  })
})
