export type ProjectKind = 'native' | 'wsl'

/** Narrow platform union so the renderer does not need Node's types. */
export type HostPlatform = 'win32' | 'linux' | 'darwin' | 'other'

export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface Session {
  id: string
  projectId: string
  name: string
  kind: ProjectKind
  /** Required when kind === 'wsl', e.g. "Ubuntu-24.04". */
  distro?: string
  /**
   * Absolute path in the TARGET's own format:
   *   native on Windows -> "C:\\src\\app"
   *   native on Linux   -> "/home/me/src/app"
   *   wsl               -> "/home/me/src/app"
   */
  path: string
  /** Optional shell override; default is resolved per platform. */
  shell?: string
  /** OpenCode conversation currently selected for this MDE workspace session. */
  opencodeSessionId?: string
  /** Explicit model choices made in MDE, keyed by OpenCode conversation ID. */
  opencodeModelSelections?: Record<string, OpenCodeModelSelection>
  createdAt: string
}

export type NewProject = Omit<Project, 'id' | 'createdAt'>
export type NewSession = Omit<Session, 'id' | 'createdAt'>

export interface Distro {
  name: string
  state: string
  version: number
  isDefault: boolean
}

/** Lifecycle of the PTY belonging to a session, as tracked by the main process. */
export type PtyStatus = 'none' | 'running' | 'exited'

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyExitInfo {
  sessionId: string
  exitCode: number
  signal?: number
}

export interface PtyDataChunk {
  sessionId: string
  data: string
}

export type OpenCodeChatRole = 'user' | 'assistant'

/** A plain-text chat item rendered in a session's GUI view. */
export interface OpenCodeChatMessage {
  id: string
  role: OpenCodeChatRole
  text: string
}

/** Reasoning text OpenCode exposes for models that emit it. */
export interface OpenCodeReasoningMessage {
  id: string
  role: 'reasoning'
  text: string
  /** Present when OpenCode reported both a start and an end time for the block. */
  durationMs?: number
}

export type OpenCodeToolStatus = 'pending' | 'running' | 'completed' | 'error'

/** A tool invocation returned by OpenCode between the prompt and final text. */
export interface OpenCodeToolMessage {
  id: string
  role: 'tool'
  tool: string
  status: OpenCodeToolStatus
  input: Record<string, unknown>
  title?: string
  output?: string
  error?: string
}

export type OpenCodeChatItem = OpenCodeChatMessage | OpenCodeToolMessage | OpenCodeReasoningMessage

export type OpenCodePermissionReply = 'once' | 'always' | 'reject'

export type OpenCodeSubagentStatus = 'working' | 'waiting' | 'completed' | 'error' | 'cancelled'

/** Status-only information about a child session created by OpenCode's Task tool. */
export interface OpenCodeSubagent {
  /** Child session ID, or a provisional task-part ID until OpenCode reports it. */
  id: string
  taskId: string
  parentSubagentId?: string
  description: string
  agent?: string
  status: OpenCodeSubagentStatus
  background?: boolean
  startedAt: number
  finishedAt?: number
}

/** The model identity OpenCode expects in a prompt request. */
export interface OpenCodeModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

/** A renderer-friendly model or model variant from OpenCode's live catalog. */
export interface OpenCodeModelOption extends OpenCodeModelSelection {
  key: string
  providerName: string
  modelName: string
  reasoning?: boolean
  toolCall?: boolean
}

/** A permission request emitted by OpenCode while a tool is waiting. */
export interface OpenCodePermissionRequest {
  id: string
  permission: string
  patterns: string[]
  title?: string
}

/** A live assistant text item while OpenCode is still generating. */
export interface OpenCodeLiveTextMessage {
  id: string
  role: 'assistant'
  text: string
  live: true
}

/** A live reasoning item while OpenCode is still generating. */
export interface OpenCodeLiveReasoningMessage extends OpenCodeReasoningMessage {
  live: true
}

