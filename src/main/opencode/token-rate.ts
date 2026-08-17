import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, posix as posixPath, win32 as win32Path } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  OpenCodePluginTarget,
  OpenCodeTokenRatePluginInstallStatus,
  OpenCodeTokenRatePluginState,
  Session
} from '@shared/types'
import { uncPathFor } from '../wsl/paths'
import { runWsl } from '../wsl/distros'
import type { PtyLaunchIntegration } from '../pty/manager'

export const TOKEN_RATE_PLUGIN_MARKER = 'mde-opencode-token-rate-plugin-v1'
export const TOKEN_RATE_PLUGIN_VERSION_MARKER = 'mde-opencode-token-rate-plugin-version:'
export const TOKEN_RATE_PLUGIN_VERSION = '1.0.0'
export const TOKEN_RATE_PLUGIN_ENV = 'MDE_OPENCODE_TOKEN_RATE'
export const TOKEN_RATE_MIN_OPENCODE_VERSION = '1.18.18'
export const TOKEN_RATE_PLUGIN_FILENAME = 'mde-token-rate.tsx'

/**
 * TUI-only source installed into the target OpenCode config directory.
 * The source is deliberately gated so a user-launched OpenCode remains inert.
 */
export const TOKEN_RATE_PLUGIN_SOURCE = [
  '// ' + TOKEN_RATE_PLUGIN_MARKER,
  '// ' + TOKEN_RATE_PLUGIN_VERSION_MARKER + ' ' + TOKEN_RATE_PLUGIN_VERSION,
  '/** @jsxImportSource @opentui/solid */',
  "import { createSignal, onCleanup } from 'solid-js'",
  '',
  "const enabled = process.env.MDE_OPENCODE_TOKEN_RATE === '1'",
  'const sessions = new Map()',
  '',
  "const estimateTokens = (text) => typeof text === 'string' && text.length > 0 ? Math.max(1, Math.ceil(Array.from(text).length / 4)) : 0",
  "const formatRate = (value) => !Number.isFinite(value) || value <= 0 ? null : value >= 100 ? String(Math.round(value)) : value >= 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value * 100) / 100)",
  "const rate = (tokens, startedAt, completedAt) => { const seconds = ((completedAt || Date.now()) - startedAt) / 1000; return tokens > 0 && seconds > 0 ? tokens / seconds : null }",
  '',
  'const stateFor = (sessionID) => {',
  '  let state = sessions.get(sessionID)',
  '  if (state) return state',
  '  const [revision, setRevision] = createSignal(0)',
  '  state = { sessionID, messageID: undefined, startedAt: undefined, lastOutputAt: undefined, active: false, finalRate: undefined, parts: new Map(), revision, bump: () => setRevision((value) => value + 1) }',
  '  sessions.set(sessionID, state)',
  '  return state',
  '}',
  '',
  'const resetForMessage = (state, messageID) => {',
  '  if (!messageID || state.messageID === messageID) return',
  '  state.messageID = messageID',
  '  state.startedAt = undefined',
  '  state.lastOutputAt = undefined',
  '  state.active = false',
  '  state.finalRate = undefined',
  '  state.parts.clear()',
  '}',
  '',
  'const setAssistantMessage = (state, message) => {',
  "  if (!message || message.role !== 'assistant') return",
  '  resetForMessage(state, message.id)',
  '  if (Number.isFinite(message.time?.created)) state.startedAt = message.time.created',
  '  if (!Number.isFinite(message.time?.completed)) return',
  '  const tokens = (Number(message.tokens?.output) || 0) + (Number(message.tokens?.reasoning) || 0)',
  '  const value = rate(tokens, state.startedAt, message.time.completed)',
  '  if (value !== null) state.finalRate = value',
  '}',
  '',
  'let tuiApi',
  '',
  'const refresh = (state) => {',
  '  const messages = tuiApi.state.session.messages(state.sessionID)',
  "  const message = [...messages].reverse().find((item) => item.role === 'assistant')",
  '  if (message) setAssistantMessage(state, message)',
  '}',
  '',
  'const handlePart = (part) => {',
  "  if (!part || typeof part.sessionID !== 'string') return",
  '  const state = stateFor(part.sessionID)',
  '  resetForMessage(state, part.messageID)',
  '  state.active = true',
  '  if (!state.startedAt) state.startedAt = Date.now()',
  "  if (part.type === 'text' || part.type === 'reasoning') { state.parts.set(part.id, estimateTokens(part.text)); state.lastOutputAt = Date.now() }",
  '  state.bump()',
  '}',
  '',
  'const handleMessage = (message) => {',
  "  if (!message || message.role !== 'assistant') return",
  '  const state = stateFor(message.sessionID)',
  '  setAssistantMessage(state, message)',
  '  state.bump()',
  '}',
  '',
  'const handleStatus = (event) => {',
  '  const sessionID = event?.properties?.sessionID',
  "  if (typeof sessionID !== 'string') return",
  '  const state = stateFor(sessionID)',
  "  const type = event.properties.status?.type || (event.type === 'session.idle' ? 'idle' : undefined)",
  "  if (type === 'busy' || type === 'retry') { state.active = true; if (!state.startedAt) state.startedAt = Date.now() }",
  "  if (type === 'idle') { refresh(state); state.active = false }",
  '  state.bump()',
  '}',
  '',
  'const display = (state, now) => {',
  '  state.revision()',
  '  if (!state.messageID) refresh(state)',
  "  if (state.finalRate !== undefined) { const value = formatRate(state.finalRate); return value ? value + ' tok/s' : '' }",
  "  if (!state.active) return ''",
  "  if (!state.lastOutputAt || now - state.lastOutputAt > 1500) return 'Waiting'",
  '  const estimated = [...state.parts.values()].reduce((total, value) => total + value, 0)',
  '  const value = formatRate(rate(estimated, state.startedAt, now))',
  "  return value ? '~' + value + ' tok/s' : 'Waiting'",
  '}',
  '',
  'const RateView = (props) => {',
  '  const state = stateFor(props.session_id)',
  '  const [clock, setClock] = createSignal(Date.now())',
  '  const timer = setInterval(() => setClock(Date.now()), 250)',
  '  onCleanup(() => clearInterval(timer))',
  '  return <text fg="#888888">{clock() && display(state, clock())}</text>',
  '}',
  '',
  'const tui = async (apiValue) => {',
  '  tuiApi = apiValue',
  '  if (!enabled) return',
  "  apiValue.event.on('message.part.updated', (event) => handlePart(event.properties.part))",
  "  apiValue.event.on('message.updated', (event) => handleMessage(event.properties.info))",
  "  apiValue.event.on('session.status', handleStatus)",
  "  apiValue.event.on('session.idle', handleStatus)",
  '  apiValue.slots.register({ slots: { session_prompt_right: (_context, props) => <RateView session_id={props.session_id} /> } })',
  '}',
  '',
  "export default { id: 'mde-opencode-token-rate', tui }"
].join('\n')

