import { IpcChannels } from '@shared/ipc'
import { isSessionColor } from '@shared/session-colors'
import { isSessionIcon } from '@shared/session-icons'
import type { TerminalLayout } from '@shared/types'

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
type Validator = (value: unknown) => boolean

/** Limits are UTF-16 code units, except counts and terminal dimensions. */
export const IPC_LIMITS = {
  id: 512,
  label: 4096,
  path: 32_768,
  text: 2 * 1024 * 1024,
  arguments: 128,
  argumentText: 256 * 1024,
  droppedFiles: 256,
  terminalDimension: 4096,
} as const

const controls = /[\u0000-\u001f\u007f-\u009f]/

function string(max: number, allowEmpty = false, allowControls = false): Validator {
  return (value) => typeof value === 'string' && value.length <= max &&
    (allowEmpty || value.trim().length > 0) && (allowControls || !controls.test(value))
}

const id = string(IPC_LIMITS.id)
const label = string(IPC_LIMITS.label)
const path = string(IPC_LIMITS.path)
const optionalPath = string(IPC_LIMITS.path, true)
const text = string(IPC_LIMITS.text, true, true)
const boolean: Validator = (value) => typeof value === 'boolean'
const noPayload: Validator = (value) => value === undefined
const optional = (validate: Validator): Validator => (value) => value === undefined || validate(value)
const nullable = (validate: Validator): Validator => (value) => value === null || validate(value)
const oneOf = (...values: readonly string[]): Validator => (value) => values.some((entry) => entry === value)

/** Reject extra keys, inherited fields, accessors, symbols and prototype-shaped objects. */
function object(fields: Record<string, Validator>): Validator {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length > Object.keys(fields).length) return false
    for (const key of keys) {
      if (typeof key !== 'string' || !Object.hasOwn(fields, key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return false
    }
    return Object.entries(fields).every(([key, validate]) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return validate(descriptor?.value)
    })
  }
}

function array(validate: Validator, max: number): Validator {
  return (value) => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false
    // Array.every skips holes; malformed/sparse arrays must not bypass validation.
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor) || !validate(descriptor.value)) return false
    }
    return Reflect.ownKeys(value).length === value.length + 1
  }
}

const distro: Validator = (value) => typeof value === 'string' && value.length <= 128 && !controls.test(value) &&
  /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value.trim())
