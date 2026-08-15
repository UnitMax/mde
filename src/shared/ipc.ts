import type {
  Distro,
  HostPlatform,
  NewProject,
  NewSession,
  PathCheckResult,
  PathResolution,
  Project,
  ProjectKind,
  Session,
  SendOpenCodeMessageRequest,
  SendOpenCodeMessageResponse,
  SendOpenCodePermissionReplyRequest,
  ListOpenCodeSessionsRequest,
  ListOpenCodeSessionsResponse,
  CreateOpenCodeSessionRequest,
  OpenCodeConversationResponse,
  SelectOpenCodeSessionRequest,
  OpenCodeStreamChunk,
  PtyDataChunk,
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
  sessionsUpdate: 'sessions:update',
  sessionsMove: 'sessions:move',
  sessionsRemove: 'sessions:remove',

  ptyEnsure: 'pty:ensure',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyRestart: 'pty:restart',
  ptyDispose: 'pty:dispose',
  ptyStatuses: 'pty:statuses',

  wslAvailable: 'wsl:available',
  wslDistros: 'wsl:distros',

  pathBrowse: 'path:browse',
  pathResolve: 'path:resolve',
  pathValidate: 'path:validate',
  pathReveal: 'path:reveal',

  opencodeSend: 'opencode:send',
  opencodeSessionsList: 'opencode:sessions-list',
  opencodeSessionSelect: 'opencode:session-select',
  opencodeSessionCreate: 'opencode:session-create',
  opencodePermissionReply: 'opencode:permission-reply',

  platformInfo: 'platform:info'
} as const

/** Main -> renderer pushes. */
export const IpcEvents = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  opencodeStream: 'opencode:stream'
} as const

export interface PlatformInfo {
  platform: HostPlatform
  isWindows: boolean
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
  sessionId: string
  size: PtySize
}

export interface ResizePtyRequest {
  sessionId: string
  size: PtySize
}

export interface WritePtyRequest {
  sessionId: string
  data: string
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<Project, 'name'>>
}

export interface UpdateSessionRequest {
  id: string
  patch: Partial<Pick<Session, 'name' | 'path' | 'shell' | 'opencodeSessionId'>>
}

export interface MoveSessionRequest {
  id: string
  projectId: string
}

/**
 * The complete surface exposed over `contextBridge`. Implemented in preload,
 * consumed in the renderer, and mirrored by the main-process handlers.
 */
export interface RendererApi {
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
    update(req: UpdateSessionRequest): Promise<Session | null>
    move(req: MoveSessionRequest): Promise<Session | null>
    remove(id: string): Promise<void>
  }
  pty: {
    ensure(req: EnsurePtyRequest): Promise<PtyStatus>
    write(req: WritePtyRequest): Promise<void>
    resize(req: ResizePtyRequest): Promise<void>
    restart(req: EnsurePtyRequest): Promise<PtyStatus>
    dispose(sessionId: string): Promise<void>
    statuses(): Promise<Record<string, PtyStatus>>
    onData(listener: (chunk: PtyDataChunk) => void): () => void
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
  }
  opencode: {
    send(req: SendOpenCodeMessageRequest): Promise<SendOpenCodeMessageResponse>
    listSessions(req: ListOpenCodeSessionsRequest): Promise<ListOpenCodeSessionsResponse>
    selectSession(req: SelectOpenCodeSessionRequest): Promise<OpenCodeConversationResponse>
    createSession(req: CreateOpenCodeSessionRequest): Promise<OpenCodeConversationResponse>
    replyPermission(req: SendOpenCodePermissionReplyRequest): Promise<void>
    /** Live text, reasoning, and tool-part updates while `send` is in flight. */
    onStream(listener: (chunk: OpenCodeStreamChunk) => void): () => void
  }
}
