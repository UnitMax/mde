import type {
  Distro,
  GitDiffResponse,
  GitInfoResponse,
  GitTerminalInfoResponse,
  HostPlatform,
  NewProject,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  PathCheckResult,
  PathResolution,
  WslDirectoryListing,
  Project,
  TodoProject,
  TodoTask,
  ProjectKind,
  Session,
  SessionTab,
  OpenCodeTuiSetEnabledRequest,
  OpenCodeTuiSettings,
  OpenCodeTuiPluginRequest,
  OpenCodeTuiPluginState,
  OpenCodeTuiStatusUpdate,
  OpenCodeTuiInstancesUpdate,
  FileReadResponse,
  FileTreeListResponse,
  OpenCodeAlertSetEnabledRequest,
  OpenCodeAlertSettings,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtySize,
  PtyStatus,
  TerminalLaunch,
  OpenCodeSessionsRequest,
  OpenCodeSessionSummary,
  WindowMode,
  InboxAddFolderRequest,
  InboxComposerState,
  InboxFolder,
  InboxFoldersState,
  InboxGitInfo,
  InboxGitInfoRequest,
  InboxRemoveFolderRequest,
  InboxRemoveRequest,
  InboxSetArchivedRequest,
  InboxSetPinnedRequest,
  InboxSetReadRequest,
  InboxThread,
  ChatConfigureRequest,
  ChatDiscardPendingRequest,
  ChatCreateRequest,
  ChatEvent,
  ChatFormReplyRequest,
  InboxChangesResponse,
  InboxChangesRequest,
  InboxChangeDiffRequest,
  InboxChangeDiff,
  ChatMessagesPage,
  ChatMessagesRequest,
  ChatMcpRequest,
  ChatMcpSetRequest,
  ChatMcpState,
  ChatOptions,
  ChatOptionsRequest,
  ChatPermissionReplyRequest,
  ChatRequests,
  ChatRevert,
  ChatForkRequest,
  ChatForkResult,
  ChatRevertRequest,
  ChatPendingMessage,
  ChatSendRequest,
  ChatSetDeliveryRequest,
  ChatThreadRequest,
  ChatDraft,
  ChatDraftRequest,
  ChatDraftList
} from './types'

export interface WorkspaceData {
  projects: Project[]
  todoProjects: TodoProject[]
  todoTasks: TodoTask[]
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

  todoTasksCreate: 'todo-tasks:create',
  todoTasksUpdate: 'todo-tasks:update',
  todoTasksMove: 'todo-tasks:move',
  todoTasksRemove: 'todo-tasks:remove',

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
  clipboardPaste: 'clipboard:paste',

  wslAvailable: 'wsl:available',
  wslDistros: 'wsl:distros',

  pathBrowse: 'path:browse',
  pathResolve: 'path:resolve',
  pathValidate: 'path:validate',
  pathListWslDirectories: 'path:list-wsl-directories',
  pathReveal: 'path:reveal',
  pathRevealTerminal: 'path:reveal-terminal',
  pathOpenInVsCode: 'path:open-in-vscode',
  pathOpenTerminalInVsCode: 'path:open-terminal-in-vscode',

  gitInfo: 'git:info',
  gitTerminalInfo: 'git:terminal-info',
  gitDiff: 'git:diff',

  filesList: 'files:list',
  filesRead: 'files:read',

  opencodeSessionsList: 'opencode-sessions:list',

  opencodeTuiPluginState: 'opencode-tui:plugin-state',
  opencodeTuiPluginInstall: 'opencode-tui:plugin-install',
  opencodeTuiPluginRemove: 'opencode-tui:plugin-remove',
  opencodeTuiSettings: 'opencode-tui:settings',
  opencodeTuiSetEnabled: 'opencode-tui:set-enabled',

  opencodeAlertsSettings: 'opencode-alerts:settings',
  opencodeAlertsSetEnabled: 'opencode-alerts:set-enabled',

  inboxList: 'inbox:list',
  inboxSetRead: 'inbox:set-read',
  inboxSetArchived: 'inbox:set-archived',
  inboxSetPinned: 'inbox:set-pinned',
  inboxRemove: 'inbox:remove',
  inboxFolders: 'inbox:folders',
  inboxFoldersAdd: 'inbox:folders-add',
  inboxFoldersRemove: 'inbox:folders-remove',
  inboxComposerSet: 'inbox:composer-set',
  inboxGitInfo: 'inbox:git-info',

