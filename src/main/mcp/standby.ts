import { promises as fs } from 'node:fs'
import { MDE_MCP_SERVER_NAME } from '@shared/mde-mcp'
import type { ChatMcpServer, OpenCodeTarget } from '@shared/types'
import type { ServiceOperation, ServiceRequest } from '../opencode/service/client'
import { serviceTargetKey } from '../opencode/service/discovery'
import { parseMcpServers } from '../opencode/service/parse'

/**
 * Stops MDE's bridges while MDE is closed. OpenCode keeps one `mde --mcp-bridge` process per directory running
 * for as long as its service runs, also after MDE quit, and on Windows a running `mde.exe` cannot be replaced.
 * A bridge that exits by itself is no way out: OpenCode 2.2.6 then lists the server as failed and never starts
 * it again. So on quitting MDE asks OpenCode to disconnect the server in the directories it used, which ends
 * each bridge cleanly, and on the next start it asks OpenCode to connect those again.
 *
 * Only directories MDE talked to OpenCode about in this run are touched: asking about any other one would make
 * OpenCode load that directory and start its MCP servers. And only where the configured server is this copy of
 * MDE, so a second MDE (another data folder) does not switch this one's bridges off.
 *
 * A bridge can also end without MDE asking: MDE crashed or was killed, the Windows build stopped what was left
 * running from its folder, or the bridge ran in a directory MDE did not use that run, so quitting never stopped it.
 * OpenCode lists that server as failed and leaves it so. When MDE lists a directory's servers and finds its own one
 * failed, it connects it again, once per directory and run (`revive`); a server switched off by hand is `disabled`,
 * never failed, so it stays off.
 */

export const MDE_MCP_STANDBY_FILE = 'mde-mcp-standby.json'
/** How long quitting waits for OpenCode at most. */
export const STANDBY_PAUSE_BUDGET_MS = 2000
const LIST_TIMEOUT_MS = 800
const SWITCH_TIMEOUT_MS = 1500
const RESUME_TIMEOUT_MS = 10_000
/**
 * How long to wait before each further try at connecting a stopped bridge again. The first start of a newly built
 * MDE can be slow (Windows scans the new executable, Electron starts cold through WSL), and OpenCode may still be
 * starting itself.
 */
const RESUME_RETRY_MS = [2000, 5000, 10_000]
/** How long, after asking to connect, OpenCode may take to say the server is connected; and how often it is asked. */
const CONNECTED_WAIT_MS = 8000
const CONNECTED_POLL_MS = 500
/** How long quitting waits for a start that is still connecting bridges before it stops them. */
const RESUME_SETTLE_MS = 300
const PLACE_LIMIT = 500

export interface StandbyPlace {
  target: OpenCodeTarget
  directory: string
}

export interface BridgeStandbyOptions {
  /** Where the directories whose bridge was stopped are kept until the next start. */
  file: string
  client: { request(target: OpenCodeTarget, operation: ServiceOperation, request?: ServiceRequest): Promise<unknown> }
  /** Whether the `mde` server in the target's OpenCode configuration starts this copy of MDE. */
  owned(target: OpenCodeTarget): Promise<boolean>
  /** The server was connected again in one of the target's directories, so what the app shows is out of date. */
  changed?(target: OpenCodeTarget): void
  /** Waits; tests pass one that does not. */
  sleep?(ms: number): Promise<void>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

function placeKey(place: StandbyPlace): string {
  return `${serviceTargetKey(place.target)}\n${place.directory}`
}

/** The places in the file's text; anything that is not one is left out. */
export function parseStandbyPlaces(text: string): StandbyPlace[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const items = parsed && typeof parsed === 'object' ? (parsed as { places?: unknown }).places : undefined
  if (!Array.isArray(items)) return []
  const places = new Map<string, StandbyPlace>()
  for (const item of items.slice(0, PLACE_LIMIT)) {
    if (!item || typeof item !== 'object') continue
    const { target, directory } = item as { target?: { kind?: unknown; distro?: unknown }; directory?: unknown }
    if (typeof directory !== 'string' || !directory || directory.length > 4096) continue
    let place: StandbyPlace
    if (target?.kind === 'native') place = { target: { kind: 'native' }, directory }
    else if (target?.kind === 'wsl' && typeof target.distro === 'string' && target.distro) place = { target: { kind: 'wsl', distro: target.distro }, directory }
    else continue
    places.set(placeKey(place), place)
  }
  return [...places.values()]
}

export class BridgeStandby {
  /** The directories OpenCode was asked about in this run, so the ones it has loaded. */
  private readonly used = new Map<string, StandbyPlace>()
  private readonly ownership = new Map<string, Promise<boolean>>()
  /** Stopped at an earlier quit and not connected again yet. */
  private readonly waiting = new Map<string, StandbyPlace>()
  /** Directories whose failed server was connected again in this run, or is being. */
  private readonly revived = new Set<string>()
  private resumed: Promise<void> = Promise.resolve()
  private quitting = false
  private resuming = false

