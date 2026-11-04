import {
  TERMINAL_LAYOUT_DEFINITIONS,
  MAX_TERMINAL_COUNT,
  isTerminalLayout,
  isThreeRowLayout,
  isThreeColumnLayout,
} from '@shared/terminal-layouts'
import { IpcChannels } from '@shared/ipc'
import { isSessionColor } from '@shared/session-colors'
import { isSessionIcon } from '@shared/session-icons'
import { worktreeBranchProblem } from '@shared/worktree-branch'
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
/** Only #rgb or #rrggbb: the value reaches a native API, so no other CSS color syntax is accepted. */
const hexColor: Validator = (value) => typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
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
const layoutShape = object({
  layout: isTerminalLayout,
  panes: array(pane, MAX_TERMINAL_COUNT),
  sizes: object({
    columnRatio: ratio,
    rowRatio: ratio,
    secondColumnRatio: optional(ratio),
    secondRowRatio: optional(ratio),
  }),
})
const layout: Validator = (value) => {
  if (!layoutShape(value)) return false
  const entry = value as {
    layout: TerminalLayout
    panes: { id: string }[]
    sizes: { columnRatio: number; rowRatio: number; secondColumnRatio?: number; secondRowRatio?: number }
  }
  const threeRows = isThreeRowLayout(entry.layout)
  const threeColumns = isThreeColumnLayout(entry.layout)
  return entry.panes.length === TERMINAL_LAYOUT_DEFINITIONS[entry.layout].count &&
    new Set(entry.panes.map((pane) => pane.id)).size === entry.panes.length &&
    (!threeColumns || (entry.sizes.secondColumnRatio !== undefined && entry.sizes.columnRatio < entry.sizes.secondColumnRatio)) &&
    (!threeRows || (entry.sizes.secondRowRatio !== undefined && entry.sizes.rowRatio < entry.sizes.secondRowRatio))
}
const tab = object({ sessionId: id, tabId: id })
const argsShape = array(string(IPC_LIMITS.path, true), IPC_LIMITS.arguments)
const args: Validator = (value) => argsShape(value) &&
  (value as string[]).reduce((length, entry) => length + entry.length, 0) <= IPC_LIMITS.argumentText