const CONFIG_FILENAMES = ['tui.json', 'tui.jsonc'] as const
const WSL_CONFIG_DIRECTORY_SCRIPT =
  'printf "%s" "$' + '{OPENCODE_CONFIG_DIR:-$' + '{XDG_CONFIG_HOME:-$HOME/.config}/opencode}"'

interface TargetPaths {
  target: OpenCodePluginTarget
  hostConfigDirectory: string
  configPath: string | null
  pluginPath: string
  pluginSpec: string
  legacyPluginSpecs: string[]
}

interface JsonRange {
  start: number
  end: number
}

export function openCodeTokenRateTargetKey(target: OpenCodePluginTarget): string {
  return target.kind === 'native' ? 'native' : 'wsl:' + target.distro
}

function assertTarget(target: OpenCodePluginTarget): OpenCodePluginTarget {
  if (!target || (target.kind !== 'native' && target.kind !== 'wsl')) {
    throw new Error('Invalid OpenCode token-rate plugin target.')
  }
  if (target.kind === 'native' && process.platform !== 'linux') {
    throw new Error('Native OpenCode token-rate integration requires Linux.')
  }
  if (target.kind === 'wsl') {
    const distro = target.distro.trim()
    if (process.platform !== 'win32') throw new Error('WSL OpenCode targets require Windows.')
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(distro)) {
      throw new Error('Invalid WSL distro name: "' + target.distro + '".')
    }
    return { kind: 'wsl', distro }
  }
  return { kind: 'native' }
}

