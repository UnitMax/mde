export type ProjectKind = 'native' | 'wsl'

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
  | 'threeColumns'
  | 'sixGrid'

export interface TerminalLayoutSizes {
  columnRatio: number
  rowRatio: number
  /** Second vertical divider ratio for three-column layouts. */
  secondColumnRatio?: number
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

/** A privacy-safe status snapshot written by the optional WSL TUI plugin. */
export interface OpenCodeTuiStatusSnapshot {
  protocol: 1
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  /** Current top-level OpenCode conversation title, when reported by the plugin. */
  title?: string
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

export interface GitDiffResponse {
  path: string
  diff: string
  binary: boolean
}