const command = object({ executable: path, args })
const agent = object({ kind: oneOf('opencode', 'codex', 'claude'), command })
const commandLaunch = object({ sourceTerminalId: id, directory: oneOf('terminal', 'session'), agent: optional(agent) })
const opencodeSessionId: Validator = (value) => id(value) && /^ses_[A-Za-z0-9_-]+$/.test(value as string)
const resumeLaunch = object({
  sourceTerminalId: id,
  executable: path,
  opencodeSessionId,
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
const inboxFolderId: Validator = (value) => typeof value === 'string' && /^fld_[A-Za-z0-9-]{1,64}$/.test(value)
const agentId: Validator = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
/** A branch name as the picker shows it; main matches it against the refs Git itself lists. */
const worktreeBase = string(256)
/** A branch name the person chose for the new worktree; main checks the same rules again with a message. */
const worktreeBranch: Validator = (value) => typeof value === 'string' && worktreeBranchProblem(value) === null
const modelRef = object({ id: string(512), providerId: string(512), variant: optional(string(512)) })
/** Prompt text: newlines and tabs are fine, other control characters are not. */
const promptText: Validator = (value) => typeof value === 'string' && value.length <= 100_000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const chatThread = object({ threadId: opencodeSessionId })
const messageId: Validator = (value) => typeof value === 'string' && /^msg_[A-Za-z0-9_-]{1,200}$/.test(value)
const formValue: Validator = (value) =>
  (typeof value === 'string' && value.length <= 20_000) ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  typeof value === 'boolean' ||
  array(string(2000, true), 100)(value)
/** A form answer is a plain object of up to 50 field keys. */
const formAnswer: Validator = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length > 50) return false
  return keys.every((key) => {
    if (typeof key !== 'string' || !/^[^\u0000-\u001f\u007f-\u009f]{1,200}$/.test(key)) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && formValue(descriptor.value))
  })
}

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
  [IpcChannels.clipboardPaste]: noPayload,
  [IpcChannels.wslAvailable]: noPayload,
  [IpcChannels.wslDistros]: noPayload,
  [IpcChannels.pathBrowse]: noPayload,
  [IpcChannels.pathResolve]: object({ kind, distro: optional(distro), rawPath: optionalPath }),
  [IpcChannels.pathValidate]: object({ kind, distro: optional(distro), path: optionalPath }),
  [IpcChannels.pathListWslDirectories]: object({ distro, path: optional(path), hidden: optional(boolean) }),
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
  [IpcChannels.opencodeTuiPluginState]: pluginRequest,
  [IpcChannels.opencodeTuiPluginInstall]: pluginRequest,
  [IpcChannels.opencodeTuiPluginRemove]: pluginRequest,
  [IpcChannels.opencodeTuiSettings]: noPayload,
  [IpcChannels.opencodeTuiSetEnabled]: enabled,
  [IpcChannels.opencodeTuiSetInstanceLabelMode]: object({ mode: oneOf('numbered', 'title') }),
  [IpcChannels.opencodeAlertsSettings]: noPayload,
  [IpcChannels.opencodeAlertsSetEnabled]: enabled,
  [IpcChannels.inboxList]: noPayload,
  [IpcChannels.inboxSetRead]: object({ id: opencodeSessionId, read: boolean }),
  [IpcChannels.inboxSetArchived]: object({ id: opencodeSessionId, archived: boolean }),
  [IpcChannels.inboxRemove]: object({ id: opencodeSessionId, removeWorktree: optional(boolean) }),
  [IpcChannels.inboxFolders]: noPayload,
  [IpcChannels.inboxFoldersAdd]: object({ kind, distro: optional(distro), path }),
  [IpcChannels.inboxFoldersRemove]: object({ id: inboxFolderId }),
  [IpcChannels.inboxComposerSet]: object({ folderId: optional(inboxFolderId), agent: optional(agentId), model: optional(modelRef) }),
  [IpcChannels.inboxGitInfo]: object({ folderId: inboxFolderId }),
  [IpcChannels.inboxChangeDiff]: object({ threadId: opencodeSessionId, path }),
  [IpcChannels.inboxChanges]: object({ threadId: opencodeSessionId, details: optional(boolean) }),
  [IpcChannels.chatConfigure]: object({ executable: path }),
  [IpcChannels.chatOptions]: (value) => object({ folderId: optional(inboxFolderId), threadId: optional(opencodeSessionId) })(value) &&
    ((value as { folderId?: string }).folderId === undefined) !== ((value as { threadId?: string }).threadId === undefined),
  [IpcChannels.chatDraft]: (value) => {
    const key: Validator = (v) => typeof v === 'string' && /^(?:thread:ses_[A-Za-z0-9_-]{1,200}|folder:fld_[A-Za-z0-9-]{1,64})$/.test(v)
    return object({ key, action: oneOf('load', 'flush', 'clear') })(value) ||
      object({ key, action: oneOf('text'), text: promptText })(value) ||
      object({ key, action: oneOf('prepend'), text: promptText })(value) ||
      object({ key, action: oneOf('add'), name: string(512), mime: string(200), data: (v) => v instanceof Uint8Array && v.byteLength <= 20 * 1024 * 1024 })(value) ||
      object({ key, action: oneOf('tree'), sessionId: id, path: relativePath })(value) ||
      object({ key, action: oneOf('remove'), attachmentId: string(64) })(value)
  },
  [IpcChannels.chatCreate]: object({ attachmentIds: optional(array(string(64), 10)), draftRevision: optional((v) => Number.isSafeInteger(v) && Number(v) >= 0), folderId: inboxFolderId, text: promptText, agent: agentId, model: modelRef, worktree: optional(object({ base: worktreeBase, branch: optional(worktreeBranch) })) }),
  [IpcChannels.chatMessages]: object({ threadId: opencodeSessionId, cursor: optional((value) => typeof value === 'string' && /^[A-Za-z0-9_=.-]{1,2048}$/.test(value)) }),
  [IpcChannels.chatSend]: object({ attachmentIds: optional(array(string(64), 10)), draftRevision: optional((v) => Number.isSafeInteger(v) && Number(v) >= 0), threadId: opencodeSessionId, text: promptText, agent: optional(agentId), model: optional(modelRef) }),
  [IpcChannels.chatDiscardPending]: object({ threadId: opencodeSessionId, messageId }),
  [IpcChannels.chatInterrupt]: chatThread,
  [IpcChannels.chatRedo]: chatThread,
  [IpcChannels.chatRevert]: object({ threadId: opencodeSessionId, messageId, files: optional(boolean) }),
  [IpcChannels.chatFork]: object({ threadId: opencodeSessionId, messageId: optional(messageId) }),
  [IpcChannels.chatRegenerateTitle]: chatThread,
  [IpcChannels.chatRequests]: chatThread,
  [IpcChannels.chatPermissionReply]: object({
    threadId: opencodeSessionId,
    requestId: (value) => typeof value === 'string' && /^per_[A-Za-z0-9_-]{1,200}$/.test(value),
    decision: oneOf('once', 'always', 'reject'),
  }),
  [IpcChannels.chatFormReply]: object({
    threadId: opencodeSessionId,
    formId: (value) => typeof value === 'string' && /^frm_[A-Za-z0-9_-]{1,200}$/.test(value),
    answer: formAnswer,
  }),
  [IpcChannels.chatSubscribe]: chatThread,
  [IpcChannels.chatUnsubscribe]: chatThread,
  [IpcChannels.windowModeGet]: noPayload,
  [IpcChannels.windowModeSet]: object({ mode: oneOf('normal', 'mini') }),
  [IpcChannels.windowChromeSet]: object({ color: hexColor, symbolColor: hexColor }),
} satisfies Record<IpcChannel, Validator>

export function assertIpcPayload(channel: IpcChannel, payload: unknown): void {
  if (!ipcPayloadValidators[channel](payload)) {
    // Report the contract, never the payload (which can contain terminal input/secrets).
    throw new Error(`Invalid IPC payload for ${channel}.`)
  }
}