function nativeConfigDirectory(): string {
  const configured = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (configured) {
    if (!configured.startsWith('/')) throw new Error('OPENCODE_CONFIG_DIR must be an absolute Linux path.')
    return configured.replace(/\/+$/, '') || '/'
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const base = xdg && xdg.startsWith('/') ? xdg : join(homedir(), '.config')
  return join(base, 'opencode')
}

function assertLinuxPath(value: string): string {
  const path = value.trim()
  if (!path.startsWith('/') || path.includes('\n') || path.includes('\r')) {
    throw new Error('WSL returned an invalid OpenCode config directory.')
  }
  return path.replace(/\/+$/, '') || '/'
}

async function wslConfigDirectory(distro: string): Promise<string> {
  const result = await runWsl(['-d', distro, '--', 'bash', '-lic', WSL_CONFIG_DIRECTORY_SCRIPT])
  if (result.code !== 0) throw new Error('Could not resolve the OpenCode config directory for "' + distro + '".')
  return assertLinuxPath(result.stdout)
}

function fileUrl(path: string): string {
  return 'file://' + path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

export function wslTokenRatePluginSpec(logicalDirectory: string): string {
  return fileUrl(posixPath.join(logicalDirectory, 'plugins', TOKEN_RATE_PLUGIN_FILENAME))
}

export function legacyWslTokenRatePluginSpec(logicalDirectory: string): string {
  return fileUrl(win32Path.join(logicalDirectory, 'plugins', TOKEN_RATE_PLUGIN_FILENAME))
}

async function findConfigFile(directory: string): Promise<string | null> {
  for (const name of CONFIG_FILENAMES) {
    const path = join(directory, name)
    try {
      await fs.access(path)
      return path
    } catch {
      // Try the next supported filename.
    }
  }
  return null
}

async function resolveTargetPaths(input: OpenCodePluginTarget): Promise<TargetPaths> {
  const target = assertTarget(input)
  if (target.kind === 'native') {
    const directory = nativeConfigDirectory()
    const pluginPath = join(directory, 'plugins', TOKEN_RATE_PLUGIN_FILENAME)
    return {
      target,
      hostConfigDirectory: directory,
      configPath: await findConfigFile(directory),
      pluginPath,
      pluginSpec: fileUrl(join(directory, 'plugins', TOKEN_RATE_PLUGIN_FILENAME)),
      legacyPluginSpecs: []
    }
  }

  const logicalDirectory = await wslConfigDirectory(target.distro)
  const hostDirectory = uncPathFor(target.distro, logicalDirectory)
  return {
    target,
    hostConfigDirectory: hostDirectory,
    configPath: await findConfigFile(hostDirectory),
    pluginPath: join(hostDirectory, 'plugins', TOKEN_RATE_PLUGIN_FILENAME),
    pluginSpec: wslTokenRatePluginSpec(logicalDirectory),
    legacyPluginSpecs: [legacyWslTokenRatePluginSpec(logicalDirectory)]
  }
}

function skipTrivia(source: string, start: number): number {
  let index = start
  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1
      continue
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2)
      index = end < 0 ? source.length : end + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    break
  }
  return index
}

function stringEnd(source: string, start: number): number {
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '"') return index + 1
    index += 1
  }
  throw new Error('Invalid JSONC string.')
}

function matchingEnd(source: string, start: number): number {
  const opening = source[start]
  const closing = opening === '{' ? '}' : ']'
  const stack = [closing]
  let index = start + 1
  while (index < source.length && stack.length > 0) {
    if (source[index] === '"') {
      index = stringEnd(source, index)
      continue
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2)
      index = end < 0 ? source.length : end + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) throw new Error('Invalid JSONC comment.')
      index = end + 2
      continue
    }
    if (source[index] === '{') stack.push('}')
    else if (source[index] === '[') stack.push(']')
    else if (source[index] === stack[stack.length - 1]) stack.pop()
    else if (source[index] === '}' || source[index] === ']') throw new Error('Invalid JSONC nesting.')
    index += 1
  }
  if (stack.length > 0) throw new Error('Invalid JSONC structure.')
  return index - 1
}

function valueEnd(source: string, start: number): number {
  const index = skipTrivia(source, start)
  const value = source[index]
  if (value === '"') return stringEnd(source, index)
  if (value === '{' || value === '[') return matchingEnd(source, index) + 1
  let end = index
  while (end < source.length && !',}]'.includes(source[end] ?? '')) end += 1
  return end
}