  constructor(private readonly options: BridgeStandbyOptions) {}

  /** Notes a directory MDE asked OpenCode about. */
  use(target: OpenCodeTarget, directory: string): void {
    const place = { target, directory }
    const key = placeKey(place)
    if (this.used.has(key) || this.used.size >= PLACE_LIMIT) return
    this.used.set(key, place)
    // Asked now, while the target is in use anyway, so quitting does not have to wait for it.
    void this.owns(target)
  }

  /** The configuration changed (the server was installed, updated or removed): what was known is out of date. */
  refresh(): void {
    this.ownership.clear()
    const targets = new Map<string, OpenCodeTarget>()
    for (const place of this.used.values()) targets.set(serviceTargetKey(place.target), place.target)
    for (const target of targets.values()) void this.owns(target)
  }

  private owns(target: OpenCodeTarget): Promise<boolean> {
    const key = serviceTargetKey(target)
    let pending = this.ownership.get(key)
    if (!pending) {
      pending = this.options.owned(target).catch(() => false)
      this.ownership.set(key, pending)
    }
    return pending
  }

  private async status(place: StandbyPlace, timeoutMs: number): Promise<string | null> {
    const servers = parseMcpServers(await this.options.client.request(place.target, 'mcp.list', {
      query: { 'location[directory]': place.directory },
      timeoutMs,
    }))
    return servers.find((server) => server.name === MDE_MCP_SERVER_NAME)?.status ?? null
  }

  private switch(place: StandbyPlace, operation: 'mcp.connect' | 'mcp.disconnect', timeoutMs: number): Promise<unknown> {
    return this.options.client.request(place.target, operation, {
      params: { server: MDE_MCP_SERVER_NAME },
      query: { 'location[directory]': place.directory },
      timeoutMs,
    })
  }

  private sleep(ms: number): Promise<void> {
    return (this.options.sleep ?? wait)(ms)
  }

  /** Waits for OpenCode to say the server is connected; false when it fails or does not get there in time. */
  private async connected(place: StandbyPlace): Promise<boolean> {
    for (let waited = 0; waited <= CONNECTED_WAIT_MS && !this.quitting; waited += CONNECTED_POLL_MS) {
      const status = await this.status(place, RESUME_TIMEOUT_MS)
      if (status === 'connected') return true
      if (status !== 'connecting') return false
      await this.sleep(CONNECTED_POLL_MS)
    }
    return false
  }

  /** Asks OpenCode to connect the server and waits until it is; the app is told either way, since something changed. */
  private async connect(place: StandbyPlace): Promise<boolean> {
    try {
      await this.switch(place, 'mcp.connect', RESUME_TIMEOUT_MS)
      return await this.connected(place)
    } finally {
      this.options.changed?.(place.target)
    }
  }

  private async write(places: StandbyPlace[]): Promise<void> {
    if (places.length === 0) {
      await fs.rm(this.options.file, { force: true })
      return
    }
    await fs.writeFile(this.options.file, JSON.stringify({ version: 1, places }), { mode: 0o600 })
  }

