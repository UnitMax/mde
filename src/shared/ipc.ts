import type { InboxTerminalConfiguration, InboxTerminalSettings } from './inbox-terminal'
import type { TaskbarAttentionRequest } from './taskbar-attention'
import type {
  Distro,
  GitTerminalInfoResponse,
  HostPlatform,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  PathCheckResult,
  PathResolution,
  WslDirectoryListing,
  TodoProject,
  TodoTask,
  SessionKind,
  Session,
  SessionTab,
  FileReadResponse,
  FileTreeListResponse,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtySize,
  PtyStatus,
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
  InboxSetCustomTitleRequest,
  InboxSetReadRequest,
  InboxThread,
  InboxUpdateFolderRequest,
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
  ChatSearchRequest,
  ChatFileEntry,
  ChatFilesRequest,
  ChatFilesCheckRequest,
  ChatSearchResponse,
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
  ChatAsideRequest,
  ChatAsideAnswer,
  ChatGoal,
  ChatGoalRequest,
  ChatThreadRequest,
  ChatBackgroundState,
  ChatDraft,
  ChatDraftRequest,
  ChatDraftList
} from './types'
import type {
  OpenCodeConfigPreview,
  OpenCodeConfigPreviewRequest,
  OpenCodeConfigRequest,
  OpenCodeConfigSaveRequest,
  OpenCodeConfigSnapshot
} from './opencode-config'

export interface WorkspaceData {
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
  sessionsReorder: 'sessions:reorder',
  sessionsRemove: 'sessions:remove',

  tabsCreate: 'tabs:create',
  tabsSelect: 'tabs:select',
  tabsUpdate: 'tabs:update',
  tabsRemove: 'tabs:remove',

  ptyEnsure: 'pty:ensure',
  ptyConfigureInbox: 'pty:configure-inbox',
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
  pathRevealTerminal: 'path:reveal-terminal',
  pathOpenTerminalInVsCode: 'path:open-terminal-in-vscode',
  pathRevealInbox: 'path:reveal-inbox',
  pathOpenInboxInVsCode: 'path:open-inbox-in-vscode',

  gitTerminalInfo: 'git:terminal-info',

  filesList: 'files:list',
  filesRead: 'files:read',

  inboxList: 'inbox:list',
  inboxSetRead: 'inbox:set-read',
  inboxSetArchived: 'inbox:set-archived',
  inboxSetPinned: 'inbox:set-pinned',
  inboxSetCustomTitle: 'inbox:set-custom-title',
  inboxRemove: 'inbox:remove',
  inboxFolders: 'inbox:folders',
  inboxFoldersAdd: 'inbox:folders-add',
  inboxFoldersRemove: 'inbox:folders-remove',
  inboxFoldersUpdate: 'inbox:folders-update',
  inboxComposerSet: 'inbox:composer-set',
  inboxGitInfo: 'inbox:git-info',

  chatConfigure: 'chat:configure',
  chatOptions: 'chat:options',
  chatCreate: 'chat:create',
  inboxChanges: 'inbox:changes',
  inboxChangeDiff: 'inbox:change-diff',
  chatMessages: 'chat:messages',
  chatSearch: 'chat:search',
  chatFiles: 'chat:files',
  chatFilesCheck: 'chat:files-check',
  chatSend: 'chat:send',
  chatDiscardPending: 'chat:discard-pending',
  chatSetDelivery: 'chat:set-delivery',
  chatAside: 'chat:aside',
  chatMcp: 'chat:mcp',
  chatMcpSet: 'chat:mcp-set',
  chatDraft: 'chat:draft',
  chatDrafts: 'chat:drafts',
  chatInterrupt: 'chat:interrupt',
  chatCompact: 'chat:compact',
  chatGoal: 'chat:goal',
  chatGoalSet: 'chat:goal-set',
  chatBackground: 'chat:background',
  chatRedo: 'chat:redo',
  chatRevert: 'chat:revert',
  chatFork: 'chat:fork',
  chatRegenerateTitle: 'chat:regenerate-title',
  chatRequests: 'chat:requests',
  chatPermissionReply: 'chat:permission-reply',
  chatFormReply: 'chat:form-reply',
  chatSubscribe: 'chat:subscribe',
  chatUnsubscribe: 'chat:unsubscribe',

