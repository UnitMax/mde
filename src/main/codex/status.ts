import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CodexHookInstallStatus,
  CodexHookState,
  CodexStatusSettings,
  CodexTuiInstanceStatus,
  CodexTuiInstancesUpdate,
  CodexTuiStatus,
  CodexTuiStatusUpdate,
  Session
} from '@shared/types'
import { uncPathFor } from '../wsl/paths'
import { runWslCommand } from '../wsl/distros'
import { assertWslLinuxPath, readWslShellValue } from '../wsl/shell-value'
import type { PtyLaunchIntegration } from '../pty/manager'
import { TUI_STATUS_LIVENESS_TIMEOUT_MS } from '../opencode/tui-status'

export const CODEX_STATUS_PROTOCOL = 1 as const
export const CODEX_STATUS_ROOT = '/tmp/mde-codex'
export const CODEX_STATUS_POLL_MS = 1_000
export const CODEX_STATUS_ARTIFACT_MAX_AGE_MINUTES = 24 * 60
export const CODEX_STATUS_HOOK_MARKER = 'mde-codex-status-hook-v1'
export const CODEX_STATUS_HOOK_VERSION = '1.0.0'
export const CODEX_STATUS_HOOK_VERSION_MARKER = 'mde-codex-status-hook-version:'
const CODEX_STATUS_SETTINGS_FILE = 'codex-status.json'
const CODEX_HOOKS_FILE = 'hooks.json'
const CODEX_HOOK_SCRIPT = 'hooks/mde-status.sh'

const CODEX_HOOK_EVENTS = [
  ['SessionStart', 'start'],
  ['UserPromptSubmit', 'working'],
  ['PreToolUse', 'working'],
  ['PostToolUse', 'working'],
  ['PreCompact', 'working'],
  ['PostCompact', 'working'],
  ['PermissionRequest', 'attention'],
  ['SubagentStart', 'working'],
  ['SubagentStop', 'working'],
  ['Stop', 'completed'],
  ['Interrupt', 'interrupted'],
  ['SessionEnd', 'closed']
] as const satisfies readonly (readonly [string, string])[]

/** A dependency-free shell hook loaded by Codex inside the WSL distro. */
export const CODEX_STATUS_HOOK_SOURCE = [
  '#!/bin/sh',
  '# ' + CODEX_STATUS_HOOK_MARKER,
  '# ' + CODEX_STATUS_HOOK_VERSION_MARKER + ' ' + CODEX_STATUS_HOOK_VERSION,
  '',
  'file="$MDE_CODEX_STATUS_FILE"',
  'case "$file" in',
  '  ' + CODEX_STATUS_ROOT + '/*.json) ;;',
  '  *) exit 0 ;;',
  'esac',
  'case "$file" in',
  '  *[!A-Za-z0-9_./-]*) exit 0 ;;',
  'esac',
  'if [ "$MDE_CODEX_STATUS_PROTOCOL" != "1" ]; then exit 0; fi',
  '',
  'event="$MDE_CODEX_STATUS_EVENT"',
  'status="idle"',
  'case "$event" in',
  '  start|idle) status="idle" ;;',
  '  working) status="working" ;;',
  '  attention) status="permission" ;;',
  '  completed) status="completed" ;;',
  '  interrupted) status="interrupted" ;;',
  '  closed) status="closed" ;;',
  '  *) exit 0 ;;',
  'esac',
  '',
  'seconds=$(date +%s 2>/dev/null || printf "0")',
  'case "$seconds" in',
  '  ""|*[!0-9]*) seconds=0 ;;',
  'esac',
  'now=$((seconds * 1000))',
  'revision=$((now + $$ % 1000))',
  'temporary="$file.tmp-$$"',
  'umask 077',
  'mkdir -p -- "$(dirname -- "$file")" 2>/dev/null || exit 0',
  "trap 'rm -f -- \"$temporary\"' EXIT HUP INT TERM",
  '',
  "  printf '{\"protocol\":1,\"status\":\"%s\",\"revision\":%s,\"updatedAt\":%s}\\n' \"$status\" \"$revision\" \"$now\" > \"$temporary\" || exit 0",
  'mv -f -- "$temporary" "$file" 2>/dev/null || exit 0',
  'trap - EXIT HUP INT TERM',
  '',
  '# Stop hooks must return valid JSON when they exit successfully.',
  'if [ "$event" = "completed" ]; then printf "{}\\n"; fi',
  ''
].join('\n')

