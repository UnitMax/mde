import type {
  Distro,
  GitDiffResponse,
  GitInfoResponse,
  HostPlatform,
  NewProject,
  NewTodoProject,
  NewSession,
  PathCheckResult,
  PathResolution,
  Project,
  TodoProject,
  ProjectKind,
  Session,
  SessionTab,
  OpenCodeTuiSetEnabledRequest,
  OpenCodeTuiSetInstanceLabelModeRequest,
  OpenCodeTuiSettings,
  OpenCodeTuiPluginRequest,
  OpenCodeTuiPluginState,
  OpenCodeTuiStatusUpdate,
  OpenCodeTuiInstancesUpdate,
  OpenCodeTokenRatePluginRequest,
  OpenCodeTokenRatePluginState,
  OpenCodeAlertSetEnabledRequest,
  OpenCodeAlertSettings,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtySize,
  PtyStatus
} from './types'

export interface WorkspaceData {
  projects: Project[]
  todoProjects: TodoProject[]
  sessions: Session[]
}

/**
 * Every channel name lives here exactly once. Main registers handlers from
 * `IpcChannels`, preload invokes from `IpcChannels`; a typo cannot compile.
 */
export const IpcChannels = {
  workspaceList: 'workspace:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',

  todoProjectsCreate: 'todo-projects:create',
  todoProjectsUpdate: 'todo-projects:update',
  todoProjectsRemove: 'todo-projects:remove',

  sessionsCreate: 'sessions:create',
  sessionsDuplicate: 'sessions:duplicate',
  sessionsUpdate: 'sessions:update',
  sessionsMove: 'sessions:move',
  sessionsReorder: 'sessions:reorder',
  sessionsRemove: 'sessions:remove',

  tabsCreate: 'tabs:create',
  tabsSelect: 'tabs:select',
  tabsUpdate: 'tabs:update',
  tabsRemove: 'tabs:remove',

  ptyEnsure: 'pty:ensure',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyPalette: 'pty:palette',
  ptyRestart: 'pty:restart',
  ptyDispose: 'pty:dispose',
  ptyStatuses: 'pty:statuses',
  ptyDirectories: 'pty:directories',
  ptyDropFiles: 'pty:drop-files',

  clipboardWriteText: 'clipboard:write-text',

  wslAvailable: 'wsl:available',
  wslDistros: 'wsl:distros',

  pathBrowse: 'path:browse',
  pathResolve: 'path:resolve',
  pathValidate: 'path:validate',
  pathReveal: 'path:reveal',
  pathRevealTerminal: 'path:reveal-terminal',
  pathOpenInVsCode: 'path:open-in-vscode',
  pathOpenTerminalInVsCode: 'path:open-terminal-in-vscode',

  gitInfo: 'git:info',
  gitDiff: 'git:diff',

  opencodeTuiPluginState: 'opencode-tui:plugin-state',
  opencodeTuiPluginInstall: 'opencode-tui:plugin-install',
  opencodeTuiPluginRemove: 'opencode-tui:plugin-remove',
  opencodeTuiSettings: 'opencode-tui:settings',
  opencodeTuiSetEnabled: 'opencode-tui:set-enabled',
  opencodeTuiSetInstanceLabelMode: 'opencode-tui:set-instance-label-mode',
  opencodeTokenRatePluginState: 'opencode-token-rate:plugin-state',
  opencodeTokenRatePluginInstall: 'opencode-token-rate:plugin-install',
  opencodeTokenRatePluginRemove: 'opencode-token-rate:plugin-remove',

  opencodeAlertsSettings: 'opencode-alerts:settings',
  opencodeAlertsSetEnabled: 'opencode-alerts:set-enabled',

  appInfo: 'app:info',
  platformInfo: 'platform:info'
} as const

/** Main -> renderer pushes. */
export const IpcEvents = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyDirectory: 'pty:directory',
  opencodeTuiStatus: 'opencode-tui:status',
  opencodeTuiInstances: 'opencode-tui:instances'
} as const

export interface PlatformInfo {
  platform: HostPlatform
  isWindows: boolean
}

export interface AppInfo {
  name: string
  fullName: string
  version: string
}

export interface ResolvePathRequest {
  kind: ProjectKind
  distro?: string
  /** Raw path as it came out of the picker or the text field. */
  rawPath: string
}

export interface ValidatePathRequest {
  kind: ProjectKind
  distro?: string
  path: string
}

export interface GitInfoRequest {
  sessionId: string
}

export interface GitDiffRequest {
  sessionId: string
  path: string
}

export interface EnsurePtyRequest {
  /** Runtime terminal identity, unique even when panes share a session. */
  terminalId: string
  /** Persisted workspace session used as the launch source. */
  sessionId: string
  size: PtySize
  palette: TerminalPalette
}

export interface TerminalPalette {
  foreground: string
  background: string
}

export interface ResizePtyRequest {
  terminalId: string
  size: PtySize
}

export interface WritePtyRequest {
  terminalId: string
  data: string
}

export type TerminalDropMode = 'shell' | 'tui'

export type TerminalDropRejectionCode =
  | 'path-unresolved'
  | 'invalid-path'
  | 'wrong-distro'
  | 'translation-failed'
  | 'inaccessible'
  | 'wsl-unavailable'
  | 'terminal-unavailable'

/** A file descriptor safe to send from preload to the main process. */
export interface DropPtyFile {
  name: string
  nativePath?: string
  fileUri?: string
}

/** Files resolved by preload from a renderer file drop. */
export interface DropPtyFilesRequest {
  terminalId: string
  files: DropPtyFile[]
  mode: TerminalDropMode
}

export interface PtyDropRejection {
  name: string
  code: TerminalDropRejectionCode
  distro?: string
}

