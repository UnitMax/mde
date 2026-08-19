export type ProjectKind = 'native' | 'wsl'

export type SessionMode = 'terminal' | 'gui'

/** Built-in OpenCode primary agents selectable from the GUI. */
export type OpenCodeAgent = 'build' | 'plan'

export type SessionColor =
  | 'default'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'plum'
  | 'rose'
  | 'red'
  | 'orange'
  | 'green'
  | 'teal'

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
  /** Optional predefined sidebar color; absent means the default Slate color. */
  color?: SessionColor
  mode: SessionMode
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
export type NewSession = Omit<Session, 'id' | 'createdAt' | 'color'>

export interface Distro {
  name: string
  state: string
  version: number
  isDefault: boolean
}

/** Lifecycle of the PTY belonging to a session, as tracked by the main process. */
export type PtyStatus = 'none' | 'running' | 'exited'

export type OpenCodeTuiStatus = 'idle' | 'working' | 'attention' | 'completed' | 'error'

export type OpenCodeTuiAttentionReason = 'permission' | 'question'

/** A privacy-safe status snapshot written by the optional WSL TUI plugin. */
export interface OpenCodeTuiStatusSnapshot {
  protocol: 1
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
  updatedAt: number
}

/** Main-process status transition for one MDE workspace session. */
export interface OpenCodeTuiStatusUpdate {
  sessionId: string
  status: OpenCodeTuiStatus | null
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
}

export type OpenCodeTuiPluginInstallStatus =
  | 'not-installed'
  | 'installed'
  | 'outdated'
  | 'conflict'

export interface OpenCodeTuiSettings {
  enabled: boolean
  currentPluginVersion: string
}

export interface OpenCodeTuiSetEnabledRequest {
  enabled: boolean
}

export interface OpenCodeTuiPluginRequest {
  distro: string
}

export interface OpenCodeTuiPluginState {
  distro: string
  status: OpenCodeTuiPluginInstallStatus
  installedVersion: string | null
  currentVersion: string
}

export type OpenCodePluginTarget =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string }

export type OpenCodeTokenRatePluginInstallStatus =
  | 'not-installed'
  | 'installed'
  | 'outdated'
  | 'conflict'
  | 'unsupported'
  | 'unavailable'
  | 'repair-needed'

export interface OpenCodeTokenRatePluginRequest {
  target: OpenCodePluginTarget
}

export interface OpenCodeTokenRatePluginState {
  target: OpenCodePluginTarget
  status: OpenCodeTokenRatePluginInstallStatus
  installedVersion: string | null
  currentVersion: string
  opencodeVersion: string | null
  registered: boolean
}

export type OpenCodeAlertKind = 'attention' | 'completed' | 'error'
export type OpenCodeAlertSource = 'tui' | 'gui'

export interface OpenCodeAlertEvent {
  sessionId: string
  source: OpenCodeAlertSource
  kind: OpenCodeAlertKind
  attentionReason?: OpenCodeTuiAttentionReason
}

export interface OpenCodeAlertSettings {
  enabled: boolean
}

export interface OpenCodeAlertSetEnabledRequest {
  enabled: boolean
}

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyExitInfo {
  sessionId: string
  /** Runtime terminal identity; the primary terminal uses the session id. */
  terminalId: string
  exitCode: number
  signal?: number
}

export interface PtyDataChunk {
  terminalId: string
  data: string
}

export interface PtyDirectoryUpdate {
  terminalId: string
  directory: string | null
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
  /** Maximum input context reported by OpenCode for this model. */
  contextWindow?: number
}

/** A permission request emitted by OpenCode while a tool is waiting. */
export interface OpenCodePermissionRequest {
  id: string
  permission: string
  patterns: string[]
  title?: string
}

export interface OpenCodeQuestionOption {
  label: string
  description: string
}

/** A prompt in an OpenCode question request. */
export interface OpenCodeQuestionPrompt {
  question: string
  header: string
  options: OpenCodeQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

/** A renderer-safe question request waiting for user input. */
export interface OpenCodeQuestionRequest {
  id: string
  questions: OpenCodeQuestionPrompt[]
}

export type OpenCodeQuestionAnswers = string[][]

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

/** A live question request rendered alongside the current turn. */
export interface OpenCodeLiveQuestionMessage extends OpenCodeQuestionRequest {
  role: 'question'
  live: true
  subagentId?: string
  responding?: boolean
}

export type OpenCodeLiveChatItem =
  | OpenCodeLiveTextMessage
  | OpenCodeLiveReasoningMessage
  | OpenCodeLiveToolMessage
  | OpenCodeLivePermissionMessage
  | OpenCodeLiveQuestionMessage

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
      kind: 'question'
      requestId: string
      status: 'asked'
      questions: OpenCodeQuestionPrompt[]
      subagentId?: string
    }
  | {
      kind: 'question'
      requestId: string
      status: 'replied' | 'rejected'
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
  | {
      kind: 'compaction'
      status: 'started' | 'completed' | 'error'
      automatic: boolean
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
  agent: OpenCodeAgent
}

export interface AbortOpenCodeSessionRequest {
  sessionId: string
}

export interface SendOpenCodeMessageResponse {
  sessionId: string
  /** The real OpenCode user-message ID that owns this completed turn. */
  userMessageId: string | null
  messages: OpenCodeChatItem[]
  contextUsage: OpenCodeContextUsage | null
  generationStats: OpenCodeGenerationStats | null
}

/** The latest reported model context usage for an OpenCode conversation. */
export interface OpenCodeContextUsage {
  /** Model input tokens, including provider-reported cache tokens. */
  usedTokens: number
  /** The selected model's configured context limit. */
  contextWindow: number
  /** `usedTokens / contextWindow * 100`. */
  percentage: number
  model: OpenCodeModelSelection
}

export type OpenCodeGenerationPhase = 'thinking' | 'tool' | 'response'

/** Exact token statistics reported after a generated OpenCode turn completes. */
export interface OpenCodeGenerationStats {
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  durationMs: number | null
  tokensPerSecond: number | null
  timeToFirstTokenMs: number | null
}

/** Renderer-owned live generation state built from streamed OpenCode deltas. */
export interface OpenCodeLiveGenerationState {
  startedAt: number
  firstTokenAt: number | null
  lastTokenAt: number | null
  phase: OpenCodeGenerationPhase | null
  estimatedTokens: number
  toolWaiting: boolean
  toolInputSnapshots: Record<string, string>
}

export interface OpenCodeGenerationState {
  status: 'running' | 'completed' | 'cancelled'
  live: OpenCodeLiveGenerationState | null
  final: OpenCodeGenerationStats | null
}

/** Slash commands supported directly by the MDE OpenCode GUI. */
export type OpenCodeSlashCommand = 'compact' | 'init'

export interface ExecuteOpenCodeCommandRequest {
  sessionId: string
  command: OpenCodeSlashCommand
  model: OpenCodeModelSelection
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
  agent: OpenCodeAgent
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
  contextUsage: OpenCodeContextUsage | null
  generationStats?: OpenCodeGenerationStats | null
}

export interface SendOpenCodePermissionReplyRequest {
  sessionId: string
  requestId: string
  reply: OpenCodePermissionReply
}

export interface SendOpenCodeQuestionReplyRequest {
  sessionId: string
  requestId: string
  answers: OpenCodeQuestionAnswers
}

export interface SendOpenCodeQuestionRejectRequest {
  sessionId: string
  requestId: string
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