export interface CodexStatusEvents {
  onStatus(update: CodexTuiStatusUpdate): void
  onInstances(update: CodexTuiInstancesUpdate): void
}

interface Runtime {
  sessionId: string
  terminalId: string
  distro: string
  wslPath: string
  windowsPath: string
  timer: ReturnType<typeof setInterval>
  snapshot: CodexStatusSnapshot | null
  pollInFlight: boolean
}

interface CodexStatusSnapshot {
  protocol: typeof CODEX_STATUS_PROTOCOL
  status: CodexTuiStatus
  revision: number
  updatedAt: number
}

interface EffectiveStatus {
  status: CodexTuiStatus | null
  revision: number
}

interface CodexStatusManagerDependencies {
  now(): number
  readStatusFile(path: string): Promise<string>
  unlinkStatusFile(path: string): Promise<void>
}

const defaultDependencies: CodexStatusManagerDependencies = {
  now: () => Date.now(),
  readStatusFile: (path) => fs.readFile(path, 'utf8'),
  unlinkStatusFile: (path) => fs.unlink(path)
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function hookCommand(event: string, scriptPath: string): string {
  return 'MDE_CODEX_STATUS_EVENT=' + event +
    ' /bin/sh ' + shellQuote(scriptPath) +
    ' # ' + CODEX_STATUS_HOOK_MARKER
}

function expectedHookCommands(scriptPath: string): string[] {
  return CODEX_HOOK_EVENTS.map(([, status]) => hookCommand(status, scriptPath))
}

function isOwnedHook(value: unknown): value is JsonRecord & { command: string } {
  return isRecord(value) &&
    value.type === 'command' &&
    typeof value.command === 'string' &&
    value.command.includes(CODEX_STATUS_HOOK_MARKER)
}

function removeOwnedHooks(document: JsonRecord): boolean {
  const hooks = document.hooks
  if (!isRecord(hooks)) return false
  let changed = false

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const nextGroups: unknown[] = []
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        nextGroups.push(group)
        continue
      }
      const nextHandlers = group.hooks.filter((handler) => !isOwnedHook(handler))
      if (nextHandlers.length !== group.hooks.length) changed = true
      if (nextHandlers.length > 0) nextGroups.push({ ...group, hooks: nextHandlers })
      else if (group.hooks.length === 0) nextGroups.push(group)
    }
    if (nextGroups.length !== groups.length) changed = true
    if (nextGroups.length === 0) delete hooks[event]
    else hooks[event] = nextGroups
  }

  return changed
}

function ownedHookCommands(document: JsonRecord): string[] {
  const hooks = document.hooks
  if (!isRecord(hooks)) return []
  const commands: string[] = []
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue
      for (const handler of group.hooks) {
        if (isOwnedHook(handler)) commands.push(handler.command)
      }
    }
  }
  return commands
}

function addOwnedHooks(document: JsonRecord, scriptPath: string): void {
  const existing = document.hooks
  if (existing !== undefined && !isRecord(existing)) {
    throw new Error('Refusing to modify a Codex hooks.json with an invalid hooks object.')
  }
  const hooks = existing ?? {}
  document.hooks = hooks

  for (const [event, status] of CODEX_HOOK_EVENTS) {
    const current = hooks[event]
    if (current !== undefined && !Array.isArray(current)) {
      throw new Error('Refusing to modify Codex hooks for ' + event + ': expected an array.')
    }
    const handler: JsonRecord = {
      type: 'command',
      command: hookCommand(status, scriptPath)
    }
    if (event === 'SessionEnd' || event === 'Interrupt') handler.timeout = 3
    hooks[event] = [
      ...(current ?? []),
      { hooks: [handler] }
    ]
  }
}