function jsoncClean(source: string): string {
  let result = ''
  let index = 0
  while (index < source.length) {
    if (source[index] === '"') {
      const end = stringEnd(source, index)
      result += source.slice(index, end)
      index = end
      continue
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2)
      result += end < 0 ? '' : '\n'
      index = end < 0 ? source.length : end + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) throw new Error('Invalid JSONC comment.')
      result += source.slice(index, end + 2).replace(/[^\n]/g, ' ')
      index = end + 2
      continue
    }
    result += source[index]
    index += 1
  }
  return result.replace(/,\s*([}\]])/g, '$1')
}

function parseJsonc(source: string): unknown {
  try {
    return JSON.parse(jsoncClean(source))
  } catch {
    throw new Error('OpenCode TUI config is not valid JSONC.')
  }
}

function topLevelProperty(source: string, property: string): { open: number; close: number } | null {
  const root = skipTrivia(source, 0)
  if (source[root] !== '{') throw new Error('OpenCode TUI config must contain an object.')
  const rootEnd = matchingEnd(source, root)
  let index = skipTrivia(source, root + 1)
  while (index < rootEnd) {
    if (source[index] === ',') {
      index = skipTrivia(source, index + 1)
      continue
    }
    if (source[index] !== '"') throw new Error('OpenCode TUI config contains an invalid property.')
    const keyEnd = stringEnd(source, index)
    const key = JSON.parse(source.slice(index, keyEnd)) as string
    const colon = skipTrivia(source, keyEnd)
    if (source[colon] !== ':') throw new Error('OpenCode TUI config contains an invalid property.')
    const start = skipTrivia(source, colon + 1)
    const end = valueEnd(source, start)
    if (key === property) {
      if (source[start] !== '[') throw new Error('OpenCode TUI config plugin must be an array.')
      return { open: start, close: matchingEnd(source, start) }
    }
    index = skipTrivia(source, end)
  }
  return null
}

function arrayEntries(source: string, open: number, close: number): JsonRange[] {
  const entries: JsonRange[] = []
  let index = skipTrivia(source, open + 1)
  while (index < close) {
    if (source[index] === ',') {
      index = skipTrivia(source, index + 1)
      continue
    }
    const end = valueEnd(source, index)
    entries.push({ start: index, end })
    index = skipTrivia(source, end)
  }
  return entries
}

function pluginEntryMatches(source: string, range: JsonRange, spec: string): boolean {
  try {
    const value = parseJsonc(source.slice(range.start, range.end))
    return value === spec || (Array.isArray(value) && value[0] === spec)
  } catch {
    return false
  }
}

export function configRegistersTokenRatePlugin(source: string, spec: string): boolean {
  const parsed = parseJsonc(source)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('OpenCode TUI config must contain an object.')
  const plugins = (parsed as Record<string, unknown>).plugin
  if (plugins !== undefined && !Array.isArray(plugins)) throw new Error('OpenCode TUI config plugin must be an array.')
  const property = topLevelProperty(source, 'plugin')
  return property ? arrayEntries(source, property.open, property.close).some((range) => pluginEntryMatches(source, range, spec)) : false
}

export function addTokenRatePluginToConfig(source: string, spec: string): string {
  const parsed = parseJsonc(source)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('OpenCode TUI config must contain an object.')
  const plugins = (parsed as Record<string, unknown>).plugin
  if (plugins !== undefined && !Array.isArray(plugins)) throw new Error('OpenCode TUI config plugin must be an array.')
  const property = topLevelProperty(source, 'plugin')
  if (property) {
    const entries = arrayEntries(source, property.open, property.close)
    if (entries.some((range) => pluginEntryMatches(source, range, spec))) return source
    const body = source.slice(property.open + 1, property.close)
    if (!body.trim()) return source.slice(0, property.open + 1) + JSON.stringify(spec) + source.slice(property.close)
    const trailing = body.match(/\s*$/)?.[0] ?? ''
    const insertionPoint = property.close - trailing.length
    return source.slice(0, insertionPoint) + ', ' + JSON.stringify(spec) + source.slice(insertionPoint)
  }
  const root = skipTrivia(source, 0)
  const rootEnd = matchingEnd(source, root)
  const existing = skipTrivia(source, root + 1) < rootEnd
  const lineStart = source.lastIndexOf('\n', rootEnd - 1) + 1
  const indent = source.slice(lineStart, rootEnd).match(/^\s*/)?.[0] ?? ''
  const propertyIndent = indent + '  '
  const addition = (existing ? ',' : '') + '\n' + propertyIndent + '"plugin": [\n' + propertyIndent + '  ' + JSON.stringify(spec) + '\n' + propertyIndent + ']\n' + indent
  return source.slice(0, rootEnd) + addition + source.slice(rootEnd)
}

