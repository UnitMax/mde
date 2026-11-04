export type ProjectKind = 'native' | 'wsl'

export type CodingAgent = 'opencode' | 'codex' | 'claude'

export type TerminalLaunchDirectory = 'terminal' | 'session'

/** Parsed argv for a coding-agent command; no shell syntax is represented. */
export interface AgentCommand {
  executable: string
  args: string[]
}

/** Metadata only: conversation contents and credentials never cross this API. */
export interface OpenCodeSessionSummary {
  id: string
  title: string
  directory: string
  createdAt: number
  updatedAt: number
  parentId?: string
  archivedAt?: number
  agent?: string
  model?: {
    id: string
    providerId: string
    variant?: string
  }
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
  }
}

export interface OpenCodeSessionsRequest {
  sessionId: string
  sourceTerminalId: string
  executable: string
}

export interface OpenCodeResumeLaunch {
  sourceTerminalId: string
  opencodeSessionId: string
  executable: string
}

export interface TerminalCommandLaunch {
  sourceTerminalId: string
  directory: TerminalLaunchDirectory
  agent?: {
    kind: CodingAgent
    command: AgentCommand
  }
}

export type TerminalLaunch = TerminalCommandLaunch | OpenCodeResumeLaunch

export type SessionIcon =
  | 'computer'
  | 'robot'
  | 'rocket'
  | 'tools'
  | 'bug'
  | 'lightning'
  | 'globe'
  | 'package'
  | 'test'
  | 'palette'

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

/** The main window is either its normal self or the always-on-top mini agents list. */
export type WindowMode = 'normal' | 'mini'

/** Narrow platform union so the renderer does not need Node's types. */
export type HostPlatform = 'win32' | 'linux' | 'darwin' | 'other'

export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface TodoProject {
  id: string
  name: string
  shorthand: string
  nextTaskNumber: number
  columns: TodoColumn[]
  createdAt: string
}

export interface TodoColumn {
  id: string
  name: string
}