export function parseCodexHookVersion(source: string): string | null {
  const prefix = '# ' + CODEX_STATUS_HOOK_VERSION_MARKER
  const line = source.split(/\r?\n/).find((value) => value.startsWith(prefix))
  const version = line?.slice(prefix.length).trim()
  return version && /^\d+\.\d+\.\d+$/.test(version) ? version : null
}

export function classifyCodexHookSource(
  hooksSource: string | null,
  scriptSource: string | null,
  scriptPath: string
): CodexHookInstallStatus {
  if (hooksSource === null || scriptSource === null) return 'not-installed'

  let document: JsonRecord
  try {
    const parsed: unknown = JSON.parse(hooksSource)
    if (!isRecord(parsed)) return 'conflict'
    document = parsed
  } catch {
    return 'conflict'
  }

  const commands = ownedHookCommands(document)
  if (commands.length === 0) return 'not-installed'
  const expected = expectedHookCommands(scriptPath)
  const expectedCounts = new Map<string, number>()
  expected.forEach((command) => expectedCounts.set(command, (expectedCounts.get(command) ?? 0) + 1))
  const installedCounts = new Map<string, number>()
  commands.forEach((command) => installedCounts.set(command, (installedCounts.get(command) ?? 0) + 1))
  const installed = commands.length === expected.length &&
    expectedCounts.size === installedCounts.size &&
    [...expectedCounts].every(([command, count]) => installedCounts.get(command) === count)
  if (!installed || parseCodexHookVersion(scriptSource) !== CODEX_STATUS_HOOK_VERSION) return 'outdated'
  return 'installed'
}

function decodeCodexStatusSnapshot(value: unknown, now = Date.now()): CodexStatusSnapshot | null {
  if (!isRecord(value) || value.protocol !== CODEX_STATUS_PROTOCOL) return null
  if (
    value.status !== 'idle' &&
    value.status !== 'working' &&
    value.status !== 'permission' &&
    value.status !== 'completed' &&
    value.status !== 'interrupted' &&
    value.status !== 'closed'
  ) return null
  if (
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt > now + 5_000
  ) return null
  return {
    protocol: CODEX_STATUS_PROTOCOL,
    status: value.status,
    revision: value.revision as number,
    updatedAt: value.updatedAt
  }
}

function statusPriority(status: CodexTuiStatus): number {
  switch (status) {
    case 'permission':
      return 5
    case 'working':
      return 4
    case 'interrupted':
      return 3
    case 'completed':
      return 2
    case 'idle':
      return 1
    case 'closed':
      return 0
  }
}

function aggregateCodexStatuses(snapshots: readonly CodexStatusSnapshot[]): EffectiveStatus {
  const current = snapshots.filter((snapshot) => snapshot.status !== 'closed')
  if (current.length === 0) return { status: null, revision: 0 }

  const selected = current.reduce((best, snapshot) => {
    if (statusPriority(snapshot.status) > statusPriority(best.status)) return snapshot
    if (snapshot.revision > best.revision) return snapshot
    return best
  })
  return { status: selected.status, revision: selected.revision }
}

function collectCodexInstanceStatuses(
  runtimes: Iterable<{
    sessionId: string
    terminalId: string
    snapshot: CodexStatusSnapshot | null
  }>,
  sessionId: string
): CodexTuiInstanceStatus[] {
  return [...runtimes]
    .filter((runtime) => runtime.sessionId === sessionId && runtime.snapshot !== null)
    .map((runtime): CodexTuiInstanceStatus => ({
      terminalId: runtime.terminalId,
      status: runtime.snapshot!.status,
      revision: runtime.snapshot!.revision
    }))
    .filter((instance) => instance.status !== 'closed')
}