  /**
   * Connects the bridges the last quit stopped, trying again a few times, and checks that OpenCode says each one is
   * connected. A server that is connected already is left alone (OpenCode was restarted since, which connects
   * everything again by itself, or someone switched it on); one that is `disabled` or `failed` is connected. A
   * directory where that did not work, or that OpenCode could not be asked about, is kept for the next start.
   */
  resume(): Promise<void> {
    this.resumed = this.resumeAll().catch((error: unknown) => {
      console.warn(`[mcp] could not reconnect the MDE MCP: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.resumed
  }

  private async resumeAll(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.options.file, 'utf8')
    } catch {
      return
    }
    const places = parseStandbyPlaces(text)
    for (const place of places) this.waiting.set(placeKey(place), place)
    this.resuming = true
    try {
      await Promise.all(places.map(async (place) => {
        // Asking loads the directory in OpenCode, so it counts as used from here on.
        this.use(place.target, place.directory)
        if (await this.resumePlace(place)) this.waiting.delete(placeKey(place))
      }))
    } finally {
      this.resuming = false
    }
    // Quitting writes the file itself, with what is still waiting.
    if (!this.quitting) await this.write([...this.waiting.values()])
  }

  /** True when the place needs nothing more: its server is connected, or it has no `mde` server any more. */
  private async resumePlace(place: StandbyPlace): Promise<boolean> {
    for (let attempt = 0; attempt <= RESUME_RETRY_MS.length && !this.quitting; attempt += 1) {
      if (attempt > 0) await this.sleep(RESUME_RETRY_MS[attempt - 1]!)
      if (this.quitting) break
      try {
        const servers = parseMcpServers(await this.options.client.request(place.target, 'mcp.list', {
          query: { 'location[directory]': place.directory },
          timeoutMs: RESUME_TIMEOUT_MS,
        }))
        const status = servers.find((server) => server.name === MDE_MCP_SERVER_NAME)?.status
        if (status === 'connected') return true
        // Removed from the configuration, or waiting for a sign-in: nothing a connect would change.
        if (servers.length > 0 && (status === undefined || status === 'needs-auth' || status === 'unknown')) return true
        if (status === 'disabled' || status === 'failed') {
          if (await this.connect(place)) return true
        } else if (status === 'connecting' && await this.connected(place)) {
          return true
        }
        // An empty list is a directory OpenCode is still loading: look again.
      } catch {
        // OpenCode did not answer; try again.
      }
    }
    return false
  }

  /**
   * MDE listed a directory's servers. If its own server there has failed, it is connected again: OpenCode never
   * does that by itself. Once per directory and run, so a server that keeps failing is not started over and over.
   */
  revive(target: OpenCodeTarget, directory: string, servers: readonly ChatMcpServer[]): void {
    if (this.quitting || servers.find((server) => server.name === MDE_MCP_SERVER_NAME)?.status !== 'failed') return
    const place = { target, directory }
    const key = placeKey(place)
    // While the start is still trying a directory, it is left to it.
    if (this.revived.has(key) || (this.resuming && this.waiting.has(key))) return
    this.revived.add(key)
    void (async () => {
      if (!await this.owns(target) || this.quitting) return
      await this.connect(place)
    })().catch((error: unknown) => {
      console.warn(`[mcp] could not reconnect the MDE MCP: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** Stops the bridges, waiting at most `budgetMs`; quitting goes on whatever OpenCode answers. */
  async pause(budgetMs = STANDBY_PAUSE_BUDGET_MS): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs) })
    try {
      await Promise.race([this.pauseAll().catch(() => undefined), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async pauseAll(): Promise<void> {
    // A start still trying to connect bridges gives up; what it had not connected stays in the file.
    this.quitting = true
    await Promise.race([this.resumed, this.sleep(RESUME_SETTLE_MS)])
    const connected: StandbyPlace[] = []
    await Promise.all([...this.used.values()].map(async (place) => {
      try {
        if (!await this.owns(place.target)) return
        if (await this.status(place, LIST_TIMEOUT_MS) === 'connected') connected.push(place)
      } catch {
        // OpenCode is not there or did not answer: nothing to stop that MDE could reach.
      }
    }))
    // Written before anything is stopped, so a bridge is never left off without MDE knowing to connect it again.
    const places = new Map(this.waiting)
    for (const place of connected) places.set(placeKey(place), place)
    await this.write([...places.values()])
    if (connected.length === 0) return
    await Promise.all(connected.map((place) => this.switch(place, 'mcp.disconnect', SWITCH_TIMEOUT_MS).catch(() => undefined)))
  }
}
