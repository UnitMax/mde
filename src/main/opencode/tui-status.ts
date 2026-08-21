import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  OpenCodeTuiAttentionReason,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiInstancesUpdate,
  OpenCodeTuiPluginInstallStatus,
  OpenCodeTuiPluginState,
  OpenCodeTuiSettings,
  OpenCodeTuiStatus,
  OpenCodeTuiStatusSnapshot,
  OpenCodeTuiStatusUpdate,
  Session,
} from '@shared/types'
import { uncPathFor } from '../wsl/paths'
import { runWsl } from '../wsl/distros'
import type { PtyLaunchIntegration } from '../pty/manager'

export const TUI_STATUS_PROTOCOL = 1 as const
export const TUI_STATUS_ROOT = '/tmp/mde-opencode'
export const TUI_STATUS_POLL_MS = 500
export const TUI_STATUS_STALE_MS = 8_000
export const TUI_STATUS_PLUGIN_MARKER = 'mde-opencode-tui-status-plugin-v1'
export const TUI_STATUS_PLUGIN_VERSION = '1.1.0'
export const TUI_STATUS_PLUGIN_VERSION_MARKER = 'mde-opencode-tui-status-plugin-version:'
export const TUI_STATUS_TITLE_MAX_LENGTH = 160
const TUI_STATUS_SETTINGS_FILE = 'opencode-tui.json'

