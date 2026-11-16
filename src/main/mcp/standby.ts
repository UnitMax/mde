import { promises as fs } from 'node:fs'
import { MDE_MCP_SERVER_NAME } from '@shared/mde-mcp'
import type { OpenCodeTarget } from '@shared/types'
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
 */

export const MDE_MCP_STANDBY_FILE = 'mde-mcp-standby.json'
/** How long quitting waits for OpenCode at most. */
export const STANDBY_PAUSE_BUDGET_MS = 2000
const LIST_TIMEOUT_MS = 800
const SWITCH_TIMEOUT_MS = 1500
const RESUME_TIMEOUT_MS = 10_000
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
}

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
  private waiting: StandbyPlace[] = []
  private resumed: Promise<void> = Promise.resolve()

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

  private async write(places: StandbyPlace[]): Promise<void> {
    if (places.length === 0) {
      await fs.rm(this.options.file, { force: true })
      return
    }
    await fs.writeFile(this.options.file, JSON.stringify({ version: 1, places }), { mode: 0o600 })
  }

  /**
   * Connects the bridges the last quit stopped. A server that is no longer `disabled` is left alone: OpenCode
   * was restarted since (it connects everything again by itself) or someone switched it. A directory OpenCode
   * could not be asked about is kept for the next start.
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
    this.waiting = places
    const failed: StandbyPlace[] = []
    await Promise.all(places.map(async (place) => {
      try {
        // Asking loads the directory in OpenCode, so it counts as used from here on.
        this.use(place.target, place.directory)
        if (await this.status(place, RESUME_TIMEOUT_MS) === 'disabled') await this.switch(place, 'mcp.connect', RESUME_TIMEOUT_MS)
      } catch {
        failed.push(place)
      }
    }))
    this.waiting = failed
    await this.write(failed)
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
    await this.resumed
    const connected: StandbyPlace[] = []
    await Promise.all([...this.used.values()].map(async (place) => {
      try {
        if (!await this.owns(place.target)) return
        if (await this.status(place, LIST_TIMEOUT_MS) === 'connected') connected.push(place)
      } catch {
        // OpenCode is not there or did not answer: nothing to stop that MDE could reach.
      }
    }))
    if (connected.length === 0) return
    // Written before anything is stopped, so a bridge is never left off without MDE knowing to connect it again.
    const places = new Map<string, StandbyPlace>()
    for (const place of [...this.waiting, ...connected]) places.set(placeKey(place), place)
    await this.write([...places.values()])
    await Promise.all(connected.map((place) => this.switch(place, 'mcp.disconnect', SWITCH_TIMEOUT_MS).catch(() => undefined)))
  }
}
