import type { FileRoot } from './ipc'

export type SessionKind = 'native' | 'wsl'

/** Parsed argv for the OpenCode command an Inbox terminal thread runs; no shell syntax is represented. */
export interface AgentCommand {
  executable: string
  args: string[]
}

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

/** The main window is either its normal self or the always-on-top mini Inbox. */
export type WindowMode = 'normal' | 'mini'

/** Narrow platform union so the renderer does not need Node's types. */
export type HostPlatform = 'win32' | 'linux' | 'darwin' | 'other'

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

export type TerminalSplitSide = 'left' | 'right' | 'top' | 'bottom'
export type TerminalResizeAxis = 'column' | 'row'

export type TerminalLayoutNode =
  | { type: 'pane'; paneId: string }
  | {
      type: 'split'
      id: string
      axis: TerminalResizeAxis
      ratio: number
      first: TerminalLayoutNode
      second: TerminalLayoutNode
    }

export interface PersistedTerminalPane {
  /** Stable logical pane identity; runtime PTY IDs are derived from it. */
  id: string
  /** Optional user-defined title for this pane. */
  title?: string
}

export interface PersistedTerminalLayout {
  tree: TerminalLayoutNode
  panes: PersistedTerminalPane[]
}

export interface SessionTab {
  id: string
  name: string
  layout: PersistedTerminalLayout
}

export interface Session {
  id: string
  name: string
  /** Optional predefined sidebar color; absent means the default Slate color. */
  color?: SessionColor
  /** Optional predefined collapsed-sidebar icon; absent means the session initials. */
  icon?: SessionIcon
  kind: SessionKind
  /** Required when kind === 'wsl', e.g. "Ubuntu-24.04". */
  distro?: string
  /** Optional shell override; default is resolved per platform. */
  shell?: string
  createdAt: string
  /** Persisted terminal tabs; absent only for legacy/test-shaped session values. */
  tabs?: SessionTab[]
  /** The tab to restore when this session is selected. */
  activeTabId?: string
}

/** Runtime filesystem root resolved from a live terminal or an Inbox folder. Never stored as a session. */
export type DirectoryContext = Session & { path: string }

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

export type InboxThreadStatus = 'idle' | 'working' | 'attention' | 'completed' | 'error'

export type InboxAttentionReason = 'permission' | 'question'

/** The model an OpenCode conversation uses; identifiers only. */
export interface OpenCodeModelRef {
  id: string
  providerId: string
  variant?: string
}

export type InboxThreadMode = 'gui' | 'terminal'

/**
 * One OpenCode conversation recorded in MDE's own inbox. Only metadata is stored,
 * never prompts or messages. A thread is unread while `lastActivityAt > readAt`.
 */