export interface TodoTask {
  id: string
  todoProjectId: string
  columnId: string
  number: number
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export type TerminalLayout =
  | 'single'
  | 'columns'
  | 'three'
  | 'quadrant'
  | 'fiveGrid'
  | 'sixGrid'
  | 'sevenGrid'
  | 'eightGrid'
  | 'nineGrid'

export interface TerminalLayoutSizes {
  columnRatio: number
  /** First horizontal divider ratio; the only one for layouts with at most two rows. */
  rowRatio: number
  /** Second vertical divider ratio for three-column layouts. */
  secondColumnRatio?: number
  /** Second horizontal divider ratio for three-row layouts. */
  secondRowRatio?: number
}

export interface PersistedTerminalPane {
  /** Stable logical pane identity; runtime PTY IDs are derived from it. */
  id: string
  /** Optional user-defined title for this pane. */
  title?: string
}

export interface PersistedTerminalLayout {
  layout: TerminalLayout
  panes: PersistedTerminalPane[]
  sizes: TerminalLayoutSizes
}

export interface SessionTab {
  id: string
  name: string
  layout: PersistedTerminalLayout
}

export interface Session {
  id: string
  projectId: string
  name: string
  /** Optional predefined sidebar color; absent means the default Slate color. */
  color?: SessionColor
  /** Optional predefined collapsed-sidebar icon; absent means the session initials. */
  icon?: SessionIcon
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
  createdAt: string
  /** Persisted terminal tabs; absent only for legacy/test-shaped session values. */
  tabs?: SessionTab[]
  /** The tab to restore when this session is selected. */
  activeTabId?: string
}

export type NewProject = Omit<Project, 'id' | 'createdAt'>
export interface NewTodoProject {
  name: string
  shorthand: string
}
export type NewTodoTask = Pick<TodoTask, 'todoProjectId' | 'columnId' | 'title' | 'description'>
export type NewSession = Omit<Session, 'id' | 'createdAt' | 'color' | 'icon' | 'tabs' | 'activeTabId'>

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

/** A local status snapshot written by the optional OpenCode plugin. */
export interface OpenCodeTuiStatusSnapshot {
  protocol: 1
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  /** Current top-level OpenCode conversation title, when reported by the plugin. */
  title?: string
  revision: number
  updatedAt: number
  /** Process identity used only by the main-process liveness check. */
  processId?: number
  /** Linux /proc start-time tick, paired with processId to reject PID reuse. */
  processStartTicks?: number
  /** macOS process start time from ps, paired with processId. */
  processStartedAt?: string
  /** Explicit plugin shutdown marker; distinct from a completed task. */
  closed?: true
}

/** The model an OpenCode conversation uses; identifiers only. */
export interface OpenCodeModelRef {
  id: string
  providerId: string
  variant?: string
}

/**
 * One OpenCode conversation recorded in MDE's own inbox. Only metadata is stored,
 * never prompts or messages. A thread is unread while `lastActivityAt > readAt`.
 */
export interface InboxThread {
  /** Initial prompt failed; the created thread keeps its draft for retry. */
  sendError?: string
  id: string
  title: string
  directory: string
  target: OpenCodePluginTarget
  /** Branch of `directory` at the last recorded activity; null when unknown or detached. */
  branch: string | null
  model?: OpenCodeModelRef
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  createdAt: number
  /** Last time the agent finished, failed, or asked for input (or first seen). */
  lastActivityAt: number
  /**
   * When the current run began, on this computer's clock. Set while the thread is working or waiting
   * for an answer and gone once it stops; a run is not restarted by the agent asking and being answered.
   */
  workingSince?: number
  readAt: number
  archived: boolean
  /** The Inbox folder the thread was started in. */
  folderId: string
  /** The thread this one was forked from, which may since have been removed. */
  forkedFrom?: string
  /** Set when the thread runs in a Git worktree MDE created; `directory` is then inside `root`. */
  worktree?: InboxWorktree
}

/** The Git worktree an Inbox thread was started in. Forks of the thread share it. */
export interface InboxWorktree {
  /** The folder's directory when the worktree was made, where Git commands for it run. */
  repository: string
  /** The worktree's root directory, in the target's own format. */
  root: string
  /** The new branch MDE created for the worktree. */
  branch: string
  /** The branch the worktree was cut from, as the picker showed it (`main`, `origin/main`). */
  base: string
}

/** A branch a worktree can start from, named as the picker shows it. */
export interface InboxGitBranch {
  name: string
  remote: boolean
}

export interface InboxGitInfoRequest {
  folderId: string
}

/** What the new-thread page needs to offer Git worktree mode for a folder. */
export interface InboxGitInfo {
  repository: boolean
  /** The folder's current branch; null for a detached HEAD or a folder that is not a repository. */
  branch: string | null
  /** Local branches, then remote-tracking ones, most recently committed first. */
  branches: InboxGitBranch[]
}

/**
 * A folder the Inbox can start chat threads in. Inbox folders are separate
 * from the Projects view and never change workspace projects or sessions.
 */
export interface InboxFolder {
  id: string
  name: string
  /** Absolute directory in the target's own format. */
  directory: string
  target: OpenCodePluginTarget
  createdAt: number
  lastUsedAt: number
  /**
   * Set when the folder is a Git worktree MDE created for an earlier thread, so that more threads
   * can be started in it. `directory` is then inside `worktree.root`, and every thread started here
   * carries the same record.
   */
  worktree?: InboxWorktree
}

/** The last choices made in the Inbox composer. */
export interface InboxComposerState {
  folderId?: string
  agent?: string
  model?: OpenCodeModelRef
}

export interface InboxFoldersState {
  folders: InboxFolder[]
  composer: InboxComposerState
}

export interface InboxAddFolderRequest {
  kind: ProjectKind
  distro?: string
  path: string
}

export interface InboxRemoveFolderRequest {
  id: string
}

/** An OpenCode agent the composer can pick (primary agents that are not hidden). */
export interface ChatAgent {
  id: string
  name: string
  description?: string
  /** A CSS hex color or a theme color name, as OpenCode reports it. */
  color?: string
}

export interface ChatModel {
  id: string
  providerId: string
  providerName: string
  name: string
  /** The context window in tokens, when OpenCode reports one. */
  contextLimit?: number
  /** The most tokens one reply can have, when OpenCode reports it. */
  outputLimit?: number
}

/** A skill a sent message invoked. */
export interface ChatSkillUse {
  id: string
  name: string
}

/** A skill the user can invoke by writing `$id` in a message. */
export interface ChatSkill {
  /** What follows the `$`: the skill's directory name, which can differ from `name`. */
  id: string
  name: string
  description?: string
}

export interface ChatOptions {
  agents: ChatAgent[]
  models: ChatModel[]
  defaultModel: OpenCodeModelRef | null
  defaultAgent: string | null
  /** The skills available in this folder, built-in ones included. Empty when OpenCode could not list them. */
  skills: ChatSkill[]
}

/** Token counts for one model step, or summed over a whole thread. */
export interface ChatTokens {
  /** Prompt tokens that were not served from the cache. */
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** What a thread has used in total, as OpenCode reports it for the session. */
export interface ChatUsage {
  tokens: ChatTokens
  /** The cost OpenCode reports, in US dollars; many providers report 0. */
  cost: number
}

export type ChatToolStatus = 'pending' | 'running' | 'completed' | 'error'

/** One file's change as OpenCode reports it: a unified diff, possibly truncated. */
export interface ChatFilePatch {
  path: string
  patch: string
}

/**
 * One tool a Code Mode script called, as OpenCode lists it in the tool part's metadata. `tool` is
 * `<namespace>.<name>`: the namespace is an MCP server's name (normalised) or a built-in group such as `browser`.
 * OpenCode reports no result or time per call, only for the whole script.
 */
export interface ChatToolCall {
  tool: string
  status: ChatToolStatus
  /** The call's arguments as compact JSON, possibly truncated. */
  input: string
}

export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      status: ChatToolStatus
      /** Pretty-printed tool input, possibly truncated. */
      input: string
      /** Text output, possibly truncated. */
      output?: string
      error?: string
      truncated?: boolean
      /** The tools a Code Mode script (`execute`) called, in order. */
      calls?: ChatToolCall[]
      /** How long the tool ran, in milliseconds, once it has finished. */
      durationMs?: number
      /** What an edit changed, once the tool has finished. */
      patches?: ChatFilePatch[]
      /** For a file write: whether the file was already there. Known once the tool has finished. */
      existed?: boolean
    }

export type ChatMessage =
  | { kind: 'user'; id: string; time: number; text: string; attachments?: ChatAttachment[]; skills?: ChatSkillUse[] }
  | {
      kind: 'assistant'
      id: string
      time: number
      agent: string
      model: OpenCodeModelRef
      parts: ChatPart[]
      completed: boolean
      /** When the step finished, on the service's clock; absent while it runs. */
      completedAt?: number
      /**
       * When the model stopped generating, on the service's clock; absent while it still does. Tools
       * the step ran afterwards come between this and `completedAt`.
       */
      streamedAt?: number
      error?: string
      /** What the step used, once OpenCode has reported it. */
      tokens?: ChatTokens
    }
  /** Agent or model switches, compaction, shell commands, and other notes. */
  | { kind: 'note'; id: string; time: number; tone: 'info' | 'error'; text: string; detail?: string }

/** One file a staged revert restored, as OpenCode summarizes it (without the diff). */
export interface ChatRevertFile {
  path: string
  status: 'added' | 'deleted' | 'modified'
  additions: number
  deletions: number
}

/**
 * A revert OpenCode has staged: the conversation from `messageId` on is hidden, and the files its
 * steps changed were restored. Redoing brings it all back; the next message makes it permanent.
 */
export interface ChatRevert {
  /** The first message that is hidden. Message IDs sort in the order the messages were written. */
  messageId: string
  files: ChatRevertFile[]
}

/** Reverts a thread to just before one of the user's messages. */
export interface ChatRevertRequest {
  threadId: string
  /** The user message to revert to: it and everything after it is hidden. */
  messageId: string
  /** Whether the files the agent changed from there on are put back. Left out means they are. */
  files?: boolean
}

/**
 * Forks a thread into a new one. The new thread is a separate OpenCode session that starts with a
 * copy of the conversation and goes on from there; the original is not changed.
 */
export interface ChatForkRequest {
  threadId: string
  /**
   * Fork from just before this message, which is not copied. Left out, the whole conversation is
   * copied, except what a staged revert hides and, while the agent is working, the unfinished turn.
   */
  messageId?: string
}

export interface ChatForkResult {
  /** The new thread, already recorded in the Inbox. */
  thread: InboxThread
  /**
   * The text of the unfinished turn's message when the fork was cut before it, so the new thread can
   * offer it again. Absent when the fork was not cut for that reason.
   */
  text?: string
}

/**
 * How a message sent to a busy agent reaches it. `steer`: the agent reads it at its next step. `queue`:
 * it waits until the agent is done.
 */
export type ChatDelivery = 'steer' | 'queue'

/**
 * A message of the user that OpenCode has accepted but not yet handed to the agent, because the agent
 * was busy. It is not in the conversation until it is delivered, and then it keeps its `id`.
 */
export interface ChatPendingMessage {
  id: string
  /** OpenCode keeps either one until the agent next runs, so after a Stop a message can wait with nothing running. */
  delivery: ChatDelivery
  /** The message as the conversation will show it. */
  message: Extract<ChatMessage, { kind: 'user' }>
}

export interface ChatMessagesPage {
  /** Oldest first. */
  messages: ChatMessage[]
  /** Cursor for the next older page, or null at the start of the thread. */
  older: string | null
  /** Whether OpenCode is currently running this thread. */
  running: boolean
  /** The thread's totals; only on the newest page, and only when OpenCode answered. */
  usage?: ChatUsage
  /**
   * The staged revert, or null when there is none. Like `usage` it comes with the newest page only;
   * it is absent on older pages and when OpenCode did not answer, which means "unknown", not "none".
   * The messages are all of them: hiding the reverted ones is up to the reader.
   */
  revert?: ChatRevert | null
  /**
   * The user's messages OpenCode holds for the agent, oldest first. Like `usage` it comes with the
   * newest page only, and is absent when OpenCode did not answer, which means "unknown", not "none".
   */
  pending?: ChatPendingMessage[]
}

export interface ChatPermission {
  id: string
  action: string
  resources: string[]
  message?: string
}

export interface ChatFormOption {
  value: string
  label: string
  description?: string
}

export interface ChatFormField {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect'
  title?: string
  description?: string
  required: boolean
  options: ChatFormOption[]
  /** Whether a free-text answer is allowed besides the options. */
  custom: boolean
  placeholder?: string
}

export interface ChatForm {
  id: string
  title: string
  fields: ChatFormField[]
  /** Fields MDE cannot show; such a form has to be answered in a terminal. */
  unsupported: boolean
}

export interface ChatRequests {
  permissions: ChatPermission[]
  forms: ChatForm[]
}

export type ChatFormValue = string | number | boolean | string[]

export interface ChatConfigureRequest {
  executable: string
}

/** Options for a folder (new thread) or for an existing thread; exactly one is given. */
export interface ChatOptionsRequest {
  folderId?: string
  threadId?: string
}

/**
 * How an MCP server stands, as far as MDE tells apart. OpenCode's `pending` is `connecting`, `needs_auth` is
 * `needs-auth`, and anything it adds later is `unknown`.
 */
export type ChatMcpStatus = 'connected' | 'connecting' | 'disabled' | 'failed' | 'needs-auth' | 'unknown'

/** One MCP server OpenCode has configured for a folder. Commands, URLs, headers and environment are never sent. */
export interface ChatMcpServer {
  name: string
  /** A display name the server gave itself, when it differs from `name`. */
  title?: string
  status: ChatMcpStatus
  /** Why a `failed` or `needs-auth` server is not usable: one line, with paths and secrets removed. */
  error?: string
}

export interface ChatMcpState {
  servers: ChatMcpServer[]
  /** False when this OpenCode has no MCP list at all, so there is nothing to show. */
  supported: boolean
}

/** The MCP servers of a folder (new thread) or of an existing thread; exactly one is given. */
export type ChatMcpRequest = ChatOptionsRequest

/** Connects (`enabled`) or disconnects one server for the running OpenCode. Nothing is written to its configuration. */
export type ChatMcpSetRequest = ChatOptionsRequest & { server: string; enabled: boolean }

export interface ChatCreateRequest {
  attachmentIds?: string[]
  draftRevision?: number
  /** The new-thread draft this starts from (`drf_…`): its files are sent and it is removed once the thread has its first message. */
  draftId?: string
  folderId: string
  text: string
  agent: string
  model: OpenCodeModelRef
  /**
   * Run the thread in a new Git worktree cut from `base`, instead of in the folder itself. `branch`
   * names the new branch; without it MDE generates `mde/<id>`.
   */
  worktree?: { base: string; branch?: string }
}

export interface ChatThreadRequest {
  threadId: string
}

export interface ChatMessagesRequest {
  threadId: string
  /** Cursor from a previous page's `older`; omitted for the newest page. */
  cursor?: string
}

export interface ChatSendRequest {
  attachmentIds?: string[]
  draftRevision?: number
  threadId: string
  text: string
  agent?: string
  model?: OpenCodeModelRef
  /** How the message reaches an agent that is busy; an idle agent takes it up at once either way. OpenCode steers when this is left out. */
  delivery?: ChatDelivery
}

export interface ChatDiscardPendingRequest {
  threadId: string
  /** The `id` of a {@link ChatPendingMessage}. */
  messageId: string
}

export interface ChatSetDeliveryRequest {
  threadId: string
  /** The `id` of a {@link ChatPendingMessage}. */
  messageId: string
  delivery: ChatDelivery
}

export interface ChatPermissionReplyRequest {
  threadId: string
  requestId: string
  decision: 'once' | 'always' | 'reject'
}

export interface ChatFormReplyRequest {
  threadId: string
  formId: string
  answer: Record<string, ChatFormValue>
}

/** Live changes for subscribed chat threads, pushed from the main process. */
export type ChatEvent =
  | { type: 'delta'; threadId: string; messageId: string; part: 'text' | 'reasoning'; ordinal: number; delta: string }
  /** The thread's messages changed; refetch the newest page. */
  | { type: 'messages'; threadId: string }
  /** Pending permissions or questions changed; refetch them. */
  | { type: 'requests'; threadId: string }
  | { type: 'running'; threadId: string; running: boolean }
  /** The service connection was lost and restored; refetch everything. */
  | { type: 'reconnected'; threadId: string }
  /** An MCP server of this target changed (connected, failed, lost its tools); not tied to one thread. */
  | { type: 'mcp'; target: OpenCodePluginTarget }

export interface InboxSetReadRequest {
  id: string
  read: boolean
}

export interface InboxSetArchivedRequest {
  id: string
  archived: boolean
}

export interface InboxRemoveRequest {
  id: string
  /** Also remove the thread's Git worktree, which Git refuses while it has uncommitted changes. */
  removeWorktree?: boolean
}

/** Main-process status transition for one MDE workspace session. */
export interface OpenCodeTuiStatusUpdate {
  sessionId: string
  status: OpenCodeTuiStatus | null
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
}

/** Status of one OpenCode TUI process, identified by its owning terminal pane. */
export interface OpenCodeTuiInstanceStatus {
  terminalId: string
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  title?: string
  revision: number
}

/** Complete live OpenCode TUI instance list for one MDE workspace session. */
export interface OpenCodeTuiInstancesUpdate {
  sessionId: string
  instances: OpenCodeTuiInstanceStatus[]
}

export type OpenCodeTuiPluginInstallStatus =
  | 'not-installed'
  | 'installed'
  | 'outdated'
  | 'conflict'

export type OpenCodeTuiInstanceLabelMode = 'numbered' | 'title'

export interface OpenCodeTuiSettings {
  enabled: boolean
  currentPluginVersion: string
  instanceLabelMode: OpenCodeTuiInstanceLabelMode
}

export interface OpenCodeTuiSetEnabledRequest {
  enabled: boolean
}

export interface OpenCodeTuiSetInstanceLabelModeRequest {
  mode: OpenCodeTuiInstanceLabelMode
}

export interface OpenCodeTuiPluginRequest {
  target: OpenCodePluginTarget
}

export interface OpenCodeTuiPluginState {
  target: OpenCodePluginTarget
  status: OpenCodeTuiPluginInstallStatus
  installedVersion: string | null
  currentVersion: string
}

export type OpenCodePluginTarget =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string }

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
  /** Runtime terminal identity for the pane that exited. */
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