/** Plain JavaScript loaded by OpenCode inside the WSL distro. */
export const TUI_STATUS_PLUGIN_SOURCE = `// ${TUI_STATUS_PLUGIN_MARKER}
// ${TUI_STATUS_PLUGIN_VERSION_MARKER} ${TUI_STATUS_PLUGIN_VERSION}
const file = process.env.MDE_OPENCODE_STATUS_FILE
const protocol = process.env.MDE_OPENCODE_STATUS_PROTOCOL

export const MdeTuiStatus = async () => {
  if (!file || protocol !== '1' || !file.startsWith('/tmp/mde-opencode/')) return {}

  let revision = 0
  let status = 'idle'
  let attentionReason
  let title
  let hadActivity = false
  const activeSessions = new Set()
  const sessions = new Map()
  const permissions = new Map()
  const questions = new Map()
  let currentRootSessionId
  let writeChain = Promise.resolve()

  const write = () => {
    const snapshot = {
      protocol: 1,
      status,
      ...(attentionReason ? { attentionReason } : {}),
      ...(title ? { title } : {}),
      revision,
      updatedAt: Date.now(),
    }
    writeChain = writeChain.then(async () => {
      try {
        const fs = await import('node:fs/promises')
        await fs.mkdir((await import('node:path')).dirname(file), { recursive: true })
        const temporary = file + '.tmp-' + process.pid
        await fs.writeFile(temporary, JSON.stringify(snapshot), 'utf8')
        await fs.rename(temporary, file)
      } catch {}
    })
  }

  const publish = (nextStatus, nextReason) => {
    if (status === nextStatus && attentionReason === nextReason) {
      write()
      return
    }
    status = nextStatus
    attentionReason = nextReason
    revision += 1
    write()
  }

  const publishDerived = () => {
    if (permissions.size > 0) return publish('attention', 'permission')
    if (questions.size > 0) return publish('attention', 'question')
    if (activeSessions.size > 0) return publish('working')
    if (status === 'error') return
    return publish('idle')
  }

  const sessionIdOf = (properties) =>
    typeof properties?.sessionID === 'string' ? properties.sessionID : undefined
  const requestIdOf = (properties) =>
    typeof properties?.requestID === 'string'
      ? properties.requestID
      : typeof properties?.id === 'string'
        ? properties.id
        : undefined

  const cleanTitle = (value) => {
    if (typeof value !== 'string') return undefined
    const cleaned = value.replace(/\\s+/g, ' ').trim().slice(0, ${TUI_STATUS_TITLE_MAX_LENGTH})
    return cleaned || undefined
  }

  const rootSessionIdOf = (sessionId) => {
    let current = sessionId
    const visited = new Set()
    while (current && !visited.has(current)) {
      visited.add(current)
      const info = sessions.get(current)
      if (!info) return undefined
      const parentId = info.parentID
      if (!parentId) return current
      current = parentId
    }
    return undefined
  }

  const selectTitleFor = (sessionId) => {
    const rootSessionId = rootSessionIdOf(sessionId)
    if (!rootSessionId) return
    currentRootSessionId = rootSessionId
    const nextTitle = sessions.get(rootSessionId)?.title
    if (title === nextTitle) return
    title = nextTitle
    write()
  }

  const rememberSession = (info) => {
    if (!info || typeof info.id !== 'string') return
    const nextTitle = cleanTitle(info.title)
    sessions.set(info.id, {
      ...(typeof info.parentID === 'string' ? { parentID: info.parentID } : {}),
      ...(nextTitle ? { title: nextTitle } : {}),
    })
    if (!info.parentID || info.id === currentRootSessionId) selectTitleFor(info.id)
  }

  const forgetSession = (info) => {
    if (!info || typeof info.id !== 'string') return
    sessions.delete(info.id)
    activeSessions.delete(info.id)
    for (const [id, owner] of permissions) if (owner === info.id) permissions.delete(id)
    for (const [id, owner] of questions) if (owner === info.id) questions.delete(id)
    if (info.id !== currentRootSessionId) return
    currentRootSessionId = undefined
    title = undefined
    write()
  }

  publish('idle')
  const heartbeat = setInterval(write, 2_000)
  heartbeat.unref?.()

  return {
    event: async ({ event }) => {
      try {
        const properties = event?.properties ?? {}
        const sessionId = sessionIdOf(properties)

        if (event?.type === 'session.created' || event?.type === 'session.updated') {
          rememberSession(properties.info)
          return
        }

        if (event?.type === 'session.deleted') {
          forgetSession(properties.info)
          publishDerived()
          return
        }

        if (event?.type === 'session.status' || event?.type === 'session.idle') {
          if (!sessionId) return
          selectTitleFor(sessionId)
          const type = event.type === 'session.idle' ? 'idle' : properties.status?.type
          if (type === 'busy' || type === 'retry') {
            hadActivity = true
            activeSessions.add(sessionId)
            publishDerived()
          } else if (type === 'idle') {
            activeSessions.delete(sessionId)
            if (activeSessions.size === 0 && permissions.size === 0 && questions.size === 0) {
              publish(hadActivity ? 'completed' : 'idle')
            } else {
              publishDerived()
            }
          }
          return
        }

        if (event?.type === 'session.error') {
          if (!sessionId) return
          selectTitleFor(sessionId)
          hadActivity = true
          activeSessions.delete(sessionId)
          for (const [id, owner] of permissions) if (owner === sessionId) permissions.delete(id)
          for (const [id, owner] of questions) if (owner === sessionId) questions.delete(id)
          publish('error')
          return
        }

        if (event?.type === 'permission.asked') {
          const requestId = requestIdOf(properties)
          if (!requestId || !sessionId) return
          selectTitleFor(sessionId)
          hadActivity = true
          permissions.set(requestId, sessionId)
          publishDerived()
          return
        }

        if (event?.type === 'permission.replied') {
          const requestId = requestIdOf(properties)
          if (!requestId) return
          permissions.delete(requestId)
          publishDerived()
          return
        }

        if (event?.type === 'question.asked') {
          const requestId = requestIdOf(properties)
          if (!requestId || !sessionId) return
          selectTitleFor(sessionId)
          hadActivity = true
          questions.set(requestId, sessionId)
          publishDerived()
          return
        }

        if (
          event?.type === 'question.replied' ||
          event?.type === 'question.rejected'
        ) {
          const requestId = requestIdOf(properties)
          if (!requestId) return
          questions.delete(requestId)
          publishDerived()
        }
      } catch {}
    },
  }
}
`

export interface OpenCodeTuiStatusEvents {
  onStatus(update: OpenCodeTuiStatusUpdate): void
  onInstances(update: OpenCodeTuiInstancesUpdate): void
}

interface Runtime {
  sessionId: string
  terminalId: string
  distro: string
  wslPath: string
  windowsPath: string
  timer: ReturnType<typeof setInterval>
  snapshot: OpenCodeTuiStatusSnapshot | null
}

interface EffectiveStatus {
  status: OpenCodeTuiStatus | null
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
}