function sameSnapshot(a: CodexStatusSnapshot | null, b: CodexStatusSnapshot): boolean {
  return a?.status === b.status &&
    a?.revision === b.revision &&
    a?.updatedAt === b.updatedAt
}

function sameStatus(a: EffectiveStatus, b: EffectiveStatus): boolean {
  return a.status === b.status && a.revision === b.revision
}

function sameInstances(
  a: readonly CodexTuiInstanceStatus[],
  b: readonly CodexTuiInstanceStatus[]
): boolean {
  return a.length === b.length && a.every((instance, index) => {
    const other = b[index]
    return other !== undefined &&
      instance.terminalId === other.terminalId &&
      instance.status === other.status &&
      instance.revision === other.revision
  })
}

function assertDistro(distro: string): string {
  const value = distro.trim()
  if (process.platform !== 'win32') {
    throw new Error('Codex status integration requires Windows.')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value)) {
    throw new Error('Invalid WSL distro name: "' + distro + '".')
  }
  return value
}

async function resolveCodexHome(distro: string): Promise<string> {
  const configured = await readWslShellValue(distro, '"$CODEX_HOME"')
  if (configured.value !== null && configured.value.trim().length > 0) {
    return assertWslLinuxPath(configured.value, 'Codex home directory')
  }
  const fallback = await readWslShellValue(distro, '"$HOME/.codex"')
  if (fallback.value !== null) return assertWslLinuxPath(fallback.value, 'Codex home directory')
  throw new Error(
    'Could not read the Codex home directory from "' + distro +
    '". WSL returned: ' + fallback.detail
  )
}

function hooksPath(home: string): string {
  return home + '/' + CODEX_HOOKS_FILE
}