/** The folders directly inside one folder of a WSL distro, for the in-app folder browser. */
export interface WslDirectoryListing {
  /** The absolute Linux path that was listed (the home directory when none was asked for). */
  path: string
  /** Folder names, sorted, without any path. */
  directories: string[]
  /** More folders exist than were returned. */
  truncated: boolean
}

/** A single commit shown by the read-only Git history view. */
export interface GitCommit {
  /** Full object ID; the renderer may shorten this for display. */
  hash: string
  message: string
  /** Display name recorded for the commit author. */
  author: string
  /** ISO-8601 committer timestamp from Git. */
  timestamp: string
}

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked'

/** A file changed relative to HEAD in the current Git worktree. */
export interface GitChange {
  /** Path relative to the Git command's working directory. */
  path: string
  /** Original path for Git-detected renames and copies. */
  oldPath: string | null
  status: GitChangeStatus
  staged: boolean
  unstaged: boolean
}

export interface GitInfoResponse {
  repository: boolean
  /** Null when the repository is in a detached HEAD state. */
  branch: string | null
  commits: GitCommit[]
  changes: GitChange[]
}

/** Lightweight Git state used by session lists. */
export interface GitStatusResponse {
  repository: boolean
  /** Null when the repository is in a detached HEAD state. */
  branch: string | null
  /** Tracked additions relative to HEAD, including staged and unstaged work. */
  additions: number
  /** Tracked deletions relative to HEAD, including staged and unstaged work. */
  deletions: number
  /** Commits ahead of the configured upstream, or null when no upstream exists. */
  commitsAhead: number | null
}