const kind = oneOf('native', 'wsl')
const sessionId = object({ sessionId: id })
const terminalId = object({ terminalId: id })
const distroRequest = object({ distro })
const enabled = object({ enabled: boolean })
const palette = object({
  foreground: (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
  background: (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
})
const dimension: Validator = (value) => typeof value === 'number' && Number.isInteger(value) &&
  value >= 1 && value <= IPC_LIMITS.terminalDimension
const size = object({ cols: dimension, rows: dimension })
const ratio: Validator = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
const pane = object({ id, title: optional(label) })
const layoutCounts: Record<TerminalLayout, number> = {
  single: 1,
  columns: 2,
  three: 3,
  quadrant: 4,
  fiveGrid: 5,
  threeColumns: 3,
  sixGrid: 6,
}
const layoutShape = object({
  layout: (value) => typeof value === 'string' && Object.hasOwn(layoutCounts, value),
  panes: array(pane, 6),
  sizes: object({ columnRatio: ratio, rowRatio: ratio, secondColumnRatio: optional(ratio) }),
})
const layout: Validator = (value) => {
  if (!layoutShape(value)) return false
  const entry = value as { layout: TerminalLayout; panes: { id: string }[]; sizes: { columnRatio: number; secondColumnRatio?: number } }
  const threeColumns = ['threeColumns', 'fiveGrid', 'sixGrid'].includes(entry.layout)
  return entry.panes.length === layoutCounts[entry.layout] &&
    new Set(entry.panes.map((pane) => pane.id)).size === entry.panes.length &&
    (!threeColumns || (entry.sizes.secondColumnRatio !== undefined && entry.sizes.columnRatio < entry.sizes.secondColumnRatio))
}
const tab = object({ sessionId: id, tabId: id })
const argsShape = array(string(IPC_LIMITS.path, true), IPC_LIMITS.arguments)
const args: Validator = (value) => argsShape(value) &&
  (value as string[]).reduce((length, entry) => length + entry.length, 0) <= IPC_LIMITS.argumentText
const command = object({ executable: path, args })
const agent = object({ kind: oneOf('opencode', 'codex', 'claude'), command })
const commandLaunch = object({ sourceTerminalId: id, directory: oneOf('terminal', 'session'), agent: optional(agent) })
const resumeLaunch = object({
  sourceTerminalId: id,
  executable: path,
  opencodeSessionId: (value) => id(value) && /^ses_[A-Za-z0-9_-]+$/.test(value as string),
})
const launch: Validator = (value) => commandLaunch(value) || resumeLaunch(value)
const ensure = object({ terminalId: id, sessionId: id, size, palette, launch: optional(launch) })
const nativeTarget = object({ kind: oneOf('native') })
const wslTarget = object({ kind: oneOf('wsl'), distro })
const pluginTarget: Validator = (value) => nativeTarget(value) || wslTarget(value)
const pluginRequest = object({ target: pluginTarget })
const relativePath: Validator = (value) => path(value) && !(value as string).startsWith('/') &&
  !(value as string).includes('\\') && (value as string).split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
const listPath: Validator = (value) => value === '' || relativePath(value)

/** Exhaustive registry: a new channel cannot compile without a runtime contract. */
export const ipcPayloadValidators = {
  [IpcChannels.appInfo]: noPayload,
  [IpcChannels.platformInfo]: noPayload,
  [IpcChannels.workspaceList]: noPayload,
  [IpcChannels.projectsCreate]: object({ name: label }),
  [IpcChannels.projectsUpdate]: object({ id, patch: object({ name: optional(label) }) }),
  [IpcChannels.projectsRemove]: id,
  [IpcChannels.todoProjectsCreate]: object({ name: label, shorthand: string(10) }),
  [IpcChannels.todoProjectsUpdate]: object({ id, patch: object({ name: optional(label), shorthand: optional(string(10)) }) }),
  [IpcChannels.todoProjectsRemove]: id,
  [IpcChannels.todoTasksCreate]: object({ todoProjectId: id, columnId: id, title: label, description: text }),
  [IpcChannels.todoTasksUpdate]: object({ id, patch: object({ title: optional(label), description: optional(text), columnId: optional(id) }) }),
  [IpcChannels.todoTasksMove]: object({ id, columnId: id, beforeId: nullable(id) }),
  [IpcChannels.todoTasksRemove]: id,
  [IpcChannels.sessionsCreate]: object({ projectId: id, name: label, kind, path, distro: optional(distro), shell: optional(optionalPath) }),
  [IpcChannels.sessionsDuplicate]: id,
  [IpcChannels.sessionsUpdate]: object({ id, patch: object({
    name: optional(label), path: optional(path), shell: optional(optionalPath),
    color: optional(isSessionColor), icon: optional(nullable(isSessionIcon)),
  }) }),
  [IpcChannels.sessionsMove]: object({ id, projectId: id }),
  [IpcChannels.sessionsReorder]: object({ id, beforeId: nullable(id) }),
  [IpcChannels.sessionsRemove]: id,
  [IpcChannels.tabsCreate]: sessionId,
  [IpcChannels.tabsSelect]: tab,
  [IpcChannels.tabsUpdate]: object({ sessionId: id, tabId: id, patch: object({ name: optional(label), layout: optional(layout) }) }),
  [IpcChannels.tabsRemove]: tab,
  [IpcChannels.ptyEnsure]: ensure,
  [IpcChannels.ptyRestart]: ensure,
  [IpcChannels.ptyWrite]: object({ terminalId: id, data: text }),
  [IpcChannels.ptyResize]: object({ terminalId: id, size }),
  [IpcChannels.ptyPalette]: object({ terminalId: id, palette }),
  [IpcChannels.ptyDispose]: id,
  [IpcChannels.ptyStatuses]: noPayload,
  [IpcChannels.ptyDirectories]: noPayload,
  [IpcChannels.ptyDropFiles]: object({
    terminalId: id,
    files: array(object({ name: optionalPath, nativePath: optional(path), fileUri: optional(path) }), IPC_LIMITS.droppedFiles),
    treeEntry: optional(object({ sessionId: id, path: relativePath })),
    mode: oneOf('shell', 'tui'),
  }),
  [IpcChannels.clipboardWriteText]: text,
  [IpcChannels.wslAvailable]: noPayload,
  [IpcChannels.wslDistros]: noPayload,
  [IpcChannels.pathBrowse]: noPayload,
  [IpcChannels.pathResolve]: object({ kind, distro: optional(distro), rawPath: optionalPath }),
  [IpcChannels.pathValidate]: object({ kind, distro: optional(distro), path: optionalPath }),
  [IpcChannels.pathReveal]: id,
  [IpcChannels.pathRevealTerminal]: id,
  [IpcChannels.pathOpenInVsCode]: id,
  [IpcChannels.pathOpenTerminalInVsCode]: id,
  [IpcChannels.gitInfo]: sessionId,
  [IpcChannels.gitStatus]: sessionId,
  [IpcChannels.gitTerminalInfo]: terminalId,
  [IpcChannels.gitDiff]: object({ sessionId: id, path }),
  [IpcChannels.filesList]: object({ sessionId: id, path: listPath }),
  [IpcChannels.filesRead]: object({ sessionId: id, path: relativePath }),
  [IpcChannels.opencodeSessionsList]: object({ sessionId: id, sourceTerminalId: id, executable: path }),
  [IpcChannels.opencodeTuiPluginState]: distroRequest,
  [IpcChannels.opencodeTuiPluginInstall]: distroRequest,
  [IpcChannels.opencodeTuiPluginRemove]: distroRequest,
  [IpcChannels.opencodeTuiSettings]: noPayload,
  [IpcChannels.opencodeTuiSetEnabled]: enabled,
  [IpcChannels.opencodeTuiSetInstanceLabelMode]: object({ mode: oneOf('numbered', 'title') }),
  [IpcChannels.codexStatusHookState]: distroRequest,
  [IpcChannels.codexStatusHookInstall]: distroRequest,
  [IpcChannels.codexStatusHookRemove]: distroRequest,
  [IpcChannels.codexStatusSettings]: noPayload,
  [IpcChannels.codexStatusSetEnabled]: enabled,
  [IpcChannels.opencodeTokenRatePluginState]: pluginRequest,
  [IpcChannels.opencodeTokenRatePluginInstall]: pluginRequest,
  [IpcChannels.opencodeTokenRatePluginRemove]: pluginRequest,
  [IpcChannels.opencodeAlertsSettings]: noPayload,
  [IpcChannels.opencodeAlertsSetEnabled]: enabled,
} satisfies Record<IpcChannel, Validator>

export function assertIpcPayload(channel: IpcChannel, payload: unknown): void {
  if (!ipcPayloadValidators[channel](payload)) {
    // Report the contract, never the payload (which can contain terminal input/secrets).
    throw new Error(`Invalid IPC payload for ${channel}.`)
  }
}