/** A live tool item while OpenCode is still generating. */
export interface OpenCodeLiveToolMessage extends OpenCodeToolMessage {
  live: true
  /** Raw tool arguments are available before OpenCode parses them into input. */
  rawInput?: string
}

/** A live permission prompt rendered alongside the current turn. */
export interface OpenCodeLivePermissionMessage extends OpenCodePermissionRequest {
  role: 'permission'
  live: true
  subagentId?: string
  responding?: boolean
}

export type OpenCodeLiveChatItem =
  | OpenCodeLiveTextMessage
  | OpenCodeLiveReasoningMessage
  | OpenCodeLiveToolMessage
  | OpenCodeLivePermissionMessage

export type OpenCodeStreamItem =
  | {
      kind: 'text'
      partId: string
      delta: string
    }
  | {
      kind: 'reasoning'
      partId: string
      delta: string
      done: boolean
      durationMs?: number
    }
  | ({
      kind: 'tool'
      partId: string
      tool: string
      status: OpenCodeToolStatus
      input: Record<string, unknown>
      rawInput?: string
      title?: string
      output?: string
      error?: string
      durationMs?: number
    })
  | {
      kind: 'permission'
      requestId: string
      permission: string
      patterns: string[]
      title?: string
      subagentId?: string
    }
  | {
      kind: 'subagent'
      subagent: OpenCodeSubagent
      replacesId?: string
      permission?: {
        requestId: string
        permission: string
        patterns: string[]
        title?: string
      }
      permissionResolved?: string
    }
  | {
      kind: 'status'
      status: 'busy' | 'idle'
    }

/** A normalized live OpenCode part update pushed over the existing IPC stream. */
export interface OpenCodeStreamChunk {
  sessionId: string
  item: OpenCodeStreamItem
}

export interface SendOpenCodeMessageRequest {
  sessionId: string
  text: string
  model: OpenCodeModelSelection
}

export interface SendOpenCodeMessageResponse {
  sessionId: string
  /** The real OpenCode user-message ID that owns this completed turn. */
  userMessageId: string | null
  messages: OpenCodeChatItem[]
}

export interface OpenCodeRevertState {
  messageID: string
  partID?: string
}

export interface RevertOpenCodeMessageRequest {
  sessionId: string
  messageId: string
}

export interface UnrevertOpenCodeSessionRequest {
  sessionId: string
}

/** A persisted OpenCode conversation available for the current project. */
export interface OpenCodeSessionSummary {
  id: string
  title: string
  directory: string
  createdAt: string
  updatedAt: string
}

export interface ListOpenCodeSessionsRequest {
  sessionId: string
}

export interface CreateOpenCodeSessionRequest {
  sessionId: string
}

export interface ListOpenCodeSessionsResponse {
  sessions: OpenCodeSessionSummary[]
  selectedSessionId: string | null
  undoSupported: boolean
}

export interface ListOpenCodeModelsRequest {
  sessionId: string
}

export interface ListOpenCodeModelsResponse {
  models: OpenCodeModelOption[]
}

export interface SelectOpenCodeSessionRequest {
  sessionId: string
  openCodeSessionId: string
}

export interface OpenCodeConversationResponse {
  sessionId: string
  session?: OpenCodeSessionSummary
  messages: OpenCodeChatItem[]
  revert: OpenCodeRevertState | null
  undoSupported: boolean
}

export interface SendOpenCodePermissionReplyRequest {
  sessionId: string
  requestId: string
  reply: OpenCodePermissionReply
}

export interface PathCheckResult {
  exists: boolean
  /** Populated when the check itself could not run (e.g. distro not running). */
  error?: string
}

/**
 * Result of normalising a path the user picked with the native folder dialog
 * into the format the target expects.
 */
export interface PathResolution {
  /** Path in the target's own format, ready to store on the Session. */
  path: string
  /** Distro parsed out of a \\wsl$\ or \\wsl.localhost\ UNC path, if any. */
  distro?: string
  /** Non-blocking advice to surface inline in the UI. */
  warning?: string
}