export interface InboxThread {
  /** Omitted for existing GUI threads. Terminal threads attach to this same API session. */
  mode?: InboxThreadMode
  /** Initial prompt failed; the created thread keeps its draft for retry. */
  sendError?: string
  id: string
  title: string
  /** Local display override; the OpenCode title continues to update separately. */
  customTitle?: string
  directory: string
  target: OpenCodeTarget
  /** Branch of `directory` at the last recorded activity; null when unknown or detached. */
  branch: string | null
  model?: OpenCodeModelRef
  status: InboxThreadStatus
  attentionReason?: InboxAttentionReason
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
  /** Keeps the thread at the top of the sidebar list, including while it is working. */
  pinned?: boolean
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

/** The built-in pictures a project can have, drawn from MDE's own icon set. */
export type InboxFolderSymbol =
  | 'folder' | 'repository' | 'code' | 'terminal' | 'braces' | 'bug' | 'rocket' | 'web' | 'server' | 'database'
  | 'cloud' | 'chip' | 'package' | 'boxes' | 'layers' | 'wrench' | 'hammer' | 'gear' | 'lab' | 'tests'
  | 'design' | 'brush' | 'pen' | 'document' | 'book' | 'learning' | 'work' | 'company' | 'shop' | 'mobile'
  | 'desktop' | 'game' | 'music' | 'camera' | 'video' | 'mail' | 'chat' | 'bot' | 'sparkles' | 'lightning'
  | 'fire' | 'nature' | 'star' | 'heart' | 'security' | 'key' | 'compass' | 'map' | 'idea' | 'puzzle'
  | 'target' | 'trophy' | 'chart' | 'home' | 'network'

/** The tints a built-in project picture can have; without one it takes the text color around it. */
export type InboxFolderColor =
  | 'blue' | 'indigo' | 'violet' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'teal'

/** What the sidebar shows for a project: one of the built-in pictures, tinted, or a single emoji. */
export type InboxFolderIcon =
  | { kind: 'symbol'; id: InboxFolderSymbol; color?: InboxFolderColor }
  | { kind: 'emoji'; emoji: string }

/**
 * A folder the Inbox can start chat threads in. Inbox folders are separate
 * from the Sessions view and never change workspace sessions. The Inbox calls them projects.
 */
export interface InboxFolder {
  id: string
  name: string
  /** Absolute directory in the target's own format. */
  directory: string
  target: OpenCodeTarget
  createdAt: number
  lastUsedAt: number
  /** Shown next to the project's threads; absent means the plain folder picture. */
  icon?: InboxFolderIcon
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
  kind: SessionKind
  distro?: string
  path: string
  /** What to call the project; absent means the folder's own name. */
  name?: string
  icon?: InboxFolderIcon
}

/** Changes what the project manager can edit; the folder itself stays. `icon: null` takes the picture away. */
export interface InboxUpdateFolderRequest {
  id: string
  name?: string
  icon?: InboxFolderIcon | null
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
  /** Selectable variant IDs, in the order OpenCode reports them. Absent when none are offered. */
  variants?: string[]
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

/** A file or folder a sent message named with `@path`; `text` is as it was written, with the `@` and any quotes. */
export interface ChatFileMention {
  text: string
  /** Relative to the folder the thread works in; a folder's ends in `/`. */
  path: string
  directory: boolean
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
      /** The child session reported by a subagent call, with its selected model when available. */
      subagent?: { sessionId: string; model?: OpenCodeModelRef }
      /** How long the tool ran, in milliseconds, once it has finished. */
      durationMs?: number
      /** What an edit changed, once the tool has finished. */
      patches?: ChatFilePatch[]
      /** For a file write: whether the file was already there. Known once the tool has finished. */
      existed?: boolean
      /** For a shell command: the exit code, once it has finished. */
      exitCode?: number
      /** For the question tool: what was answered to each question, once the person has answered. */
      answers?: string[][]
    }

export type ChatMessage =
  | { kind: 'user'; id: string; time: number; text: string; attachments?: ChatAttachment[]; skills?: ChatSkillUse[]; mentions?: ChatFileMention[] }
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
  | {
      kind: 'note'
      id: string
      time: number
      tone: 'info' | 'error'
      text: string
      detail?: string
      compaction?: ChatCompaction
      goal?: ChatGoalNote
      /** Routine work or context notifications that can join a compact activity group. */
      activity?: 'shell' | 'skill' | 'notice'
    }

/**
 * What a note says about a goal: OpenCode writes a message into the conversation when a goal is set, when it
 * is resumed, and each time its reviewer finds the goal not met yet and asks the agent to go on.
 */
export type ChatGoalNote = 'set' | 'resume' | 'continue'

/**
 * A goal OpenCode keeps for a session (`/goal`): an objective the agent works toward across turns, until a
 * reviewer finds it met. The state lives in OpenCode; MDE only reads and changes it.
 */
export interface ChatGoal {
  id: string
  objective: string
  /** `complete` is a goal the reviewer found met. */
  status: 'active' | 'paused' | 'complete'
  /**
   * Why the goal is in this state: the reviewer's finding while it goes on (what is still missing), the
   * evidence once it is met, or the reason it stopped. Absent when OpenCode gave none.
   */
  reason?: string
  /** How many times the reviewer has sent the agent back to work. */
  rounds: number
  /** OpenCode pauses the goal when `rounds` reaches this. */
  maxRounds: number
  /** In a row, the rounds in which the agent made no progress; OpenCode pauses the goal after a few. */
  stalls?: number
  /** When the goal last changed, in milliseconds since the epoch, by the service's clock. */
  updatedAt: number
}

/** What to do with a thread's goal: set one, or pause, resume or clear the one it has. */
export type ChatGoalRequest =
  | { threadId: string; action: 'set'; objective: string; agent?: string; model?: OpenCodeModelRef }
  | { threadId: string; action: 'pause' | 'resume' | 'clear' }

/**
 * What a note says about a compaction, which OpenCode writes into the conversation when it summarizes it
 * to free up context: it is running, done (the note's detail is the summary) or failed.
 */
export interface ChatCompaction {
  status: 'running' | 'completed' | 'failed'
  /** `auto` when OpenCode did it because the window was full, `manual` when it was asked for. */
  reason: 'auto' | 'manual'
  /** About how many tokens the summary takes, when OpenCode reported it. */
  summaryTokens?: number
}

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
  /**
   * Whether OpenCode holds a compaction for when the agent is done (asked for while it was busy). Like
   * `pending` it comes with the newest page only, and is absent when OpenCode did not answer.
   */
  compactionHeld?: boolean
}

export interface ChatPermission {
  id: string
  action: string
  resources: string[]
  message?: string
  incomplete?: boolean
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

/** One file or folder of the project, as the `@` picker lists it. */
export interface ChatFileEntry {
  /** Relative to the folder, written with `/`; a folder's ends in `/`. */
  path: string
  directory: boolean
}

/** The files and folders of a folder (new thread) or of an existing thread that fit `query`, best first; exactly one place is given. */
export type ChatFilesRequest = ChatOptionsRequest & { query: string }

/**
 * Which of these paths exist in the folder or thread (a path without the closing `/` also finds a folder).
 * Answers with the ones that do, each with the path as it was asked.
 */
export type ChatFilesCheckRequest = ChatOptionsRequest & { paths: string[] }

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
  mode?: InboxThreadMode
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

/** A running job owned by the thread or one of its subagents, as reported by OpenCode. */
export interface ChatBackgroundTask {
  id: string
  kind: 'shell' | 'subagent' | 'image' | 'other'
  title: string
  command?: string
  startedAt?: number
}

export interface ChatBackgroundState {
  supported: boolean
  tasks: ChatBackgroundTask[]
}

export interface ChatMessagesRequest {
  threadId: string
  /** Cursor from a previous page's `older`; omitted for the newest page. */
  cursor?: string
}

/** Search over the text of all the Inbox's threads (Ctrl+Shift+F). */
export interface ChatSearchRequest {
  query: string
}

/** One message with the query in it: a stretch of its text around the first match, cut into the part before, the match and the part after. */
export interface ChatSearchHit {
  messageId: string
  role: 'user' | 'assistant'
  before: string
  match: string
  after: string
}

export interface ChatSearchResult {
  threadId: string
  /** The newest messages with the query in them, newest first; there may be more (`hitCount`). */
  hits: ChatSearchHit[]
  /** How many messages of the thread have the query in them. */
  hitCount: number
}

export interface ChatSearchResponse {
  /** Threads with a match, the most recently active first. */
  results: ChatSearchResult[]
  /** Threads read so far and threads there are; the search is complete when they are equal, and until then asking again finds more. */
  indexed: number
  total: number
  /** More threads matched than are listed. */
  truncated: boolean
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

/**
 * A side question about a thread: OpenCode answers it from the conversation so far, and neither the
 * question nor the answer becomes part of the conversation. It can be asked while the agent works.
 */
export interface ChatAsideRequest {
  threadId: string
  question: string
}

export interface ChatAsideAnswer {
  /** The answer, in Markdown. */
  text: string
  /** The question and answer as kept in the thread's history. */
  entry: ChatAsideEntry
}

/** An answered side question, kept so it can be looked at again. */
export interface ChatAsideEntry {
  id: string
  question: string
  /** The answer, in Markdown. */
  answer: string
  /** When the answer arrived, in milliseconds since the epoch. */
  askedAt: number
}

export interface ChatAsideHistoryRequest {
  threadId: string
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
  | { type: 'background'; threadId: string }
  | { type: 'delta'; threadId: string; messageId: string; part: 'text' | 'reasoning'; ordinal: number; delta: string }
  /** The thread's messages changed; refetch the newest page. */
  | { type: 'messages'; threadId: string }
  /** Pending permissions or questions changed; refetch them. */
  | { type: 'requests'; threadId: string }
  | { type: 'running'; threadId: string; running: boolean }
  /** The thread's goal was set, changed or cleared (null). */
  | { type: 'goal'; threadId: string; goal: ChatGoal | null }
  /** The service connection was lost and restored; refetch everything. */
  | { type: 'reconnected'; threadId: string }
  /** An MCP server of this target changed (connected, failed, lost its tools); not tied to one thread. */
  | { type: 'mcp'; target: OpenCodeTarget }

export interface InboxSetReadRequest {
  id: string
  read: boolean
}

export interface InboxSetArchivedRequest {
  id: string
  archived: boolean
}

export interface InboxSetCustomTitleRequest {
  id: string
  /** null restores the current OpenCode title. */
  customTitle: string | null
}

export interface InboxSetPinnedRequest {
  id: string
  pinned: boolean
}

export interface InboxRemoveRequest {
  id: string
  /** Also remove the thread's Git worktree, which Git refuses while it has uncommitted changes. */
  removeWorktree?: boolean
}

export type OpenCodeTarget =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string }

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

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked'

/** Lightweight Git state for a checkout. */
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
export interface GitTerminalInfoResponse extends GitStatusResponse {
  /** Changed entries, including untracked files and directories. */
  changedFiles: number
  /** Current directory used for this snapshot. */
  directory: string
  /** Absolute root of the Git worktree containing the terminal directory. */
  worktree: string | null
}

export interface GitDiffResponse {
  path: string
  diff: string
  binary: boolean
}

export type FileTreeEntryKind = 'directory' | 'file' | 'symlink' | 'other'

/** One child of a listed directory. Symlinks are reported, never followed. */
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
  | (FileRoot & { key: ChatDraftKey; action: 'tree'; path: string })
  | { key: ChatDraftKey; action: 'remove'; attachmentId: string }
) & {
  /** The folder a new-thread draft is for. Every change to such a draft names it, so the draft can be listed and reopened there. */
  folderId?: string
  /** How the new thread would start, as it is now; it replaces what the draft remembered. Left out while that is not known yet. */
  choice?: ChatDraftChoice
}

/** What a new thread's draft remembers of how it would start, so reopening it brings the same choices back. */
export interface ChatDraftChoice {
  mode?: InboxThreadMode
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

export type GitGraphScope = 'all' | 'local' | 'head'

/** The commit graph of the checkout a thread uses, read when the Git graph view opens. Memory only. */
export interface InboxGitGraphRequest {
  threadId: string
  /** How many commits to read, newest first; the view asks for more as the person scrolls. */
  limit: number
  /**
   * `all`: every local branch, remote-tracking branch and tag; `local`: local branches and tags;
   * `head`: only what HEAD can reach.
   */
  scope: GitGraphScope
}

export interface GitGraphCommit {
  hash: string
  parents: string[]
  author: string
  /** Author date, in seconds since the epoch. */
  time: number
  subject: string
}

export interface GitGraphRef {
  /** The commit the ref points at (a tag's target commit, not the tag object). */
  hash: string
  /** `main`, `origin/main` or `v1.0`. */
  name: string
  kind: 'branch' | 'remote' | 'tag'
}

export interface InboxGitGraph {
  available: boolean
  reason?: string
  /** The checkout's root. */
  worktree: string | null
  /** The commit checked out; null in a repository with no commits yet. */
  head: string | null
  /** The branch checked out; null for a detached HEAD. */
  branch: string | null
  /** The current branch's upstream, with how far the branch is ahead of and behind it. */
  upstream: { name: string; ahead: number; behind: number } | null
  remotes: string[]
  refs: GitGraphRef[]
  commits: GitGraphCommit[]
  /** More commits exist past the limit. */
  more: boolean
}

export interface InboxGitCommitRequest {
  threadId: string
  hash: string
}

export interface InboxGitCommitFile {
  path: string
  /** The old path of a renamed or copied file. */
  from?: string
  status: GitChangeStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface InboxGitCommitDetails {
  hash: string
  parents: string[]
  author: string
  authorTime: number
  committer: string
  commitTime: number
  /** The full message: subject and body. */
  message: string
  /** Files changed against the first parent (the empty tree for a root commit). */
  files: InboxGitCommitFile[]
  /** Files past the listing limit were left out. */
  truncated: boolean
}

export interface InboxGitFetchRequest {
  threadId: string
}

export interface InboxGitFetchResult {
  /** The remotes fetched. */
  remotes: string[]
}