export function removeTokenRatePluginFromConfig(source: string, spec: string): string {
  const parsed = parseJsonc(source)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('OpenCode TUI config must contain an object.')
  const plugins = (parsed as Record<string, unknown>).plugin
  if (plugins !== undefined && !Array.isArray(plugins)) throw new Error('OpenCode TUI config plugin must be an array.')
  const property = topLevelProperty(source, 'plugin')
  if (!property) return source
  const entries = arrayEntries(source, property.open, property.close)
  const match = entries.find((range) => pluginEntryMatches(source, range, spec))
  if (!match) return source
  if (entries.length === 1) return source.slice(0, match.start) + source.slice(match.end)
  const before = source.slice(property.open + 1, match.start).match(/\s*$/)?.[0] ?? ''
  const previous = match.start - before.length - 1
  if (source[previous] === ',') return source.slice(0, previous) + source.slice(match.end)
  const next = skipTrivia(source, match.end)
  if (source[next] === ',') return source.slice(0, match.start) + source.slice(next + 1)
  return source.slice(0, match.start) + source.slice(match.end)
}

export function removeTokenRatePluginSpecsFromConfig(source: string, specs: readonly string[]): string {
  return specs.reduce((current, spec) => removeTokenRatePluginFromConfig(current, spec), source)
}

export function repairTokenRatePluginConfig(
  source: string,
  spec: string,
  legacySpecs: readonly string[]
): string {
  return addTokenRatePluginToConfig(removeTokenRatePluginSpecsFromConfig(source, legacySpecs), spec)
}

export function parseTokenRatePluginVersion(source: string): string | null {
  const prefix = '// ' + TOKEN_RATE_PLUGIN_VERSION_MARKER
  const line = source.split(/\r?\n/).find((value) => value.startsWith(prefix))
  const version = line?.slice(prefix.length).trim()
  return version && /^\d+\.\d+\.\d+$/.test(version) ? version : null
}

export function classifyTokenRatePluginSource(source: string | null): OpenCodeTokenRatePluginInstallStatus {
  if (source === null) return 'not-installed'
  if (!source.includes(TOKEN_RATE_PLUGIN_MARKER)) return 'conflict'
  return parseTokenRatePluginVersion(source) === TOKEN_RATE_PLUGIN_VERSION ? 'installed' : 'outdated'
}

function parseVersion(value: string | null): [number, number, number] | null {
  const match = value?.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\s|$)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function versionAtLeast(value: string | null, minimum: string): boolean {
  const actual = parseVersion(value)
  const required = parseVersion(minimum)
  if (!actual || !required) return false
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index]
    const requiredPart = required[index]
    if (actualPart === undefined || requiredPart === undefined) return false
    if (actualPart !== requiredPart) return actualPart > requiredPart
  }
  return true
}

function normalizedVersion(value: string | null): string | null {
  const parsed = parseVersion(value)
  return parsed ? parsed.join('.') : null
}

function nativeOpenCodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('opencode', ['--version'], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? null : normalizedVersion(String(stdout)))
    })
  })
}

export function wslOpenCodeVersionArgs(distro: string): string[] {
  return ['-d', distro, '--', 'bash', '-lic', 'exec opencode --version']
}

async function targetOpenCodeVersion(target: OpenCodePluginTarget): Promise<string | null> {
  if (target.kind === 'native') return nativeOpenCodeVersion()
  const result = await runWsl(wslOpenCodeVersionArgs(target.distro))
  return result.code === 0 ? normalizedVersion(result.stdout) : null
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = path + '.tmp-' + randomUUID()
  await fs.writeFile(temporary, contents, 'utf8')
  await fs.rename(temporary, path)
}