/** Result returned after the main process validates and formats a file drop. */
export interface PtyDropResult {
  /** One insertion per agent-TUI file, or one combined shell insertion. */
  insertions: string[]
  acceptedCount: number
  rejections: PtyDropRejection[]
}

/** Renderer-facing request; raw File objects never cross into the main process. */
export interface RendererDropPtyFilesRequest {
  terminalId: string
  files: File[]
  /** File URLs supplied by the browser when Electron cannot resolve a File path. */
  uriList?: string[]
  mode: TerminalDropMode
}

export interface UpdatePtyPaletteRequest {
  terminalId: string
  palette: TerminalPalette
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<Project, 'name'>>
}

export interface UpdateTodoProjectRequest {
  id: string
  patch: Partial<Pick<TodoProject, 'name'>>
}

export interface UpdateSessionRequest {
  id: string
  patch: Partial<Pick<Session, 'name' | 'path' | 'shell' | 'color'>> & {
    icon?: Session['icon'] | null
  }
}

export interface MoveSessionRequest {
  id: string
  projectId: string
}

export interface ReorderSessionRequest {
  id: string
  /** Session to insert before; null appends to the end of the current project. */
  beforeId: string | null
}

export interface CreateSessionTabRequest {
  sessionId: string
}

export interface SelectSessionTabRequest {
  sessionId: string
  tabId: string
}

export interface UpdateSessionTabRequest {
  sessionId: string
  tabId: string
  patch: Partial<Pick<SessionTab, 'name' | 'layout'>>
}

export interface RemoveSessionTabRequest {
  sessionId: string
  tabId: string
}

/**
 * The complete surface exposed over `contextBridge`. Implemented in preload,
 * consumed in the renderer, and mirrored by the main-process handlers.
 */
export interface RendererApi {
  clipboard: {
    writeText(text: string): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
  }
  platform: {
    info(): Promise<PlatformInfo>
  }
  projects: {
    create(input: NewProject): Promise<Project>
    update(req: UpdateProjectRequest): Promise<Project | null>
    remove(id: string): Promise<void>
  }
  todoProjects: {
    create(input: NewTodoProject): Promise<TodoProject>
    update(req: UpdateTodoProjectRequest): Promise<TodoProject | null>
    remove(id: string): Promise<void>
  }
  workspace: {
    list(): Promise<WorkspaceData>
  }
  sessions: {
    create(input: NewSession): Promise<Session>
    duplicate(id: string): Promise<Session | null>
    update(req: UpdateSessionRequest): Promise<Session | null>
    move(req: MoveSessionRequest): Promise<Session | null>
    reorder(req: ReorderSessionRequest): Promise<Session[] | null>
    remove(id: string): Promise<void>
  }
  tabs: {
    create(req: CreateSessionTabRequest): Promise<Session | null>
    select(req: SelectSessionTabRequest): Promise<Session | null>
    update(req: UpdateSessionTabRequest): Promise<Session | null>
    remove(req: RemoveSessionTabRequest): Promise<Session | null>
  }
  pty: {
    ensure(req: EnsurePtyRequest): Promise<PtyStatus>
    write(req: WritePtyRequest): Promise<void>
    resize(req: ResizePtyRequest): Promise<void>
    setPalette(req: UpdatePtyPaletteRequest): Promise<void>
    restart(req: EnsurePtyRequest): Promise<PtyStatus>
    dispose(terminalId: string): Promise<void>
    statuses(): Promise<Record<string, PtyStatus>>
    directories(): Promise<Record<string, string>>
    dropFiles(req: RendererDropPtyFilesRequest): Promise<PtyDropResult>
    onData(listener: (chunk: PtyDataChunk) => void): () => void
    onDirectory(listener: (update: PtyDirectoryUpdate) => void): () => void
    onExit(listener: (info: PtyExitInfo) => void): () => void
  }
  wsl: {
    available(): Promise<boolean>
    distros(): Promise<Distro[]>
  }
  paths: {
    browse(): Promise<string | null>
    resolve(req: ResolvePathRequest): Promise<PathResolution>
    validate(req: ValidatePathRequest): Promise<PathCheckResult>
    reveal(sessionId: string): Promise<void>
    revealTerminal(terminalId: string): Promise<void>
    openInVsCode(sessionId: string): Promise<void>
    openTerminalInVsCode(terminalId: string): Promise<void>
  }
  git: {
    info(req: GitInfoRequest): Promise<GitInfoResponse>
    diff(req: GitDiffRequest): Promise<GitDiffResponse>
  }
  opencodeTui: {
    settings(): Promise<OpenCodeTuiSettings>
    setEnabled(req: OpenCodeTuiSetEnabledRequest): Promise<OpenCodeTuiSettings>
    setInstanceLabelMode(req: OpenCodeTuiSetInstanceLabelModeRequest): Promise<OpenCodeTuiSettings>
    pluginState(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    install(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    remove(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    onStatus(listener: (update: OpenCodeTuiStatusUpdate) => void): () => void
    onInstances(listener: (update: OpenCodeTuiInstancesUpdate) => void): () => void
  }
  opencodeTokenRate: {
    pluginState(req: OpenCodeTokenRatePluginRequest): Promise<OpenCodeTokenRatePluginState>
    install(req: OpenCodeTokenRatePluginRequest): Promise<OpenCodeTokenRatePluginState>
    remove(req: OpenCodeTokenRatePluginRequest): Promise<OpenCodeTokenRatePluginState>
  }
  opencodeAlerts: {
    settings(): Promise<OpenCodeAlertSettings>
    setEnabled(req: OpenCodeAlertSetEnabledRequest): Promise<OpenCodeAlertSettings>
  }
}