/** Lightweight Git identity for one live terminal working directory. */
export interface GitTerminalInfoResponse {
  repository: boolean
  /** Null when the repository is in a detached HEAD state. */
  branch: string | null
  /** Absolute root of the Git worktree containing the terminal directory. */
  worktree: string | null
}

export interface GitDiffResponse {
  path: string
  diff: string
  binary: boolean
}

export type FileTreeEntryKind = 'directory' | 'file' | 'symlink' | 'other'

/** One child of a listed session directory. Symlinks are reported, never followed. */
export interface FileTreeEntry {
  name: string
  kind: FileTreeEntryKind
}

export interface FileTreeListResponse {
  /** Directory path relative to the session root; '' is the root itself. */
  path: string
  entries: FileTreeEntry[]
  /** True when the directory held more entries than the listing returns. */
  truncated: boolean
}

/** One file read for the viewer. Content is omitted for binary or oversized files. */
export interface FileReadResponse {
  /** File path relative to the session root. */
  path: string
  content: string | null
  size: number
  binary: boolean
  tooLarge: boolean
}

/**
 * A draft belongs to a thread, or is a new thread not yet started (`draft:drf_…`): the Inbox lists
 * those, and any number of them can wait, each for the folder it was written for.
 */
export type ChatDraftKey = `thread:${string}` | `draft:${string}`
export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
  thumbnail?: string
}
export interface ChatDraft {
  revision: number
  text: string
  attachments: ChatAttachment[]
}
export type ChatDraftRequest = (
  | { key: ChatDraftKey; action: 'load' | 'flush' | 'clear' }
  | { key: ChatDraftKey; action: 'text'; text: string }
  /** Puts text above what the draft already holds. */
  | { key: ChatDraftKey; action: 'prepend'; text: string }
  | { key: ChatDraftKey; action: 'add'; name: string; mime: string; data: Uint8Array }
  | { key: ChatDraftKey; action: 'tree'; sessionId: string; path: string }
  | { key: ChatDraftKey; action: 'remove'; attachmentId: string }
) & {
  /** The folder a new-thread draft is for. Every change to such a draft names it, so the draft can be listed and reopened there. */
  folderId?: string
  /** How the new thread would start, as it is now; it replaces what the draft remembered. Left out while that is not known yet. */
  choice?: ChatDraftChoice
}

