import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeTarget } from '../src/shared/types'
import { OpenCodeServiceClient, type ServiceOperation, type ServiceRequest } from '../src/main/opencode/service/client'
import { BridgeStandby, parseStandbyPlaces } from '../src/main/mcp/standby'

const native: OpenCodeTarget = { kind: 'native' }
const ubuntu: OpenCodeTarget = { kind: 'wsl', distro: 'Ubuntu' }

/** A stand-in OpenCode: the state of each directory's servers, and every switch it was asked for. */
class FakeService {
  readonly statuses = new Map<string, Record<string, string>>()
  readonly calls: string[] = []
  failing = false
  /** Set to hold every answer back until released. */
  gate: Promise<void> | null = null

  set(directory: string, servers: Record<string, string>): void {
    this.statuses.set(directory, servers)
  }

  request = async (_target: OpenCodeTarget, operation: ServiceOperation, request: ServiceRequest = {}): Promise<unknown> => {
    const directory = request.query?.['location[directory]'] ?? ''
    if (this.gate) await this.gate
    if (this.failing) throw new Error('The OpenCode service is not reachable.')
    const servers = this.statuses.get(directory) ?? {}
    if (operation === 'mcp.list') {
      this.calls.push(`list ${directory}`)
      return { data: Object.entries(servers).map(([name, status]) => ({ name, status: { status } })) }
    }
    const server = request.params?.server ?? ''
    if (operation === 'mcp.disconnect') {
      this.calls.push(`disconnect ${server} ${directory}`)
      servers[server] = 'disabled'
      return null
    }
    if (operation === 'mcp.connect') {
      this.calls.push(`connect ${server} ${directory}`)
      servers[server] = 'connected'
      return null
    }
    throw new Error(`Unexpected operation ${operation}`)
  }

  switches(): string[] {
    return this.calls.filter((call) => !call.startsWith('list '))
  }
}

