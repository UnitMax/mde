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
  let changed: OpenCodeTarget[]

  beforeEach(async () => {
    changed = []
    folder = await fs.mkdtemp(join(tmpdir(), 'mde-standby-'))
    file = join(folder, 'mde-mcp-standby.json')
    service = new FakeService()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(folder, { recursive: true, force: true })
  })

  const standby = (owned: (target: OpenCodeTarget) => Promise<boolean> = async () => true) =>
    new BridgeStandby({ file, client: service, owned, changed: (target) => changed.push(target), sleep: async () => {} })

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

  it('does not connect a server that is connected already, as after an OpenCode restart, or that is gone', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [
      { target: native, directory: '/home/me/app' },
      { target: native, directory: '/home/me/removed' },
    ] }))
    service.set('/home/me/app', { mde: 'connected' })
    service.set('/home/me/removed', { other: 'connected' })
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

  it('connects a server that failed while MDE was closed, and tells the app', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: ubuntu, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'failed' })
    await standby().resume()

    expect(service.switches()).toEqual(['connect mde /home/me/app'])
    expect(changed).toEqual([ubuntu])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('does not ask about or connect a directory whose server is no longer this MDE, and forgets it', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    await standby(async () => false).resume()

    expect(service.calls).toEqual([])
    expect(changed).toEqual([])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('does not ask about or connect anything while the configuration cannot be read, and keeps the directory', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const owned = vi.fn(async () => { throw new Error('OpenCode’s configuration cannot be read.') })
    await standby(owned).resume()

    expect(service.calls).toEqual([])
    expect(owned.mock.calls.length).toBeGreaterThan(1)
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([{ target: native, directory: '/home/me/app' }])
  })

  it('asks again whose server it is before every try, and stops once it is not this MDE', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const original = service.request
    let ours = true
    service.request = async (target, operation, request) => {
      if (operation === 'mcp.list') {
        // The first look fails; before the next try the entry is pointed somewhere else.
        ours = false
        service.calls.push('list /home/me/app')
        throw new Error('The OpenCode service is not reachable.')
      }
      return original(target, operation, request)
    }
    await standby(async () => ours).resume()

    expect(service.calls).toEqual(['list /home/me/app'])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('tries again when a connect does not take, and when OpenCode does not answer at first', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const original = service.request
    let lists = 0
    let connects = 0
    service.request = async (target, operation, request) => {
      if (operation === 'mcp.list' && ++lists === 1) throw new Error('The OpenCode service is not reachable.')
      if (operation === 'mcp.connect' && ++connects === 1) {
        service.calls.push('connect mde /home/me/app')
        service.statuses.get('/home/me/app')!.mde = 'failed'
        return null
      }
      return original(target, operation, request)
    }
    await standby().resume()

    expect(service.switches()).toEqual(['connect mde /home/me/app', 'connect mde /home/me/app'])
    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'connected' })
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('waits for a server that is still connecting', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const original = service.request
    let afterConnect = 0
    service.request = async (target, operation, request) => {
      const answer = await original(target, operation, request)
      if (operation === 'mcp.connect') service.statuses.get('/home/me/app')!.mde = 'pending'
      if (operation === 'mcp.list' && service.statuses.get('/home/me/app')!.mde === 'pending' && ++afterConnect === 3) service.statuses.get('/home/me/app')!.mde = 'connected'
      return answer
    }
    await standby().resume()

    expect(service.switches()).toEqual(['connect mde /home/me/app'])
    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'connected' })
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('keeps a directory whose server would not connect for the next start', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    const original = service.request
    service.request = async (target, operation, request) => {
      const answer = await original(target, operation, request)
      if (operation === 'mcp.connect') service.statuses.get('/home/me/app')!.mde = 'failed'
      return answer
    }
    await standby().resume()

    expect(service.switches()).toHaveLength(4)
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([{ target: native, directory: '/home/me/app' }])
  })

  it('stops trying when MDE quits during the start, and keeps what it had not connected', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, places: [{ target: native, directory: '/home/me/app' }] }))
    service.set('/home/me/app', { mde: 'disabled' })
    let release = (): void => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const instance = new BridgeStandby({ file, client: service, owned: async () => true, sleep: (ms) => (ms === 2000 ? held : Promise.resolve()) })
    service.failing = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resuming = instance.resume()
    await new Promise((resolve) => setTimeout(resolve, 10))
    service.failing = false
    await instance.pause()
    release()
    await resuming

    expect(service.switches()).toEqual([])
    expect(parseStandbyPlaces(await fs.readFile(file, 'utf8'))).toEqual([{ target: native, directory: '/home/me/app' }])
  })

  it('connects its own failed server again when a directory is listed, once per directory', async () => {
    service.set('/home/me/app', { mde: 'failed', other: 'connected' })
    const instance = standby()
    const servers = [{ name: 'mde', status: 'failed' as const }]
    instance.revive(native, '/home/me/app', servers)
    instance.revive(native, '/home/me/app', servers)
    await vi.waitFor(() => expect(changed).toEqual([native]))

    expect(service.switches()).toEqual(['connect mde /home/me/app'])
    expect(service.statuses.get('/home/me/app')).toEqual({ mde: 'connected', other: 'connected' })
  })

  it('does not revive a server switched off by hand, another MDE\'s server, or after quitting', async () => {
    service.set('/home/me/app', { mde: 'failed' })
    service.set('/home/me/site', { mde: 'disabled' })
    const mine = standby()
    mine.revive(native, '/home/me/site', [{ name: 'mde', status: 'disabled' }])
    mine.revive(native, '/home/me/other', [{ name: 'other', status: 'failed' }])
    const theirs = standby(async () => false)
    theirs.revive(native, '/home/me/app', [{ name: 'mde', status: 'failed' }])
    const quitting = standby()
    await quitting.pause()
    quitting.revive(native, '/home/me/app', [{ name: 'mde', status: 'failed' }])
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(service.switches()).toEqual([])
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