/** What a new thread's draft remembers of how it would start, so reopening it brings the same choices back. */
export interface ChatDraftChoice {
  agent?: string
  model?: OpenCodeModelRef
  /** The thread would run in a new Git worktree cut from `base`; `branch` is the name typed for it, valid or not yet. */
  worktree?: { base: string; branch?: string }
}

/** One unsent new thread, as the Inbox sidebar lists it. Only what the row shows; the draft itself is read by its composer. */
export interface ChatDraftSummary {
  /** `drf_…`; the draft's key is `draft:<id>`. */
  id: string
  folderId: string
  /** The start of the text, cut at a bounded length. */
  preview: string
  /** How many files are attached, and the name of the first. */
  attachments: number
  attachmentName?: string
  updatedAt: number
  choice?: ChatDraftChoice
}

/** What the sidebar knows about unsent text. */
export interface ChatDraftList {
  /** The new threads that were started and not sent. */
  drafts: ChatDraftSummary[]
  /** The threads in the Inbox with an unsent message in their box. */
  threads: string[]
}

/** Git changes in the checkout a thread uses, relative to HEAD. Memory only. */
export interface InboxChangesRequest {
  threadId: string
  details?: boolean
}

export interface InboxChangedFile {
  path: string
  status: GitChangeStatus
  additions: number
  deletions: number
  binary?: boolean
}

export interface InboxChangeDiffRequest {
  threadId: string
  path: string
}

export interface InboxChangeDiff extends GitDiffResponse {
  truncated: boolean
}

export interface InboxChangesResponse {
  branch: string | null
  worktree: string | null
  available: boolean
  reason?: string
  additions: number
  deletions: number
  fileCount: number
  /** Untracked files past the counting limit: listed, but their line counts are left out of the totals. */
  uncounted?: number
  files?: InboxChangedFile[]
}
