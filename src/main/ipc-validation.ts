import { isPersistedTerminalLayout } from '@shared/terminal-layouts'
import { IpcChannels } from '@shared/ipc'
import { goalObjectiveProblem } from '@shared/goal'
import { isInboxFolderColor, isInboxFolderEmoji, isInboxFolderSymbol } from '@shared/inbox-folder-icons'
import { isSessionColor } from '@shared/session-colors'
import { isSessionIcon } from '@shared/session-icons'
import { MCP_SERVER_NAME } from '@shared/mcp'
import { worktreeBranchProblem } from '@shared/worktree-branch'

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
type Validator = (value: unknown) => boolean

/** Limits are UTF-16 code units, except counts and terminal dimensions. */
export const IPC_LIMITS = {
  id: 512,
  label: 4096,
  path: 32_768,
  text: 2 * 1024 * 1024,
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

const positiveInteger: Validator = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000_000
const distro: Validator = (value) => typeof value === 'string' && value.length <= 128 && !controls.test(value) &&
  /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value.trim())
const kind = oneOf('native', 'wsl')
const sessionId = object({ sessionId: id })
const terminalId = object({ terminalId: id })
const terminalDirectory = { terminalId: id, directory: path }
const rooted = (fields: Record<string, Validator>): Validator => (value) =>
  object({ sessionId: id, ...fields })(value) || object({ ...terminalDirectory, ...fields })(value)