  opencodeConfigRead: 'opencode-config:read',
  opencodeConfigPreview: 'opencode-config:preview',
  opencodeConfigSave: 'opencode-config:save',

  windowModeGet: 'window-mode:get',
  windowModeSet: 'window-mode:set',
  windowChromeSet: 'window-chrome:set',
  attentionUpdate: 'attention:update',
  attentionBeep: 'attention:beep',
  floatingTerminalActive: 'floating-terminal:active',

  appInfo: 'app:info',
  platformInfo: 'platform:info'
} as const

/** Main -> renderer pushes. */
export const IpcEvents = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyDirectory: 'pty:directory',
  inboxChanged: 'inbox:changed',
  chatEvent: 'chat:event',
  windowModeChanged: 'window-mode:changed',
  floatingTerminalToggle: 'floating-terminal:toggle',
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
  kind: SessionKind
  distro?: string
  /** Raw path as it came out of the picker or the text field. */
  rawPath: string
}

export interface ValidatePathRequest {
  kind: SessionKind
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

/** An Inbox folder/thread ID or a live terminal with its expected directory. */
export type FileRoot =
  | { sessionId: string; terminalId?: never; directory?: never }
  | (TerminalDirectoryRequest & { sessionId?: never })

export interface GitTerminalInfoRequest {
  terminalId: string
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
}

export type RestartPtyRequest = EnsurePtyRequest

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
  patch: Partial<Pick<Session, 'name' | 'shell' | 'color'>> & {
    icon?: Session['icon'] | null
  }
}