export function collectTuiInstanceStatuses(
  runtimes: Iterable<{
    sessionId: string
    terminalId: string
    snapshot: OpenCodeTuiStatusSnapshot | null
  }>,
  sessionId: string
): OpenCodeTuiInstanceStatus[] {
  return [...runtimes]
    .filter((runtime) => runtime.sessionId === sessionId && runtime.snapshot !== null)
    .map((runtime): OpenCodeTuiInstanceStatus => {
      const snapshot = runtime.snapshot!
      return {
        terminalId: runtime.terminalId,
        status: snapshot.status,
        ...(snapshot.attentionReason ? { attentionReason: snapshot.attentionReason } : {}),
        ...(snapshot.title ? { title: snapshot.title } : {}),
        revision: snapshot.revision
      }
    })
}

function statusPriority(status: OpenCodeTuiStatus): number {
  switch (status) {
    case 'attention':
      return 5
    case 'working':
      return 4
    case 'error':
      return 3
    case 'completed':
      return 2
    case 'idle':
      return 1
  }
}

export function parseTuiStatusSnapshot(value: unknown, now = Date.now()): OpenCodeTuiStatusSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.protocol !== TUI_STATUS_PROTOCOL) return null
  if (
    record.status !== 'idle' &&
    record.status !== 'working' &&
    record.status !== 'attention' &&
    record.status !== 'completed' &&
    record.status !== 'error'
  ) return null
  if (!Number.isInteger(record.revision) || typeof record.updatedAt !== 'number') return null
  if (!Number.isFinite(record.updatedAt) || record.updatedAt > now + 5_000) return null
  if (now - record.updatedAt > TUI_STATUS_STALE_MS) return null

  const attentionReason = record.attentionReason
  const parsedAttentionReason =
    attentionReason === 'permission' || attentionReason === 'question' ? attentionReason : undefined
  if (
    record.status === 'attention' &&
    parsedAttentionReason === undefined
  ) return null

  const revision = record.revision
  const updatedAt = record.updatedAt
  if (typeof revision !== 'number' || typeof updatedAt !== 'number') return null
  if (record.title !== undefined && typeof record.title !== 'string') return null
  const title = record.title
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, TUI_STATUS_TITLE_MAX_LENGTH)

  return {
    protocol: TUI_STATUS_PROTOCOL,
    status: record.status,
    ...(record.status === 'attention' ? { attentionReason: parsedAttentionReason } : {}),
    ...(title ? { title } : {}),
    revision,
    updatedAt
  }
}

export function aggregateTuiStatuses(snapshots: OpenCodeTuiStatusSnapshot[]): EffectiveStatus {
  const current = snapshots.filter((snapshot) => snapshot.status)
  if (current.length === 0) return { status: null, revision: 0 }

  const selected = current.reduce((best, snapshot) => {
    if (statusPriority(snapshot.status) > statusPriority(best.status)) return snapshot
    if (snapshot.revision > best.revision) return snapshot
    return best
  })

  return {
    status: selected.status,
    ...(selected.attentionReason ? { attentionReason: selected.attentionReason } : {}),
    revision: selected.revision
  }
}

function sameStatus(a: EffectiveStatus, b: EffectiveStatus): boolean {
  return a.status === b.status && a.attentionReason === b.attentionReason && a.revision === b.revision
}

function sameInstances(
  a: readonly OpenCodeTuiInstanceStatus[],
  b: readonly OpenCodeTuiInstanceStatus[]
): boolean {
  return a.length === b.length && a.every((instance, index) => {
    const other = b[index]
    return other !== undefined &&
      instance.terminalId === other.terminalId &&
      instance.status === other.status &&
      instance.attentionReason === other.attentionReason &&
      instance.title === other.title &&
      instance.revision === other.revision
  })
}

function assertDistro(distro: string): string {
  const value = distro.trim()
  if (process.platform !== 'win32') {
    throw new Error('OpenCode TUI status integration requires Windows.')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value)) {
    throw new Error(`Invalid WSL distro name: "${distro}".`)
  }
  return value
}

export function parseTuiPluginVersion(source: string): string | null {
  const prefix = `// ${TUI_STATUS_PLUGIN_VERSION_MARKER}`
  const line = source.split(/\r?\n/).find((value) => value.startsWith(prefix))
  const version = line?.slice(prefix.length).trim()
  return version && /^\d+\.\d+\.\d+$/.test(version) ? version : null
}

export function classifyTuiPluginSource(source: string | null): OpenCodeTuiPluginInstallStatus {
  if (source === null) return 'not-installed'
  if (!source.includes(TUI_STATUS_PLUGIN_MARKER)) return 'conflict'
  return parseTuiPluginVersion(source) === TUI_STATUS_PLUGIN_VERSION ? 'installed' : 'outdated'
}

