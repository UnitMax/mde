// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMcpRequest, ChatMcpServer, ChatMcpState, ChatMcpSetRequest } from '../src/shared/types'

type Store = typeof import('../src/renderer/store/inbox-mcp').useInboxMcp
type Place = import('../src/renderer/store/inbox-mcp').McpPlace

const server = (name: string, status: ChatMcpServer['status'] = 'connected', error?: string): ChatMcpServer =>
  error ? { name, status, error } : { name, status }
const listed = (...servers: ChatMcpServer[]): ChatMcpState => ({ servers, supported: true })

const place = (directory = '/home/me/app', target: Place['target'] = { kind: 'native' }): Place => ({
  request: { folderId: 'folder_one' },
  target,
  directory,
})
const keyOf = (value: Place): string => `${value.target.kind === 'native' ? 'native' : `wsl:${value.target.distro}`}\n${value.directory}`

/** A promise settled from outside, so a test decides when OpenCode answers. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

let useInboxMcp: Store
let mcp: ReturnType<typeof vi.fn<(request: ChatMcpRequest) => Promise<ChatMcpState>>>
let setMcp: ReturnType<typeof vi.fn<(request: ChatMcpSetRequest) => Promise<void>>>
const unwatch: Array<() => void> = []

async function install(): Promise<void> {
  // The store keeps its watchers, timers and revisions at module level; every test starts from a fresh copy.
  vi.resetModules()
  ;({ useInboxMcp } = await import('../src/renderer/store/inbox-mcp'))
}

function watch(value: Place): void {
  unwatch.push(useInboxMcp.getState().watch(value))
}
const entry = (value: Place) => useInboxMcp.getState().entries[keyOf(value)]

beforeEach(async () => {
  vi.useFakeTimers()
  mcp = vi.fn(async () => listed(server('demo_display'), server('demo_math')))
  setMcp = vi.fn(async () => undefined)
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { mcp, setMcp } } })
  await install()
})

afterEach(() => {
  while (unwatch.length > 0) unwatch.pop()?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reading the MCP servers of a place', () => {
  it('reads the list once, whoever asks, and keeps it for a few seconds', async () => {
    const here = place()
    await Promise.all([useInboxMcp.getState().load(here), useInboxMcp.getState().load(here)])
    expect(mcp).toHaveBeenCalledTimes(1)
    expect(mcp).toHaveBeenCalledWith({ folderId: 'folder_one' })
    expect(entry(here)).toMatchObject({ state: 'ready', names: ['demo_display', 'demo_math'] })

    await useInboxMcp.getState().load(here)
    expect(mcp).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3100)
    await useInboxMcp.getState().load(here)
    expect(mcp).toHaveBeenCalledTimes(2)
    await useInboxMcp.getState().load(here, true)
    expect(mcp).toHaveBeenCalledTimes(3)
  })

  it('keeps one place’s list apart from another’s', async () => {
    const one = place('/home/me/one')
    const two = place('/home/me/two')
    mcp.mockImplementation(async () => listed(server('only_here')))
    await useInboxMcp.getState().load(one)
    expect(entry(one)?.names).toEqual(['only_here'])
    expect(entry(two)).toBeUndefined()
  })

  it('hands out the same names array while the names do not change, so views that use it do not redraw', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    const first = entry(here)!.names
    mcp.mockImplementation(async () => listed(server('demo_display', 'disabled'), server('demo_math')))
    await useInboxMcp.getState().load(here, true)
    expect(entry(here)!.servers[0]?.status).toBe('disabled')
    expect(entry(here)!.names).toBe(first)
    mcp.mockImplementation(async () => listed(server('demo_display'), server('demo_math'), server('third')))
    await useInboxMcp.getState().load(here, true)
    expect(entry(here)!.names).not.toBe(first)
    expect(entry(here)!.names).toEqual(['demo_display', 'demo_math', 'third'])
  })

  it('says unsupported when OpenCode has no MCP list, and shows no servers', async () => {
    const here = place()
    mcp.mockImplementation(async () => ({ servers: [], supported: false }))
    await useInboxMcp.getState().load(here)
    expect(entry(here)).toMatchObject({ state: 'unsupported', servers: [], names: [] })
  })

  it('treats a missing method (an older build, a test stub) as a failed read, not a crash', async () => {
    const here = place()
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: {} } })
    await expect(useInboxMcp.getState().load(here)).resolves.toBeUndefined()
    expect(entry(here)).toMatchObject({ state: 'error', servers: [] })
  })

  it('keeps the list on screen when a later read fails, and reads again on the next request', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    mcp.mockImplementationOnce(async () => { throw new Error('down') })
    await useInboxMcp.getState().load(here, true)
    expect(entry(here)).toMatchObject({ state: 'ready', names: ['demo_display', 'demo_math'] })
    await useInboxMcp.getState().load(here, true)
    expect(entry(here)?.state).toBe('ready')
  })
})

describe('switching a server', () => {
  it('shows the row as busy while OpenCode works, then believes the list OpenCode gives afterwards', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    const change = deferred<void>()
    setMcp.mockImplementation(() => change.promise)
    mcp.mockImplementation(async () => listed(server('demo_display'), server('demo_math', 'disabled')))

    const switching = useInboxMcp.getState().setEnabled(here, 'demo_math', false)
    await vi.advanceTimersByTimeAsync(0)
    expect(entry(here)?.busy).toEqual({ demo_math: 'disconnecting' })
    // The list has not been read again, so nothing claims the final state yet.
    expect(entry(here)?.servers.find((item) => item.name === 'demo_math')?.status).toBe('connected')
    expect(setMcp).toHaveBeenCalledWith({ folderId: 'folder_one', server: 'demo_math', enabled: false })

    change.resolve()
    await switching
    expect(entry(here)?.busy).toEqual({})
    expect(entry(here)?.servers.find((item) => item.name === 'demo_math')?.status).toBe('disabled')
  })

  it('marks a connect as connecting', async () => {
    const here = place()
    mcp.mockImplementation(async () => listed(server('demo_math', 'disabled')))
    await useInboxMcp.getState().load(here)
    const change = deferred<void>()
    setMcp.mockImplementation(() => change.promise)
    const switching = useInboxMcp.getState().setEnabled(here, 'demo_math', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(entry(here)?.busy).toEqual({ demo_math: 'connecting' })
    change.resolve()
    await switching
  })

  it('ignores a second switch of a row that is already busy', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    const change = deferred<void>()
    setMcp.mockImplementation(() => change.promise)
    const first = useInboxMcp.getState().setEnabled(here, 'demo_math', false)
    await vi.advanceTimersByTimeAsync(0)
    await useInboxMcp.getState().setEnabled(here, 'demo_math', true)
    expect(setMcp).toHaveBeenCalledTimes(1)
    change.resolve()
    await first
  })

  it('reports why a switch failed on its row, and still reads the list back', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    setMcp.mockRejectedValueOnce(new Error('Error invoking remote method \'chat:mcp-set\': Error: That MCP server is not configured any more.'))
    await useInboxMcp.getState().setEnabled(here, 'demo_math', false)
    expect(entry(here)?.rowError.demo_math).toBe('That MCP server is not configured any more.')
    expect(entry(here)?.busy).toEqual({})
    expect(mcp).toHaveBeenCalledTimes(2)

    // The next try clears the old complaint.
    const change = deferred<void>()
    setMcp.mockImplementation(() => change.promise)
    const retry = useInboxMcp.getState().setEnabled(here, 'demo_math', false)
    await vi.advanceTimersByTimeAsync(0)
    expect(entry(here)?.rowError.demo_math).toBeUndefined()
    change.resolve()
    await retry
  })

  it('does not let a read that began before the switch put its older answer on screen', async () => {
    const here = place()
    await useInboxMcp.getState().load(here)
    const old = deferred<ChatMcpState>()
    mcp.mockImplementationOnce(() => old.promise)
    // A read is under way when the switch starts.
    const reading = useInboxMcp.getState().load(here, true)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockImplementation(async () => listed(server('demo_display'), server('demo_math', 'disabled')))
    const switching = useInboxMcp.getState().setEnabled(here, 'demo_math', false)
    await vi.advanceTimersByTimeAsync(0)
    // OpenCode answers the old read now, with the state from before the switch.
    old.resolve(listed(server('demo_display'), server('demo_math')))
    await Promise.all([reading, switching])
    expect(entry(here)?.servers.find((item) => item.name === 'demo_math')?.status).toBe('disabled')
    expect(entry(here)?.busy).toEqual({})
  })

  it('tells the other watched places of the same service that a server changed, but not the one it switched in', async () => {
    const one = place('/home/me/one')
    const two = place('/home/me/two')
    watch(one)
    watch(two)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockClear()
    await useInboxMcp.getState().setEnabled(one, 'demo_math', false)
    await vi.advanceTimersByTimeAsync(250)
    // One read for the place that was switched, one for the other place.
    const reads = mcp.mock.calls.length
    expect(reads).toBe(2)
  })
})

describe('keeping the list fresh', () => {
  it('reads again when OpenCode says a server changed, after a short pause that gathers a burst', async () => {
    const here = place()
    watch(here)
    await vi.advanceTimersByTimeAsync(0)
    expect(mcp).toHaveBeenCalledTimes(1)
    mcp.mockImplementation(async () => listed(server('demo_display', 'failed', 'boom'), server('demo_math')))
    useInboxMcp.getState().refreshTarget('native')
    useInboxMcp.getState().refreshTarget('native')
    useInboxMcp.getState().refreshTarget('native')
    await vi.advanceTimersByTimeAsync(100)
    expect(mcp).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(150)
    expect(mcp).toHaveBeenCalledTimes(2)
    expect(entry(here)?.servers[0]).toMatchObject({ name: 'demo_display', status: 'failed', error: 'boom' })
  })

  it('does not read a place of another service', async () => {
    const native = place('/home/me/app', { kind: 'native' })
    const wsl = place('/home/me/app', { kind: 'wsl', distro: 'Ubuntu' })
    watch(native)
    watch(wsl)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockClear()
    useInboxMcp.getState().refreshTarget('wsl:Ubuntu')
    await vi.advanceTimersByTimeAsync(300)
    expect(mcp).toHaveBeenCalledTimes(1)
  })

  it('stops reading a place once nothing watches it', async () => {
    const here = place()
    const stop = useInboxMcp.getState().watch(here)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockClear()
    stop()
    useInboxMcp.getState().refreshTarget('native')
    await vi.advanceTimersByTimeAsync(300)
    expect(mcp).not.toHaveBeenCalled()
  })

  it('keeps reading while a place has another watcher', async () => {
    const here = place()
    const first = useInboxMcp.getState().watch(here)
    watch(here)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockClear()
    first()
    useInboxMcp.getState().refreshTarget('native')
    await vi.advanceTimersByTimeAsync(300)
    expect(mcp).toHaveBeenCalledTimes(1)
  })

  it('looks again while a server is connecting, because the stream of events may be closed, and stops once it is up', async () => {
    const here = place()
    const states = [
      listed(server('demo_math', 'connecting')),
      listed(server('demo_math', 'connecting')),
      listed(server('demo_math', 'connected')),
    ]
    mcp.mockImplementation(async () => states.shift() ?? listed(server('demo_math', 'connected')))
    watch(here)
    await vi.advanceTimersByTimeAsync(0)
    expect(entry(here)?.servers[0]?.status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1500)
    expect(mcp).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect(mcp).toHaveBeenCalledTimes(3)
    expect(entry(here)?.servers[0]?.status).toBe('connected')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mcp).toHaveBeenCalledTimes(3)
  })

  it('gives up on a server that never finishes connecting after a while', async () => {
    const here = place()
    mcp.mockImplementation(async () => listed(server('demo_math', 'connecting')))
    watch(here)
    await vi.advanceTimersByTimeAsync(1500 * 40)
    // The first read plus at most twenty more.
    expect(mcp.mock.calls.length).toBeLessThanOrEqual(21)
    expect(mcp.mock.calls.length).toBeGreaterThan(5)
  })

  it('reads every watched place when the window gets the focus back, at most once in a few seconds', async () => {
    const here = place()
    watch(here)
    await vi.advanceTimersByTimeAsync(0)
    mcp.mockClear()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mcp).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mcp).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5100)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mcp).toHaveBeenCalledTimes(2)
  })
})