  chatConfigure: 'chat:configure',
  chatOptions: 'chat:options',
  chatCreate: 'chat:create',
  inboxChanges: 'inbox:changes',
  inboxChangeDiff: 'inbox:change-diff',
  chatMessages: 'chat:messages',
  chatSend: 'chat:send',
  chatDiscardPending: 'chat:discard-pending',
  chatSetDelivery: 'chat:set-delivery',
  chatMcp: 'chat:mcp',
  chatMcpSet: 'chat:mcp-set',
  chatDraft: 'chat:draft',
  chatDrafts: 'chat:drafts',
  chatInterrupt: 'chat:interrupt',
  chatRedo: 'chat:redo',
  chatRevert: 'chat:revert',
  chatFork: 'chat:fork',
  chatRegenerateTitle: 'chat:regenerate-title',
  chatRequests: 'chat:requests',
  chatPermissionReply: 'chat:permission-reply',
  chatFormReply: 'chat:form-reply',
  chatSubscribe: 'chat:subscribe',
  chatUnsubscribe: 'chat:unsubscribe',

  windowModeGet: 'window-mode:get',
  windowModeSet: 'window-mode:set',
  windowChromeSet: 'window-chrome:set',

  appInfo: 'app:info',
  platformInfo: 'platform:info'
} as const

/** Main -> renderer pushes. */
export const IpcEvents = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyDirectory: 'pty:directory',
  opencodeTuiStatus: 'opencode-tui:status',
  opencodeTuiInstances: 'opencode-tui:instances',
  inboxChanged: 'inbox:changed',
  chatEvent: 'chat:event',
  windowModeChanged: 'window-mode:changed',
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

export interface ListWslDirectoriesRequest {
  distro: string
  /** An absolute Linux path in the distro. Omitted: the distro user's home directory. */
  path?: string
  /** Include folders whose names start with a dot. */
  hidden?: boolean
}

/** A live terminal root; directory is an expected value, never renderer-granted authority. */
export interface TerminalDirectoryRequest {
  terminalId: string
  directory: string
}

export type FileRoot =
  | { sessionId: string; terminalId?: never; directory?: never }
  | (TerminalDirectoryRequest & { sessionId?: never })

export type GitInfoRequest = TerminalDirectoryRequest

export interface GitTerminalInfoRequest {
  terminalId: string
}

export interface GitDiffRequest extends TerminalDirectoryRequest {
  /** Path relative to the current checkout root. */
  path: string
}

export type FilesListRequest = FileRoot & {
  /** Directory relative to the root, '/'-separated; '' lists the root. */
  path: string
}

export type FilesReadRequest = FileRoot & {
  /** File relative to the root, '/'-separated. */
  path: string
}

export interface EnsurePtyRequest {
  /** Runtime terminal identity, unique even when panes share a session. */
  terminalId: string
  /** Workspace session or reserved Inbox terminal identity resolved by the main process. */
  sessionId: string
  size: PtySize
  palette: TerminalPalette
  /**
   * Optional runtime-only launch override: a new WSL terminal pane, or, for
   * restart, an OpenCode session that replaces this terminal's process.
   */
  launch?: PtyLaunchRequest
}

export type PtyLaunchRequest = TerminalLaunch

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

/** A tree entry relative to its verified file root. */
export type FileTreeDropEntry = FileRoot & { path: string }

/** Files resolved by preload from a renderer file drop. */
export interface DropPtyFilesRequest {
  terminalId: string
  files: DropPtyFile[]
  treeEntry?: FileTreeDropEntry
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
  /**
   * How many paths were inserted shell-quoted despite TUI mode, because raw
   * text would have been live if a shell was what read it.
   */
  quotedForSafety?: number
}

/** Renderer-facing request; raw File objects never cross into the main process. */
export interface RendererDropPtyFilesRequest {
  terminalId: string
  files: File[]
  treeEntry?: FileTreeDropEntry
  /** File URLs supplied by the browser when Electron cannot resolve a File path. */
  uriList?: string[]
  mode: TerminalDropMode
}

export interface UpdatePtyPaletteRequest {
  terminalId: string
  palette: TerminalPalette
}

export interface SetWindowModeRequest {
  mode: WindowMode
}

/** Hex colors for the native window buttons, so they blend into the custom title bar. */
export interface WindowChromeColors {
  color: string
  symbolColor: string
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<Project, 'name'>>
}

export interface UpdateTodoProjectRequest {
  id: string
  patch: Partial<Pick<TodoProject, 'name'>> & { shorthand?: string }
}

export interface UpdateTodoTaskRequest {
  id: string
  patch: Partial<Pick<TodoTask, 'title' | 'description' | 'columnId'>>
}