const palette = object({
  foreground: (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
  background: (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
})
const dimension: Validator = (value) => typeof value === 'number' && Number.isInteger(value) &&
  value >= 1 && value <= IPC_LIMITS.terminalDimension
const size = object({ cols: dimension, rows: dimension })
const layout: Validator = isPersistedTerminalLayout
const tab = object({ sessionId: id, tabId: id })
const opencodeSessionId: Validator = (value) => id(value) && /^ses_[A-Za-z0-9_-]+$/.test(value as string)
const ptyRequest = { terminalId: id, sessionId: id, size, palette }
const relativePath: Validator = (value) => path(value) && !(value as string).startsWith('/') &&
  !(value as string).includes('\\') && (value as string).split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
const listPath: Validator = (value) => value === '' || relativePath(value)
const inboxFolderId: Validator = (value) => typeof value === 'string' && /^fld_[A-Za-z0-9-]{1,64}$/.test(value)
/** What a project is called; the handler trims it and the store holds it to the same length as a thread title. */
const projectName = string(512)
/** One of the built-in pictures with an optional tint, or exactly one emoji. Nothing else, and no extra keys. */
const inboxFolderIcon: Validator = (value) =>
  object({ kind: oneOf('symbol'), id: isInboxFolderSymbol, color: optional(isInboxFolderColor) })(value) ||
  object({ kind: oneOf('emoji'), emoji: isInboxFolderEmoji })(value)
const agentId: Validator = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
/** A branch name as the picker shows it; main matches it against the refs Git itself lists. */
const worktreeBase = string(256)
/** A branch name the person chose for the new worktree; main checks the same rules again with a message. */
const worktreeBranch: Validator = (value) => typeof value === 'string' && worktreeBranchProblem(value) === null
const modelRef = object({ id: string(512), providerId: string(512), variant: optional(string(512)) })
/**
 * How a new thread's draft would start. The branch is only remembered text, so it is not held to the rules
 * for a real branch name while it is being typed; creating the thread checks it as it does any other.
 */
const draftChoice = object({
  mode: optional(oneOf('gui', 'terminal')),
  agent: optional(agentId),
  model: optional(modelRef),
  worktree: optional(object({ base: worktreeBase, branch: optional(string(256)) })),
})
/** Prompt text: newlines and tabs are fine, other control characters are not. */
const promptText: Validator = (value) => typeof value === 'string' && value.length <= 100_000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const chatThread = object({ threadId: opencodeSessionId })
/** A goal's objective; OpenCode's own limit and its reserved words are checked here as well as there. */
const goalObjective: Validator = (value) => promptText(value) && goalObjectiveProblem(String(value)) === null
/** A request about a folder (new thread) or a thread names exactly one of them. */
const exactlyOnePlace: Validator = (value) =>
  ((value as { folderId?: unknown }).folderId === undefined) !== ((value as { threadId?: unknown }).threadId === undefined)
/**
 * A draft of OpenCode's configuration: its shape and sizes, field by field (no extra keys, no accessors). Whether
 * the values make sense is `validateDraft`'s question, which the service asks with a message the person can read.
 */
const configModel = object({
  id: string(200), name: string(200, true), context: nullable(positiveInteger), output: nullable(positiveInteger),
  tools: boolean, imageInput: boolean,
})
const configDraft = object({
  permissions: array(object({ action: string(200), resource: string(2000), effect: oneOf('allow', 'ask', 'deny') }), 500),
  customProviders: array(object({
    id: string(64), name: string(200, true), baseUrl: string(2048), apiKeyEnv: string(128, true), models: array(configModel, 200),
  }), 50),
  disabledProviders: array(string(200), 200),
})
const mcpServerName: Validator = (value) => typeof value === 'string' && MCP_SERVER_NAME.test(value)
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
  [IpcChannels.todoProjectsCreate]: object({ name: label, shorthand: string(10) }),
  [IpcChannels.todoProjectsUpdate]: object({ id, patch: object({ name: optional(label), shorthand: optional(string(10)) }) }),
  [IpcChannels.todoProjectsRemove]: id,
  [IpcChannels.todoTasksCreate]: object({ todoProjectId: id, columnId: id, title: label, description: text }),
  [IpcChannels.todoTasksUpdate]: object({ id, patch: object({ title: optional(label), description: optional(text), columnId: optional(id) }) }),
  [IpcChannels.todoTasksMove]: object({ id, columnId: id, beforeId: nullable(id) }),
  [IpcChannels.todoTasksRemove]: id,
  [IpcChannels.sessionsCreate]: object({ name: label, kind, distro: optional(distro), shell: optional(optionalPath) }),
  [IpcChannels.sessionsDuplicate]: id,
  [IpcChannels.sessionsUpdate]: object({ id, patch: object({
    name: optional(label), shell: optional(optionalPath),
    color: optional(isSessionColor), icon: optional(nullable(isSessionIcon)),
  }) }),
  [IpcChannels.sessionsReorder]: object({ id, beforeId: nullable(id) }),
  [IpcChannels.sessionsRemove]: id,
  [IpcChannels.tabsCreate]: sessionId,
  [IpcChannels.tabsSelect]: tab,
  [IpcChannels.tabsUpdate]: object({ sessionId: id, tabId: id, patch: object({ name: optional(label), layout: optional(layout) }) }),
  [IpcChannels.tabsRemove]: tab,
  [IpcChannels.ptyEnsure]: object(ptyRequest),
  [IpcChannels.ptyConfigureInbox]: object({ distro: nullable(distro) }),
  [IpcChannels.ptyRestart]: object(ptyRequest),
  [IpcChannels.ptyWrite]: object({ terminalId: id, data: text }),
  [IpcChannels.ptyResize]: object({ terminalId: id, size }),
  [IpcChannels.ptyPalette]: object({ terminalId: id, palette }),
  [IpcChannels.ptyDispose]: id,
  [IpcChannels.ptyStatuses]: noPayload,
  [IpcChannels.ptyDirectories]: noPayload,
  [IpcChannels.ptyDropFiles]: object({
    terminalId: id,
    files: array(object({ name: optionalPath, nativePath: optional(path), fileUri: optional(path) }), IPC_LIMITS.droppedFiles),
    treeEntry: optional(rooted({ path: relativePath })),
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
  [IpcChannels.pathRevealTerminal]: id,
  [IpcChannels.pathOpenTerminalInVsCode]: id,
  [IpcChannels.pathRevealInbox]: id,
  [IpcChannels.pathOpenInboxInVsCode]: id,
  [IpcChannels.gitInfo]: object(terminalDirectory),
  [IpcChannels.gitTerminalInfo]: terminalId,
  [IpcChannels.gitDiff]: object({ ...terminalDirectory, path }),
  [IpcChannels.filesList]: rooted({ path: listPath }),
  [IpcChannels.filesRead]: rooted({ path: relativePath }),
  [IpcChannels.inboxList]: noPayload,
  [IpcChannels.inboxSetRead]: object({ id: opencodeSessionId, read: boolean }),
  [IpcChannels.inboxSetArchived]: object({ id: opencodeSessionId, archived: boolean }),
  [IpcChannels.inboxSetPinned]: object({ id: opencodeSessionId, pinned: boolean }),
  [IpcChannels.inboxSetCustomTitle]: object({ id: opencodeSessionId, customTitle: nullable(string(512)) }),
  [IpcChannels.inboxRemove]: object({ id: opencodeSessionId, removeWorktree: optional(boolean) }),
  [IpcChannels.inboxFolders]: noPayload,
  [IpcChannels.inboxFoldersAdd]: object({ kind, distro: optional(distro), path, name: optional(projectName), icon: optional(inboxFolderIcon) }),
  [IpcChannels.inboxFoldersUpdate]: object({ id: inboxFolderId, name: optional(projectName), icon: optional(nullable(inboxFolderIcon)) }),
  [IpcChannels.inboxFoldersRemove]: object({ id: inboxFolderId }),
  [IpcChannels.inboxComposerSet]: object({ folderId: optional(inboxFolderId), agent: optional(agentId), model: optional(modelRef) }),
  [IpcChannels.inboxGitInfo]: object({ folderId: inboxFolderId }),
  [IpcChannels.inboxChangeDiff]: object({ threadId: opencodeSessionId, path }),
  [IpcChannels.inboxChanges]: object({ threadId: opencodeSessionId, details: optional(boolean) }),
  [IpcChannels.opencodeConfigRead]: object({ kind, distro: optional(distro) }),
  [IpcChannels.opencodeConfigPreview]: object({ kind, distro: optional(distro), draft: configDraft }),
  [IpcChannels.opencodeConfigSave]: object({ kind, distro: optional(distro), draft: configDraft, revision: string(128) }),
  [IpcChannels.chatConfigure]: object({ executable: path }),
  [IpcChannels.chatOptions]: (value) => object({ folderId: optional(inboxFolderId), threadId: optional(opencodeSessionId) })(value) &&
    exactlyOnePlace(value),
  [IpcChannels.chatDraft]: (value) => {
    const key: Validator = (v) => typeof v === 'string' && /^(?:thread:ses_[A-Za-z0-9_-]{1,200}|draft:drf_[A-Za-z0-9-]{1,64})$/.test(v)
    // The folder a new-thread draft is for, and how it would start, ride along with every change to it.
    const folderId = optional(inboxFolderId)
    const choice = optional(draftChoice)
    return object({ key, action: oneOf('load', 'flush', 'clear'), folderId, choice })(value) ||
      object({ key, action: oneOf('text'), text: promptText, folderId, choice })(value) ||
      object({ key, action: oneOf('prepend'), text: promptText, folderId, choice })(value) ||
      object({ key, action: oneOf('add'), name: string(512), mime: string(200), data: (v) => v instanceof Uint8Array && v.byteLength <= 20 * 1024 * 1024, folderId, choice })(value) ||
      rooted({ key, action: oneOf('tree'), path: relativePath, folderId, choice })(value) ||
      object({ key, action: oneOf('remove'), attachmentId: string(64), folderId, choice })(value)
  },
  [IpcChannels.chatDrafts]: noPayload,
  [IpcChannels.chatCreate]: object({ mode: optional(oneOf('gui', 'terminal')), attachmentIds: optional(array(string(64), 10)), draftRevision: optional((v) => Number.isSafeInteger(v) && Number(v) >= 0), draftId: optional((v) => typeof v === 'string' && /^drf_[A-Za-z0-9-]{1,64}$/.test(v)), folderId: inboxFolderId, text: promptText, agent: agentId, model: modelRef, worktree: optional(object({ base: worktreeBase, branch: optional(worktreeBranch) })) }),
  [IpcChannels.chatMessages]: object({ threadId: opencodeSessionId, cursor: optional((value) => typeof value === 'string' && /^[A-Za-z0-9_=.-]{1,2048}$/.test(value)) }),
  [IpcChannels.chatSend]: object({ attachmentIds: optional(array(string(64), 10)), draftRevision: optional((v) => Number.isSafeInteger(v) && Number(v) >= 0), threadId: opencodeSessionId, text: promptText, agent: optional(agentId), model: optional(modelRef), delivery: optional(oneOf('steer', 'queue')) }),
  [IpcChannels.chatDiscardPending]: object({ threadId: opencodeSessionId, messageId }),
  [IpcChannels.chatSetDelivery]: object({ threadId: opencodeSessionId, messageId, delivery: oneOf('steer', 'queue') }),
  [IpcChannels.chatAside]: object({ threadId: opencodeSessionId, question: (value) => promptText(value) && String(value).trim().length > 0 }),
  [IpcChannels.chatMcp]: (value) => object({ folderId: optional(inboxFolderId), threadId: optional(opencodeSessionId) })(value) &&
    exactlyOnePlace(value),
  [IpcChannels.chatMcpSet]: (value) => object({ folderId: optional(inboxFolderId), threadId: optional(opencodeSessionId), server: mcpServerName, enabled: boolean })(value) &&
    exactlyOnePlace(value),
  [IpcChannels.chatInterrupt]: chatThread,
  [IpcChannels.chatCompact]: chatThread,
  [IpcChannels.chatGoal]: chatThread,
  [IpcChannels.chatBackground]: chatThread,
  [IpcChannels.chatGoalSet]: (value) => object({ threadId: opencodeSessionId, action: oneOf('set'), objective: goalObjective, agent: optional(agentId), model: optional(modelRef) })(value) ||
    object({ threadId: opencodeSessionId, action: oneOf('pause', 'resume', 'clear') })(value),
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
