import type {
  Distro,
  HostPlatform,
  NewProject,
  NewSession,
  PathCheckResult,
  PathResolution,
  Project,
  ProjectKind,
  AbortOpenCodeSessionRequest,
  Session,
  SendOpenCodeMessageRequest,
  SendOpenCodeMessageResponse,
  SendOpenCodePermissionReplyRequest,
  SendOpenCodeQuestionReplyRequest,
  SendOpenCodeQuestionRejectRequest,
  ListOpenCodeSessionsRequest,
  ListOpenCodeSessionsResponse,
  ListOpenCodeModelsRequest,
  ListOpenCodeModelsResponse,
  CreateOpenCodeSessionRequest,
  ExecuteOpenCodeCommandRequest,
  OpenCodeConversationResponse,
  RevertOpenCodeMessageRequest,
  UnrevertOpenCodeSessionRequest,
  SelectOpenCodeSessionRequest,
  OpenCodeStreamChunk,
  OpenCodeTuiSetEnabledRequest,
  OpenCodeTuiSettings,
  OpenCodeTuiPluginRequest,
  OpenCodeTuiPluginState,
  OpenCodeTuiStatusUpdate,
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

  sessionsCreate: 'sessions:create',
  sessionsDuplicate: 'sessions:duplicate',
  sessionsUpdate: 'sessions:update',
  sessionsMove: 'sessions:move',
  sessionsReorder: 'sessions:reorder',
  sessionsRemove: 'sessions:remove',

  ptyEnsure: 'pty:ensure',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyPalette: 'pty:palette',
  ptyRestart: 'pty:restart',
  ptyDispose: 'pty:dispose',
  ptyStatuses: 'pty:statuses',
  ptyDirectories: 'pty:directories',

  clipboardWriteText: 'clipboard:write-text',

  wslAvailable: 'wsl:available',
  wslDistros: 'wsl:distros',

  pathBrowse: 'path:browse',
  pathResolve: 'path:resolve',
  pathValidate: 'path:validate',
  pathReveal: 'path:reveal',
  pathOpenInVsCode: 'path:open-in-vscode',
  pathOpenTerminalInVsCode: 'path:open-terminal-in-vscode',

  opencodeSend: 'opencode:send',
  opencodeAbort: 'opencode:abort',
  opencodeCommand: 'opencode:command',
  opencodeSessionsList: 'opencode:sessions-list',
  opencodeModelsList: 'opencode:models-list',
  opencodeSessionSelect: 'opencode:session-select',
  opencodeSessionCreate: 'opencode:session-create',
  opencodePermissionReply: 'opencode:permission-reply',
  opencodeQuestionReply: 'opencode:question-reply',
  opencodeQuestionReject: 'opencode:question-reject',
  opencodeRevert: 'opencode:revert',
  opencodeUnrevert: 'opencode:unrevert',
  opencodeTuiPluginState: 'opencode-tui:plugin-state',
  opencodeTuiPluginInstall: 'opencode-tui:plugin-install',
  opencodeTuiPluginRemove: 'opencode-tui:plugin-remove',
  opencodeTuiSettings: 'opencode-tui:settings',
  opencodeTuiSetEnabled: 'opencode-tui:set-enabled',
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
  opencodeStream: 'opencode:stream',
  opencodeTuiStatus: 'opencode-tui:status'
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

export interface UpdatePtyPaletteRequest {
  terminalId: string
  palette: TerminalPalette
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<Project, 'name'>>
}

export interface UpdateSessionRequest {
  id: string
  patch: Partial<Pick<Session, 'name' | 'path' | 'shell' | 'color' | 'opencodeSessionId' | 'opencodeModelSelections'>>
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
  pty: {
    ensure(req: EnsurePtyRequest): Promise<PtyStatus>
    write(req: WritePtyRequest): Promise<void>
    resize(req: ResizePtyRequest): Promise<void>
    setPalette(req: UpdatePtyPaletteRequest): Promise<void>
    restart(req: EnsurePtyRequest): Promise<PtyStatus>
    dispose(terminalId: string): Promise<void>
    statuses(): Promise<Record<string, PtyStatus>>
    directories(): Promise<Record<string, string>>
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
    openInVsCode(sessionId: string): Promise<void>
    openTerminalInVsCode(terminalId: string): Promise<void>
  }
  opencode: {
    send(req: SendOpenCodeMessageRequest): Promise<SendOpenCodeMessageResponse>
    abort(req: AbortOpenCodeSessionRequest): Promise<void>
    executeCommand(req: ExecuteOpenCodeCommandRequest): Promise<OpenCodeConversationResponse>
    listSessions(req: ListOpenCodeSessionsRequest): Promise<ListOpenCodeSessionsResponse>
    listModels(req: ListOpenCodeModelsRequest): Promise<ListOpenCodeModelsResponse>
    selectSession(req: SelectOpenCodeSessionRequest): Promise<OpenCodeConversationResponse>
    createSession(req: CreateOpenCodeSessionRequest): Promise<OpenCodeConversationResponse>
    revert(req: RevertOpenCodeMessageRequest): Promise<OpenCodeConversationResponse>
    unrevert(req: UnrevertOpenCodeSessionRequest): Promise<OpenCodeConversationResponse>
    replyPermission(req: SendOpenCodePermissionReplyRequest): Promise<void>
    replyQuestion(req: SendOpenCodeQuestionReplyRequest): Promise<void>
    rejectQuestion(req: SendOpenCodeQuestionRejectRequest): Promise<void>
    /** Live text, reasoning, and tool-part updates while `send` is in flight. */
    onStream(listener: (chunk: OpenCodeStreamChunk) => void): () => void
  }
  opencodeTui: {
    settings(): Promise<OpenCodeTuiSettings>
    setEnabled(req: OpenCodeTuiSetEnabledRequest): Promise<OpenCodeTuiSettings>
    pluginState(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    install(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    remove(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    onStatus(listener: (update: OpenCodeTuiStatusUpdate) => void): () => void
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