export class OpenCodeTokenRatePluginManager implements PtyLaunchIntegration {
  prepare(_terminalId: string, session: Session): Record<string, string> | undefined {
    if (process.platform === 'linux' && session.kind === 'native') return { [TOKEN_RATE_PLUGIN_ENV]: '1' }
    if (process.platform === 'win32' && session.kind === 'wsl' && session.distro) return { [TOKEN_RATE_PLUGIN_ENV]: '1' }
    return undefined
  }

  dispose(_terminalId: string): void {
    // Runtime state belongs to the OpenCode TUI process.
  }

  async pluginState(input: OpenCodePluginTarget): Promise<OpenCodeTokenRatePluginState> {
    const paths = await resolveTargetPaths(input)
    const [source, version] = await Promise.all([readFileOrNull(paths.pluginPath), targetOpenCodeVersion(paths.target)])
    const configSource = paths.configPath ? await readFileOrNull(paths.configPath) : null
    const registered = configSource ? configRegistersTokenRatePlugin(configSource, paths.pluginSpec) : false
    const legacyRegistered = configSource
      ? paths.legacyPluginSpecs.some((spec) => configRegistersTokenRatePlugin(configSource, spec))
      : false
    const sourceStatus = classifyTokenRatePluginSource(source)
    let status = sourceStatus
    if (version === null) status = 'unavailable'
    else if (!versionAtLeast(version, TOKEN_RATE_MIN_OPENCODE_VERSION)) status = 'unsupported'
    else if (sourceStatus === 'installed' && legacyRegistered && !registered) status = 'repair-needed'
    else if (sourceStatus === 'installed' && !registered) status = 'not-installed'
    return {
      target: paths.target,
      status,
      installedVersion: source ? parseTokenRatePluginVersion(source) : null,
      currentVersion: TOKEN_RATE_PLUGIN_VERSION,
      opencodeVersion: version,
      registered
    }
  }

  async installPlugin(input: OpenCodePluginTarget): Promise<OpenCodeTokenRatePluginState> {
    const paths = await resolveTargetPaths(input)
    const version = await targetOpenCodeVersion(paths.target)
    if (!version) throw new Error('Could not detect OpenCode from the target login shell.')
    if (!versionAtLeast(version, TOKEN_RATE_MIN_OPENCODE_VERSION)) {
      throw new Error('OpenCode ' + TOKEN_RATE_MIN_OPENCODE_VERSION + ' or newer is required for TUI plugins.')
    }
    const existingPlugin = await readFileOrNull(paths.pluginPath)
    if (existingPlugin !== null && !existingPlugin.includes(TOKEN_RATE_PLUGIN_MARKER)) {
      throw new Error('Refusing to overwrite an existing OpenCode plugin at ' + paths.pluginPath + '.')
    }
    const configPath = paths.configPath ?? join(paths.hostConfigDirectory, 'tui.json')
    const existingConfig = (await readFileOrNull(configPath)) ?? '{\n}\n'
    const nextConfig = repairTokenRatePluginConfig(existingConfig, paths.pluginSpec, paths.legacyPluginSpecs)
    await atomicWrite(paths.pluginPath, TOKEN_RATE_PLUGIN_SOURCE)
    if (nextConfig !== existingConfig || paths.configPath === null) await atomicWrite(configPath, nextConfig)
    return this.pluginState(paths.target)
  }

  async removePlugin(input: OpenCodePluginTarget): Promise<OpenCodeTokenRatePluginState> {
    const paths = await resolveTargetPaths(input)
    const existingPlugin = await readFileOrNull(paths.pluginPath)
    if (existingPlugin !== null && !existingPlugin.includes(TOKEN_RATE_PLUGIN_MARKER)) {
      throw new Error('Refusing to remove a non-MDE OpenCode plugin at ' + paths.pluginPath + '.')
    }
    const existingConfig = paths.configPath ? await readFileOrNull(paths.configPath) : null
    if (existingConfig !== null) {
      const nextConfig = removeTokenRatePluginSpecsFromConfig(existingConfig, [paths.pluginSpec, ...paths.legacyPluginSpecs])
      if (nextConfig !== existingConfig) await atomicWrite(paths.configPath as string, nextConfig)
    }
    if (existingPlugin !== null) {
      await fs.unlink(paths.pluginPath)
    }
    return this.pluginState(paths.target)
  }
}