export interface ReorderSessionRequest {
  id: string
  /** Session to insert before; null appends to the end of the session list. */
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
    configureInbox(req: InboxTerminalSettings): Promise<InboxTerminalConfiguration>
    ensure(req: EnsurePtyRequest): Promise<PtyStatus>
    write(req: WritePtyRequest): Promise<void>
    resize(req: ResizePtyRequest): Promise<void>
    setPalette(req: UpdatePtyPaletteRequest): Promise<void>
    restart(req: RestartPtyRequest): Promise<PtyStatus>
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
    revealTerminal(terminalId: string): Promise<void>
    openTerminalInVsCode(terminalId: string): Promise<void>
    /** Opens the folder of an Inbox thread (`ses_…`) or project (`fld_…`) in the file manager. */
    revealInbox(id: string): Promise<void>
    /** Opens the folder of an Inbox thread or project in Windows VS Code; WSL folders on Windows only. */
    openInboxInVsCode(id: string): Promise<void>
  }
  git: {
    terminalInfo(req: GitTerminalInfoRequest): Promise<GitTerminalInfoResponse | null>
  }
  files: {
    list(req: FilesListRequest): Promise<FileTreeListResponse>
    read(req: FilesReadRequest): Promise<FileReadResponse>
  }
  inbox: {
    changes(req: InboxChangesRequest): Promise<InboxChangesResponse>
    changeDiff(req: InboxChangeDiffRequest): Promise<InboxChangeDiff>
    list(): Promise<InboxThread[]>
    setRead(req: InboxSetReadRequest): Promise<InboxThread | null>
    setArchived(req: InboxSetArchivedRequest): Promise<InboxThread | null>
    setPinned(req: InboxSetPinnedRequest): Promise<InboxThread | null>
    setCustomTitle(req: InboxSetCustomTitleRequest): Promise<InboxThread | null>
    remove(req: InboxRemoveRequest): Promise<void>
    onChanged(listener: (thread: InboxThread) => void): () => void
    folders(): Promise<InboxFoldersState>
    addFolder(req: InboxAddFolderRequest): Promise<InboxFolder>
    updateFolder(req: InboxUpdateFolderRequest): Promise<InboxFolder>
    removeFolder(req: InboxRemoveFolderRequest): Promise<void>
    setComposer(req: InboxComposerState): Promise<InboxComposerState>
    gitInfo(req: InboxGitInfoRequest): Promise<InboxGitInfo>
  }
  chat: {
    backgroundTasks(req: ChatThreadRequest): Promise<ChatBackgroundState>
    draft(req: ChatDraftRequest): Promise<ChatDraft>
    /** The new-thread drafts that have something in them, most recently changed first, and the threads with an unsent message. */
    drafts(): Promise<ChatDraftList>
    configure(req: ChatConfigureRequest): Promise<void>
    options(req: ChatOptionsRequest): Promise<ChatOptions>
    create(req: ChatCreateRequest): Promise<InboxThread>
    messages(req: ChatMessagesRequest): Promise<ChatMessagesPage>
    /**
     * Looks for text in the messages of every thread. The threads are read in the background, newest first, and kept in
     * memory; the answer has what is read so far, so asking again while `indexed` is below `total` finds more.
     */
    search(req: ChatSearchRequest): Promise<ChatSearchResponse>
    /** The files and folders the `@` picker offers for what was typed. */
    files(req: ChatFilesRequest): Promise<ChatFileEntry[]>
    /** Which of the `@` paths a message writes are in the project, so they can be marked as mentions. */
    checkFiles(req: ChatFilesCheckRequest): Promise<ChatFileEntry[]>
    /**
     * Sends a message. When the agent was busy, OpenCode holds it instead of showing it in the conversation;
     * the answer is that held message, or null when OpenCode's answer could not be read.
     */
    send(req: ChatSendRequest): Promise<ChatPendingMessage | null>
    /** Takes back a message OpenCode still holds for the agent. One it has already delivered stays. */
    discardPending(req: ChatDiscardPendingRequest): Promise<void>
    /** Changes a held message between steering (read at the agent's next step) and queued (sent when it is done). */
    setDelivery(req: ChatSetDeliveryRequest): Promise<void>
    /**
     * Asks a side question about a thread (the `/btw` command). The answer comes from the conversation as it
     * stands and is not added to it; the agent is neither interrupted nor told.
     */
    aside(req: ChatAsideRequest): Promise<ChatAsideAnswer>
    /** The MCP servers OpenCode has for a folder or thread, with how each stands. Never cached. */
    mcp(req: ChatMcpRequest): Promise<ChatMcpState>
    /** Connects or disconnects one MCP server for the running OpenCode; its configuration is not changed. */
    setMcp(req: ChatMcpSetRequest): Promise<void>
    interrupt(req: ChatThreadRequest): Promise<void>
    /**
     * Summarizes the conversation to free up context. OpenCode does it in the background and writes the
     * result into the conversation; a request while the agent is busy waits for it to finish.
     */
    compact(req: ChatThreadRequest): Promise<void>
    /** The goal OpenCode keeps for a thread (`/goal`), or null when it has none. */
    goal(req: ChatThreadRequest): Promise<ChatGoal | null>
    /**
     * Sets a thread's goal, or pauses, resumes or clears it. OpenCode refuses what makes no sense (pausing a
     * goal that is not active) with a reason, which comes back as the rejection.
     */
    setGoal(req: ChatGoalRequest): Promise<void>
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
  /** OpenCode's own global configuration file. The renderer names a target (this computer or a WSL distro), never a path. */
  opencodeConfig: {
    /** The file as the editor sees it. A file that cannot be parsed comes back with `parseError` and an empty draft. */
    read(req: OpenCodeConfigRequest): Promise<OpenCodeConfigSnapshot>
    /** The text the file would have with the draft applied, secret-looking values hidden. Writes nothing. */
    preview(req: OpenCodeConfigPreviewRequest): Promise<OpenCodeConfigPreview>
    /**
     * Applies the draft to the file, changing only what the editor manages. Refused when the file is no longer
     * the one the revision came from. Returns the file as it is afterwards.
     */
    save(req: OpenCodeConfigSaveRequest): Promise<OpenCodeConfigSnapshot>
  }
  windowMode: {
    get(): Promise<WindowMode>
    set(req: SetWindowModeRequest): Promise<WindowMode>
    onChanged(listener: (mode: WindowMode) => void): () => void
  }
  windowChrome: {
    set(req: WindowChromeColors): Promise<void>
  }
  attention: {
    /** Flashes, colours and badges the taskbar button; see `TaskbarAttentionRequest`. */
    update(req: TaskbarAttentionRequest): Promise<void>
    /** The system's own alert sound. */
    beep(): Promise<void>
  }
  floatingTerminal: {
    /** Says whether the Inbox has a floating terminal, so the main process hands it F11 instead of keeping it. */
    setActive(active: boolean): Promise<void>
    /** F11 was pressed while there is one: show it, or hide it. */
    onToggle(listener: () => void): () => void
  }
}
