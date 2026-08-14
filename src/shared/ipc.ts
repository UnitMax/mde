import type {
  Distro,
  HostPlatform,
  NewProject,
  PathCheckResult,
  PathResolution,
  Project,
  PtyDataChunk,
  PtyExitInfo,
  PtySize,
  PtyStatus
} from './types'

/**
 * Every channel name lives here exactly once. Main registers handlers from
 * `IpcChannels`, preload invokes from `IpcChannels`; a typo cannot compile.
 */
export const IpcChannels = {
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',

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

  platformInfo: 'platform:info'
} as const

/** Main -> renderer pushes. */
export const IpcEvents = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const

export interface PlatformInfo {
  platform: HostPlatform
  isWindows: boolean
}

export interface ResolvePathRequest {
  kind: Project['kind']
  distro?: string
  /** Raw path as it came out of the picker or the text field. */
  rawPath: string
}

export interface ValidatePathRequest {
  kind: Project['kind']
  distro?: string
  path: string
}

export interface EnsurePtyRequest {
  projectId: string
  size: PtySize
}

export interface ResizePtyRequest {
  projectId: string
  size: PtySize
}

export interface WritePtyRequest {
  projectId: string
  data: string
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<Project, 'name' | 'path' | 'shell'>>
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
    list(): Promise<Project[]>
    create(input: NewProject): Promise<Project>
    update(req: UpdateProjectRequest): Promise<Project | null>
    remove(id: string): Promise<void>
  }
  pty: {
    ensure(req: EnsurePtyRequest): Promise<PtyStatus>
    write(req: WritePtyRequest): Promise<void>
    resize(req: ResizePtyRequest): Promise<void>
    restart(req: EnsurePtyRequest): Promise<PtyStatus>
    dispose(projectId: string): Promise<void>
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
    reveal(projectId: string): Promise<void>
  }
}