function scriptPath(home: string): string {
  return home + '/' + CODEX_HOOK_SCRIPT
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeAtomic(path: string, source: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = path + '.tmp-' + randomUUID()
  try {
    await fs.writeFile(temporary, source, 'utf8')
    await fs.rename(temporary, path)
  } catch (error) {
    await fs.unlink(temporary).catch(() => {})
    throw error
  }
}

export class CodexStatusManager implements PtyLaunchIntegration {
  private readonly runtimes = new Map<string, Runtime>()
  private readonly sessionStatuses = new Map<string, EffectiveStatus>()
  private readonly sessionInstances = new Map<string, CodexTuiInstanceStatus[]>()
  private readonly homeDirectories = new Map<string, string>()
  private readonly cleanedArtifactDistros = new Set<string>()
  private settingsDirectory: string | null = null
  private enabled = false
  private readonly dependencies: CodexStatusManagerDependencies

  constructor(
    private readonly events: CodexStatusEvents,
    dependencies: Partial<CodexStatusManagerDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async configure(settingsDirectory: string): Promise<void> {
    this.settingsDirectory = settingsDirectory
    try {
      const source = await fs.readFile(join(settingsDirectory, CODEX_STATUS_SETTINGS_FILE), 'utf8')
      const parsed: unknown = JSON.parse(source)
      this.enabled = isRecord(parsed) && parsed.enabled === true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[codex-status] could not read settings; defaulting to disabled:', error)
      }
      this.enabled = false
    }
  }

  settings(): CodexStatusSettings {
    return { enabled: this.enabled, currentHookVersion: CODEX_STATUS_HOOK_VERSION }
  }

  async setEnabled(enabled: boolean): Promise<CodexStatusSettings> {
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

  prepare(terminalId: string, session: Session): Record<string, string> | undefined {
    if (!this.enabled || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) {
      return undefined
    }

    const token = randomUUID()
    const wslPath = CODEX_STATUS_ROOT + '/' + token + '.json'
    const runtime: Runtime = {
      sessionId: session.id,
      terminalId,
      distro: session.distro,
      wslPath,
      windowsPath: uncPathFor(session.distro, wslPath),
      timer: setInterval(() => void this.poll(terminalId), CODEX_STATUS_POLL_MS),
      snapshot: null,
      pollInFlight: false
    }
    runtime.timer.unref?.()
    this.runtimes.set(terminalId, runtime)
    this.cleanupExpiredArtifacts(session.distro)
    void this.poll(terminalId)

    return {
      MDE_CODEX_STATUS_FILE: wslPath,
      MDE_CODEX_STATUS_PROTOCOL: String(CODEX_STATUS_PROTOCOL)
    }
  }

  dispose(terminalId: string): void {
    const runtime = this.runtimes.get(terminalId)
    if (!runtime) return
    clearInterval(runtime.timer)
    this.runtimes.delete(terminalId)
    void this.unlinkStatusFile(runtime.windowsPath)
    this.emitSessionInstances(runtime.sessionId)
    this.emitSessionStatus(runtime.sessionId)
  }

  disposeAll(): void {
    for (const terminalId of [...this.runtimes.keys()]) this.dispose(terminalId)
  }

  async hookState(distro: string): Promise<CodexHookState> {
    const name = assertDistro(distro)
    const home = await this.codexHome(name)
    const hooks = uncPathFor(name, hooksPath(home))
    const script = uncPathFor(name, scriptPath(home))
    const hooksSource = await readOptional(hooks)
    const scriptSource = await readOptional(script)
    return {
      distro: name,
      status: classifyCodexHookSource(hooksSource, scriptSource, scriptPath(home)),
      installedVersion: scriptSource ? parseCodexHookVersion(scriptSource) : null,
      currentVersion: CODEX_STATUS_HOOK_VERSION
    }
  }

  async installHook(distro: string): Promise<CodexHookState> {
    const name = assertDistro(distro)
    const home = await this.codexHome(name)
    const hooks = uncPathFor(name, hooksPath(home))
    const script = uncPathFor(name, scriptPath(home))
    const existingSource = await readOptional(hooks)
    let document: JsonRecord = {}
    if (existingSource !== null) {
      try {
        const parsed: unknown = JSON.parse(existingSource)
        if (!isRecord(parsed)) throw new Error('not an object')
        document = parsed
      } catch {
        throw new Error('Refusing to modify malformed Codex hooks at ' + hooks + '.')
      }
    }

    removeOwnedHooks(document)
    addOwnedHooks(document, scriptPath(home))
    await writeAtomic(script, CODEX_STATUS_HOOK_SOURCE)
    await writeAtomic(hooks, JSON.stringify(document, null, 2) + '\n')
    return this.hookState(name)
  }

  async removeHook(distro: string): Promise<CodexHookState> {
    const name = assertDistro(distro)
    const home = await this.codexHome(name)
    const hooks = uncPathFor(name, hooksPath(home))
    const script = uncPathFor(name, scriptPath(home))
    const existingSource = await readOptional(hooks)
    if (existingSource !== null) {
      let document: JsonRecord
      try {
        const parsed: unknown = JSON.parse(existingSource)
        if (!isRecord(parsed)) throw new Error('not an object')
        document = parsed
      } catch {
        throw new Error('Refusing to modify malformed Codex hooks at ' + hooks + '.')
      }
      if (removeOwnedHooks(document)) await writeAtomic(hooks, JSON.stringify(document, null, 2) + '\n')
    }

    const scriptSource = await readOptional(script)
    if (scriptSource !== null) {
      if (!scriptSource.includes(CODEX_STATUS_HOOK_MARKER)) {
        throw new Error('Refusing to remove a non-MDE Codex hook at ' + script + '.')
      }
      await fs.unlink(script)
    }
    return this.hookState(name)
  }

  private async persistSettings(): Promise<void> {
    if (!this.settingsDirectory) return
    const target = join(this.settingsDirectory, CODEX_STATUS_SETTINGS_FILE)
    await writeAtomic(target, JSON.stringify({ enabled: this.enabled }) + '\n')
  }

  private async codexHome(distro: string): Promise<string> {
    const cached = this.homeDirectories.get(distro)
    if (cached) return cached
    const home = await resolveCodexHome(distro)
    this.homeDirectories.set(distro, home)
    return home
  }

  private cleanupExpiredArtifacts(distro: string): void {
    if (this.cleanedArtifactDistros.has(distro)) return
    this.cleanedArtifactDistros.add(distro)
    void runWslCommand(
      distro,
      [
        'find',
        CODEX_STATUS_ROOT,
        '-mindepth',
        '1',
        '-maxdepth',
        '1',
        '-type',
        'f',
        '-mmin',
        '+' + CODEX_STATUS_ARTIFACT_MAX_AGE_MINUTES,
        '-delete'
      ],
      { timeoutMs: TUI_STATUS_LIVENESS_TIMEOUT_MS }
    ).catch(() => {})
  }

  private async unlinkStatusFile(path: string): Promise<void> {
    try {
      await this.dependencies.unlinkStatusFile(path)
    } catch {}
  }

  private async poll(terminalId: string): Promise<void> {
    const runtime = this.runtimes.get(terminalId)
    if (!runtime || runtime.pollInFlight) return
    runtime.pollInFlight = true

    try {
      let snapshot: CodexStatusSnapshot | null = null
      try {
        const text = await this.dependencies.readStatusFile(runtime.windowsPath)
        snapshot = decodeCodexStatusSnapshot(JSON.parse(text), this.dependencies.now())
      } catch {}

      if (this.runtimes.get(terminalId) !== runtime) return
      if (snapshot?.status === 'closed') {
        this.clearRuntimeSnapshot(runtime)
        void this.unlinkStatusFile(runtime.windowsPath)
        return
      }
      if (snapshot !== null) this.acceptSnapshot(runtime, snapshot)
    } finally {
      runtime.pollInFlight = false
    }
  }

  private acceptSnapshot(runtime: Runtime, snapshot: CodexStatusSnapshot): void {
    if (sameSnapshot(runtime.snapshot, snapshot)) return
    runtime.snapshot = snapshot
    this.emitSessionInstances(runtime.sessionId)
    this.emitSessionStatus(runtime.sessionId)
  }

  private clearRuntimeSnapshot(runtime: Runtime): void {
    if (runtime.snapshot === null) return
    runtime.snapshot = null
    this.emitSessionInstances(runtime.sessionId)
    this.emitSessionStatus(runtime.sessionId)
  }

  private currentSnapshots(sessionId: string): CodexStatusSnapshot[] {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.sessionId === sessionId && runtime.snapshot !== null)
      .map((runtime) => runtime.snapshot!)
  }

  private emitSessionStatus(sessionId: string): void {
    const aggregate = aggregateCodexStatuses(this.currentSnapshots(sessionId))
    const next: EffectiveStatus = {
      status: aggregate.status,
      revision: aggregate.revision
    }
    const previous = this.sessionStatuses.get(sessionId)
    if (previous && sameStatus(previous, next)) return
    this.sessionStatuses.set(sessionId, next)
    this.events.onStatus({
      sessionId,
      status: next.status,
      revision: next.revision
    })
  }

  private emitSessionInstances(sessionId: string): void {
    const instances = collectCodexInstanceStatuses(
      [...this.runtimes.values()].map((runtime) => ({
        sessionId: runtime.sessionId,
        terminalId: runtime.terminalId,
        snapshot: runtime.snapshot
      })),
      sessionId
    ).map((instance): CodexTuiInstanceStatus => ({
      terminalId: instance.terminalId,
      status: instance.status,
      revision: instance.revision
    }))
    const previous = this.sessionInstances.get(sessionId) ?? []
    if (sameInstances(previous, instances)) return
    if (instances.length === 0) this.sessionInstances.delete(sessionId)
    else this.sessionInstances.set(sessionId, instances)
    this.events.onInstances({ sessionId, instances })
  }
}