export class OpenCodeTuiStatusManager implements PtyLaunchIntegration {
  private readonly runtimes = new Map<string, Runtime>()
  private readonly sessionStatuses = new Map<string, EffectiveStatus>()
  private readonly sessionInstances = new Map<string, OpenCodeTuiInstanceStatus[]>()
  private readonly homeDirectories = new Map<string, string>()
  private settingsDirectory: string | null = null
  private enabled = false
  private instanceLabelMode: OpenCodeTuiInstanceLabelMode = 'numbered'

  constructor(private readonly events: OpenCodeTuiStatusEvents) {}

  async configure(settingsDirectory: string): Promise<void> {
    this.settingsDirectory = settingsDirectory
    try {
      const source = await fs.readFile(join(settingsDirectory, TUI_STATUS_SETTINGS_FILE), 'utf8')
      const parsed: unknown = JSON.parse(source)
      const record = typeof parsed === 'object' && parsed !== null
        ? parsed as Record<string, unknown>
        : {}
      this.enabled = record.enabled === true
      this.instanceLabelMode = record.instanceLabelMode === 'title' ? 'title' : 'numbered'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[opencode-tui] could not read settings; defaulting to disabled:', error)
      }
      this.enabled = false
      this.instanceLabelMode = 'numbered'
    }
  }

  settings(): OpenCodeTuiSettings {
    return {
      enabled: this.enabled,
      currentPluginVersion: TUI_STATUS_PLUGIN_VERSION,
      instanceLabelMode: this.instanceLabelMode
    }
  }

  async setEnabled(enabled: boolean): Promise<OpenCodeTuiSettings> {
    const previous = this.enabled
    this.enabled = enabled
    try {
      await this.persistSettings()
    } catch (error) {
      this.enabled = previous
      throw error
    }
    if (!enabled) this.disposeAll()
    return this.settings()
  }

  async setInstanceLabelMode(mode: OpenCodeTuiInstanceLabelMode): Promise<OpenCodeTuiSettings> {
    if (mode !== 'numbered' && mode !== 'title') {
      throw new Error('Invalid OpenCode TUI instance label mode.')
    }
    const previous = this.instanceLabelMode
    this.instanceLabelMode = mode
    try {
      await this.persistSettings()
    } catch (error) {
      this.instanceLabelMode = previous
      throw error
    }
    return this.settings()
  }

  prepare(terminalId: string, session: Session): Record<string, string> | undefined {
    if (!this.enabled || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) {
      return undefined
    }

    const token = randomUUID()
    const wslPath = `${TUI_STATUS_ROOT}/${token}.json`
    const runtime: Runtime = {
      sessionId: session.id,
      terminalId,
      distro: session.distro,
      wslPath,
      windowsPath: uncPathFor(session.distro, wslPath),
      timer: setInterval(() => void this.poll(terminalId), TUI_STATUS_POLL_MS),
      snapshot: null
    }
    runtime.timer.unref?.()
    this.runtimes.set(terminalId, runtime)
    void this.poll(terminalId)

    return {
      MDE_OPENCODE_STATUS_FILE: wslPath,
      MDE_OPENCODE_STATUS_PROTOCOL: String(TUI_STATUS_PROTOCOL)
    }
  }

  dispose(terminalId: string): void {
    const runtime = this.runtimes.get(terminalId)
    if (!runtime) return
    clearInterval(runtime.timer)
    this.runtimes.delete(terminalId)
    this.emitSessionInstances(runtime.sessionId)
    this.emitSessionStatus(runtime.sessionId)
  }

  disposeAll(): void {
    for (const terminalId of [...this.runtimes.keys()]) this.dispose(terminalId)
  }

  async pluginState(distro: string): Promise<OpenCodeTuiPluginState> {
    const name = assertDistro(distro)
    const pluginPath = await this.pluginPath(name)
    const source = await this.readPlugin(pluginPath)
    const installedVersion = source ? parseTuiPluginVersion(source) : null
    return {
      distro: name,
      status: classifyTuiPluginSource(source),
      installedVersion,
      currentVersion: TUI_STATUS_PLUGIN_VERSION
    }
  }

  async installPlugin(distro: string): Promise<OpenCodeTuiPluginState> {
    const name = assertDistro(distro)
    const pluginPath = await this.pluginPath(name)
    const existing = await this.readPlugin(pluginPath)
    if (existing !== null && !existing.includes(TUI_STATUS_PLUGIN_MARKER)) {
      throw new Error(`Refusing to overwrite an existing OpenCode plugin at ${pluginPath}.`)
    }
    await fs.mkdir(dirname(pluginPath), { recursive: true })

    const temporary = `${pluginPath}.tmp-${randomUUID()}`
    await fs.writeFile(temporary, TUI_STATUS_PLUGIN_SOURCE, 'utf8')
    await fs.rename(temporary, pluginPath)
    return this.pluginState(name)
  }

  async removePlugin(distro: string): Promise<OpenCodeTuiPluginState> {
    const name = assertDistro(distro)
    const pluginPath = await this.pluginPath(name)
    const existing = await this.readPlugin(pluginPath)
    if (existing === null) return this.pluginState(name)
    if (!existing.includes(TUI_STATUS_PLUGIN_MARKER)) {
      throw new Error(`Refusing to remove a non-MDE OpenCode plugin at ${pluginPath}.`)
    }
    await fs.unlink(pluginPath)
    return this.pluginState(name)
  }

  private async persistSettings(): Promise<void> {
    if (!this.settingsDirectory) return
    await fs.mkdir(this.settingsDirectory, { recursive: true })
    const target = join(this.settingsDirectory, TUI_STATUS_SETTINGS_FILE)
    const temporary = `${target}.tmp-${randomUUID()}`
    await fs.writeFile(temporary, `${JSON.stringify({
      enabled: this.enabled,
      instanceLabelMode: this.instanceLabelMode
    })}\n`, 'utf8')
    await fs.rename(temporary, target)
  }

  private async readPlugin(pluginPath: string): Promise<string | null> {
    try {
      return await fs.readFile(pluginPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async pluginPath(distro: string): Promise<string> {
    let home = this.homeDirectories.get(distro)
    if (!home) {
      const result = await runWsl(['-d', distro, '--', 'bash', '-lic', 'printf %s "$HOME"'])
      if (result.code !== 0) throw new Error(`Could not resolve the WSL home directory for "${distro}".`)
      home = result.stdout.trim()
      if (!/^\/[A-Za-z0-9._-][A-Za-z0-9._/-]*$/.test(home)) {
        throw new Error(`WSL returned an invalid home directory for "${distro}".`)
      }
      this.homeDirectories.set(distro, home)
    }
    return uncPathFor(distro, `${home}/.config/opencode/plugins/mde-status.js`)
  }

  private async poll(terminalId: string): Promise<void> {
    const runtime = this.runtimes.get(terminalId)
    if (!runtime) return

    let snapshot: OpenCodeTuiStatusSnapshot | null = null
    try {
      const text = await fs.readFile(runtime.windowsPath, 'utf8')
      snapshot = parseTuiStatusSnapshot(JSON.parse(text))
    } catch {
      snapshot = null
    }

    if (
      runtime.snapshot?.revision === snapshot?.revision &&
      runtime.snapshot?.status === snapshot?.status &&
      runtime.snapshot?.attentionReason === snapshot?.attentionReason &&
      runtime.snapshot?.title === snapshot?.title
    ) {
      return
    }
    runtime.snapshot = snapshot
    this.emitSessionInstances(runtime.sessionId)
    this.emitSessionStatus(runtime.sessionId)
  }

  private emitSessionInstances(sessionId: string): void {
    const instances = collectTuiInstanceStatuses(this.runtimes.values(), sessionId)
    const previous = this.sessionInstances.get(sessionId) ?? []
    if (sameInstances(previous, instances)) return
    if (instances.length > 0) this.sessionInstances.set(sessionId, instances)
    else this.sessionInstances.delete(sessionId)
    this.events.onInstances({ sessionId, instances })
  }

  private emitSessionStatus(sessionId: string): void {
    const snapshots = [...this.runtimes.values()]
      .filter((runtime) => runtime.sessionId === sessionId)
      .map((runtime) => runtime.snapshot)
      .filter((snapshot): snapshot is OpenCodeTuiStatusSnapshot => snapshot !== null)
    const next = aggregateTuiStatuses(snapshots)
    const previous = this.sessionStatuses.get(sessionId) ?? { status: null, revision: 0 }
    if (sameStatus(previous, next)) return
    this.sessionStatuses.set(sessionId, next)
    this.events.onStatus({ sessionId, ...next })
  }
}