export interface MoveTodoTaskRequest {
  id: string
  columnId: string
  /** Task to insert before in the destination column; null appends. */
  beforeId: string | null
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
    /**
     * Pastes the system clipboard into the focused field, as Ctrl/Cmd+V would. The page never
     * reads the clipboard itself; the content arrives as an ordinary paste event.
     */
    paste(): Promise<void>
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
  todoTasks: {
    create(input: NewTodoTask): Promise<TodoTask>
    update(req: UpdateTodoTaskRequest): Promise<TodoTask | null>
    move(req: MoveTodoTaskRequest): Promise<TodoTask[] | null>
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
    listWslDirectories(req: ListWslDirectoriesRequest): Promise<WslDirectoryListing>
    reveal(sessionId: string): Promise<void>
    revealTerminal(terminalId: string): Promise<void>
    openInVsCode(sessionId: string): Promise<void>
    openTerminalInVsCode(terminalId: string): Promise<void>
  }
  git: {
    info(req: GitInfoRequest): Promise<GitInfoResponse>
    terminalInfo(req: GitTerminalInfoRequest): Promise<GitTerminalInfoResponse | null>
    diff(req: GitDiffRequest): Promise<GitDiffResponse>
  }
  files: {
    list(req: FilesListRequest): Promise<FileTreeListResponse>
    read(req: FilesReadRequest): Promise<FileReadResponse>
  }
  opencodeSessions: {
    list(req: OpenCodeSessionsRequest): Promise<OpenCodeSessionSummary[]>
  }
  opencodeTui: {
    settings(): Promise<OpenCodeTuiSettings>
    setEnabled(req: OpenCodeTuiSetEnabledRequest): Promise<OpenCodeTuiSettings>
    pluginState(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    install(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    remove(req: OpenCodeTuiPluginRequest): Promise<OpenCodeTuiPluginState>
    onStatus(listener: (update: OpenCodeTuiStatusUpdate) => void): () => void
    onInstances(listener: (update: OpenCodeTuiInstancesUpdate) => void): () => void
  }
  opencodeAlerts: {
    settings(): Promise<OpenCodeAlertSettings>
    setEnabled(req: OpenCodeAlertSetEnabledRequest): Promise<OpenCodeAlertSettings>
  }
  inbox: {
    changes(req: InboxChangesRequest): Promise<InboxChangesResponse>
    changeDiff(req: InboxChangeDiffRequest): Promise<InboxChangeDiff>
    list(): Promise<InboxThread[]>
    setRead(req: InboxSetReadRequest): Promise<InboxThread | null>
    setArchived(req: InboxSetArchivedRequest): Promise<InboxThread | null>
    setPinned(req: InboxSetPinnedRequest): Promise<InboxThread | null>
    remove(req: InboxRemoveRequest): Promise<void>
    onChanged(listener: (thread: InboxThread) => void): () => void
    folders(): Promise<InboxFoldersState>
    addFolder(req: InboxAddFolderRequest): Promise<InboxFolder>
    removeFolder(req: InboxRemoveFolderRequest): Promise<void>
    setComposer(req: InboxComposerState): Promise<InboxComposerState>
    gitInfo(req: InboxGitInfoRequest): Promise<InboxGitInfo>
  }
  chat: {
    draft(req: ChatDraftRequest): Promise<ChatDraft>
    /** The new-thread drafts that have something in them, most recently changed first, and the threads with an unsent message. */
    drafts(): Promise<ChatDraftList>
    configure(req: ChatConfigureRequest): Promise<void>
    options(req: ChatOptionsRequest): Promise<ChatOptions>
    create(req: ChatCreateRequest): Promise<InboxThread>
    messages(req: ChatMessagesRequest): Promise<ChatMessagesPage>
    /**
     * Sends a message. When the agent was busy, OpenCode holds it instead of showing it in the conversation;
     * the answer is that held message, or null when OpenCode's answer could not be read.
     */
    send(req: ChatSendRequest): Promise<ChatPendingMessage | null>
    /** Takes back a message OpenCode still holds for the agent. One it has already delivered stays. */
    discardPending(req: ChatDiscardPendingRequest): Promise<void>
    /** Changes a held message between steering (read at the agent's next step) and queued (sent when it is done). */
    setDelivery(req: ChatSetDeliveryRequest): Promise<void>
    /** The MCP servers OpenCode has for a folder or thread, with how each stands. Never cached. */
    mcp(req: ChatMcpRequest): Promise<ChatMcpState>
    /** Connects or disconnects one MCP server for the running OpenCode; its configuration is not changed. */
    setMcp(req: ChatMcpSetRequest): Promise<void>
    interrupt(req: ChatThreadRequest): Promise<void>
    redo(req: ChatThreadRequest): Promise<void>
    revert(req: ChatRevertRequest): Promise<ChatRevert>
    fork(req: ChatForkRequest): Promise<ChatForkResult>
    regenerateTitle(req: ChatThreadRequest): Promise<void>
    requests(req: ChatThreadRequest): Promise<ChatRequests>
    replyPermission(req: ChatPermissionReplyRequest): Promise<void>
    replyForm(req: ChatFormReplyRequest): Promise<void>
    subscribe(req: ChatThreadRequest): Promise<void>
    unsubscribe(req: ChatThreadRequest): Promise<void>
    onEvent(listener: (event: ChatEvent) => void): () => void
  }
  windowMode: {
    get(): Promise<WindowMode>
    set(req: SetWindowModeRequest): Promise<WindowMode>
    onChanged(listener: (mode: WindowMode) => void): () => void
  }
  windowChrome: {
    set(req: WindowChromeColors): Promise<void>
  }
}