describe('MDE MCP standby', () => {
  let folder: string
  let file: string
  let service: FakeService

  beforeEach(async () => {
    folder = await fs.mkdtemp(join(tmpdir(), 'mde-standby-'))
    file = join(folder, 'mde-mcp-standby.json')
    service = new FakeService()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(folder, { recursive: true, force: true })
  })

  const standby = (owned: (target: OpenCodeTarget) => Promise<boolean> = async () => true) =>
    new BridgeStandby({ file, client: service, owned })

  it('disconnects the server in the directories it used and connects them again at the next start', async () => {
    service.set('/home/me/app', { mde: 'connected', other: 'connected' })
    service.set('/home/me/site', { mde: 'connected' })
    service.set('/home/me/unused', { mde: 'connected' })
    const first = standby()
    first.use(native, '/home/me/app')
    first.use(native, '/home/me/site')
    await first.pause()

    expect(service.switches().sort()).toEqual(['disconnect mde /home/me/app', 'disconnect mde /home/me/site'])
    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'disabled', other: 'connected' })
    expect(service.statuses.get('/home/me/unused')).toEqual({ mde: 'connected' })
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([
      { target: native, directory: '/home/me/app' },
      { target: native, directory: '/home/me/site' },
    ])

    service.calls.length = 0
    await standby().resume()
    expect(service.switches().sort()).toEqual(['connect mde /home/me/app', 'connect mde /home/me/site'])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('leaves alone a server that is not connected, so one switched off by hand stays off', async () => {
    service.set('/home/me/app', { mde: 'disabled' })
    service.set('/home/me/site', { mde: 'failed' })
    service.set('/home/me/none', { other: 'connected' })
    const instance = standby()
    for (const directory of ['/home/me/app', '/home/me/site', '/home/me/none']) instance.use(native, directory)
    await instance.pause()

    expect(service.switches()).toEqual([])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('stops nothing where the configured server is another copy of MDE', async () => {
    service.set('/home/me/app', { mde: 'connected' })
    service.set('/mnt/c/app', { mde: 'connected' })
    const owned = vi.fn(async (target: OpenCodeTarget) => target.kind === 'wsl')
    const instance = standby(owned)
    instance.use(native, '/home/me/app')
    instance.use(native, '/home/me/app')
    instance.use(ubuntu, '/mnt/c/app')
    await instance.pause()

    expect(service.switches()).toEqual(['disconnect mde /mnt/c/app'])
    // Asked once per target, when the target is first used.
    expect(owned).toHaveBeenCalledTimes(2)
  })

  it('asks again whose server it is after the configuration changed', async () => {
    service.set('/home/me/app', { mde: 'connected' })
    let installed = false
    const instance = standby(async () => installed)
    instance.use(native, '/home/me/app')
    installed = true
    instance.refresh()
    await instance.pause()

    expect(service.switches()).toEqual(['disconnect mde /home/me/app'])
  })

  it('treats a failed ownership check as not owned', async () => {
    service.set('/home/me/app', { mde: 'connected' })
    const instance = standby(async () => { throw new Error('WSL is not running') })
    instance.use(native, '/home/me/app')
    await instance.pause()

    expect(service.switches()).toEqual([])
  })

  it('writes the directories down before it stops anything', async () => {
    service.set('/home/me/app', { mde: 'connected' })
    const instance = standby()
    instance.use(native, '/home/me/app')
    const original = service.request
    let written: string | null = null
    service.request = async (target, operation, request) => {
      if (operation === 'mcp.disconnect') written = await fs.readFile(file, 'utf8')
      return original(target, operation, request)
    }
    await instance.pause()

    expect(parseStandbyPlaces(written ?? '')).toEqual([{ target: native, directory: '/home/me/app' }])
  })

  it('does not hold quitting up when OpenCode does not answer', async () => {
    service.set('/home/me/app', { mde: 'connected' })
    let release = (): void => {}
    service.gate = new Promise((resolve) => { release = resolve })
    const instance = standby()
    instance.use(native, '/home/me/app')
    const started = Date.now()
    await instance.pause(50)

    expect(Date.now() - started).toBeLessThan(1000)
    expect(service.switches()).toEqual([])
    release()
  })

  it('goes on quitting when OpenCode is not running', async () => {
    service.failing = true
    const instance = standby()
    instance.use(native, '/home/me/app')
    await expect(instance.pause()).resolves.toBeUndefined()
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('does not connect a server that is no longer disabled, as after an OpenCode restart', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [
      { target: native, directory: '/home/me/app' },
      { target: native, directory: '/home/me/fresh' },
    ] }))
    service.set('/home/me/app', { mde: 'connected' })
    await standby().resume()

    expect(service.switches()).toEqual([])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('keeps a directory it could not ask about for the next start, and for the next quit', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    service.set('/home/me/site', { mde: 'connected' })
    service.failing = true
    const instance = standby()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await instance.resume()
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([{ target: native, directory: '/home/me/app' }])

    service.failing = false
    instance.use(native, '/home/me/site')
    await instance.pause()
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([
      { target: native, directory: '/home/me/app' },
      { target: native, directory: '/home/me/site' },
    ])

    service.calls.length = 0
    await standby().resume()
    expect(service.switches().sort()).toEqual(['connect mde /home/me/app', 'connect mde /home/me/site'])
  })

  it('stops a reconnected bridge again at the next quit', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: ubuntu, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const instance = standby()
    await instance.resume()
    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'connected' })
    await instance.pause()

    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'disabled' })
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([{ target: ubuntu, directory: '/home/me/app' }])
  })

  it('reads only well-formed places from the file', () => {
    expect(parseStandbyPlaces('not json')).toEqual([])
    expect(parseStandbyPlaces('{"places":"no"}')).toEqual([])
    expect(parseStandbyPlaces(JSON.stringify({ places: [
      null,
      { target: { kind: 'native' }, directory: '' },
      { target: { kind: 'wsl' }, directory: '/home/me/app' },
      { target: { kind: 'other' }, directory: '/home/me/app' },
      { target: { kind: 'wsl', distro: 'Ubuntu', extra: 1 }, directory: '/home/me/app' },
      { target: { kind: 'wsl', distro: 'Ubuntu' }, directory: '/home/me/app' },
    ] }))).toEqual([{ target: ubuntu, directory: '/home/me/app' }])
  })
})

describe('OpenCode service client directories', () => {
  it('reports the directory a request names, and nothing for a request without one', async () => {
    const seen: string[] = []
    const client = new OpenCodeServiceClient({
      discover: async () => ({ url: 'http://127.0.0.1:49411', password: 'secret' }),
      executable: () => 'opencode',
      onDirectory: (target, directory) => seen.push(`${target.kind} ${directory}`),
      fetch: (async () => new Response('{"data":[]}', { status: 200 })) as typeof fetch,
    })
    await client.request(native, 'mcp.list', { query: { 'location[directory]': '/home/me/app' } })
    await client.request(native, 'mcp.list')

    expect(seen).toEqual(['native /home/me/app'])
  })
})
