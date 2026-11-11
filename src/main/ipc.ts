import { constants, promises as fs } from 'node:fs'
import { isFileRoot } from '@shared/file-root'
import type {
  OpenCodeConfigPreview,
  OpenCodeConfigPreviewRequest,
  OpenCodeConfigRequest,
  OpenCodeConfigSaveRequest,
  OpenCodeConfigSnapshot,
  OpenCodeConfigTarget
} from '@shared/opencode-config'
import { inboxTerminalThreadId, inboxThreadTerminalId } from '@shared/inbox-thread-terminal'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import {
  type AppInfo,
  type CreateSessionTabRequest,
  type DropPtyFile,
  type DropPtyFilesRequest,
  type TerminalDirectoryRequest,
  type FileRoot,
  type GitTerminalInfoRequest,
  IpcChannels,
  type EnsurePtyRequest,
  type RestartPtyRequest,
  type FilesListRequest,
  type StartTerminalInFolderRequest,
  type FilesReadRequest,
  type MoveTodoTaskRequest,
  type PlatformInfo,
  type ReorderSessionRequest,
  type RemoveSessionTabRequest,
  type ResizePtyRequest,
  type ResolvePathRequest,
  type SetWindowModeRequest,
  type WindowChromeColors,
  type TerminalPalette,
  type PtyDropResult,
  type PtyDropRejection,
  type TerminalDropMode,
  type UpdatePtyPaletteRequest,
  type UpdateTodoProjectRequest,
  type UpdateTodoTaskRequest,
  type UpdateSessionRequest,
  type UpdateSessionTabRequest,
  type SelectSessionTabRequest,
  type ValidatePathRequest,
  type ListWslDirectoriesRequest,
  type WritePtyRequest,
  type WorkspaceData
} from '@shared/ipc'
import type {
  Distro,
  FileReadResponse,
  FileTreeListResponse,
  HostPlatform,
  GitTerminalInfoResponse,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  DirectoryContext,
  PathCheckResult,
  PathResolution,
  WslDirectoryListing,
  TodoProject,
  TodoTask,
  Session,
  PtyStatus,
  WindowMode,
  InboxAddFolderRequest,
  InboxComposerState,
  InboxFolder,
  InboxFoldersState,
  InboxGitInfo,
  GitRootRequest,
  GitGraphRequest,
  InboxGitGraph,
  GitCommitRequest,
  GitCommitDiffRequest,
  InboxGitCommitDetails,
  InboxGitFetchResult,
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
  ChatCreateRequest,
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
  ChatOptions,
  ChatOptionsRequest,
  ChatPermissionReplyRequest,
  ChatRequests,
  ChatRevert,
  ChatForkRequest,
  ChatForkResult,
  ChatRevertRequest,
  ChatSendRequest,
  ChatPendingMessage,
  ChatDiscardPendingRequest,
  ChatMcpRequest,
  ChatMcpSetRequest,
  ChatMcpState,
  ChatBackgroundState,
  ChatSetDeliveryRequest,
  ChatAsideRequest,
  ChatAsideAnswer,
  ChatAsideEntry,
  ChatAsideHistoryRequest,
  ChatGoal,
  ChatGoalRequest,
  ChatThreadRequest,
  ChatDraftRequest,
  ChatDraft,
  ChatDraftList
} from '@shared/types'
import { assertIpcSender, type IpcSecurityContext } from './ipc-security'
import { assertIpcPayload, type IpcChannel } from './ipc-validation'
import type { PtyLaunchOptions, PtyManager } from './pty/manager'
import { fileTreeDropFile, resolveTerminalDrop } from './pty/drop'
import type { InboxRecorder } from './inbox/recorder'
import type { TaskbarAttention } from './taskbar-attention'
import type { FloatingTerminalKey } from './floating-terminal-key'
import type { TaskbarAttentionRequest } from '@shared/taskbar-attention'
import type { InboxChatService } from './inbox/chat'
import type { OpenCodeConfigService } from './opencode/config'
import type { MiniWindowController } from './mini-window'
import type { TitleBarController } from './window-chrome'
import { createAppInfo } from '@shared/app-info'
import { isWslAvailable, listDistros, runWslCommand } from './wsl/distros'
import {
  canonicalizeWslPath,
  directoryCheckArgs,
  isPlainAbsolutePath,
  resolveForTarget,
  toWindows,
  uncPathFor
} from './wsl/paths'
import { listWslDirectories } from './wsl/browse'
import { buildVsCodeRemoteUri } from './vscode'
import { safeVsCodeRemoteUrl } from './external-links'
import { readGitTerminalInfo } from './git'
import { fetchInboxGit, readInboxGitChanges, readInboxGitCommit, readInboxGitCommitDiff, readInboxGitDiff, readInboxGitGraph } from './inbox/changes'
import { terminalSessionResolver } from './inbox/terminal'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession, type InboxTerminalConfiguration, type InboxTerminalSettings } from '@shared/inbox-terminal'
import { isSafeRelativePath, isWithinRoot, listSessionDirectory, readSessionFile, treeFolderPath } from './files/tree'
import {
  createTodoProject,
  createTodoTask,
  createSession,
  duplicateSession,
  getSession,
  loadWorkspace,
  removeTodoProject,
  removeTodoTask,
  removeSession,
  reorderSession,
  createSessionTab,
  removeSessionTab,
  selectSessionTab,
  updateTodoProject,
  updateTodoTask,
  moveTodoTask,
  updateSession,
  updateSessionTab
} from './store/workspace'

function hostPlatform(): HostPlatform {
  switch (process.platform) {
    case 'win32':
    case 'linux':
    case 'darwin':
      return process.platform
    default:
      return 'other'
  }
}

function validateTerminalPalette(palette: TerminalPalette): TerminalPalette {
  const isColor = (value: unknown): value is string =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  if (!palette || !isColor(palette.foreground) || !isColor(palette.background)) {
    throw new Error('Invalid terminal palette.')
  }
  return palette
}

function terminalDropUnavailable(files: readonly DropPtyFile[]): PtyDropResult {
  const rejections: PtyDropRejection[] = files.map((file) => ({
    name: file.name || 'Dropped file',
    code: 'terminal-unavailable'
  }))
  return { insertions: [], acceptedCount: 0, rejections }
}

function isTerminalDropMode(value: unknown): value is TerminalDropMode {
  return value === 'shell' || value === 'tui'
}

function isDropPtyFile(value: unknown): value is DropPtyFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return (
    typeof file.name === 'string' &&
    (file.nativePath === undefined || typeof file.nativePath === 'string') &&
    (file.fileUri === undefined || typeof file.fileUri === 'string')
  )
}

async function validatePath(req: ValidatePathRequest): Promise<PathCheckResult> {
  const path = req.path.trim()
  if (!path) return { exists: false }

  if (req.kind === 'wsl') {
    if (!req.distro) return { exists: false, error: 'No distro selected' }
    if (!(await isWslAvailable())) return { exists: false, error: 'WSL is not available' }

    // Validated inside the distro, not through the Windows filesystem: a path
    // like /home/me/src does not exist on Windows at all.
    const canonical = await canonicalizeWslPath(req.distro, path)
    const result = await runWslCommand(req.distro, directoryCheckArgs(canonical ?? path))
    if (result.code === 0) return { exists: true }

    const stderr = result.stderr.trim()
    return stderr ? { exists: false, error: stderr } : { exists: false }
  }

  try {
    const stat = await fs.stat(path)
    return stat.isDirectory() ? { exists: true } : { exists: false, error: 'Not a directory' }
  } catch {
    return { exists: false }
  }
}

/**
 * Resolves a path selected by a terminal or persisted session into one this
 * process is willing to hand to the desktop or a new PTY.
 *
 * A pane's current directory is reported by the shell over OSC 7, and any
 * process writing to that terminal can emit the same sequence. `shell.openPath`
 * opens whatever it is given by file association, so a spoofed report naming an
 * executable would turn "open this directory" into "run this program". The
 * shape checks reject anything that is not a plain absolute path, and the
 * on-disk check — repeated here rather than trusted from report time, since the
 * path may have been replaced since — confirms it is still a directory.
 */
async function verifiedDirectory(session: Session, directory: string, quiet = false): Promise<string | null> {
  const path = directory
  if (!path.trim()) return null

  if (session.kind === 'native') {
    if (process.platform === 'darwin' && !isPlainAbsolutePath(path)) return null
    // A native path is checked by the filesystem itself; there is no path
    // format shared with the WSL side to validate first.
    try {
      const stat = await fs.stat(path)
      return stat.isDirectory() ? path : null
    } catch {
      return null
    }
  }

  const distro = session.distro
  if (!distro) return null

  // Rejections are logged: this path fails closed, so a silent return here is
  // indistinguishable from a dead button.
  const reject = (reason: string): null => {
    if (!quiet) console.warn(`[path] not opening ${JSON.stringify(directory)}: ${reason}`)
    return null
  }

  if (!isPlainAbsolutePath(path)) return reject('not a plain absolute path')
  // `realpath` output is distro-side data, so it is re-checked like any other.
  const canonical = (await canonicalizeWslPath(distro, path)) ?? path
  if (!isPlainAbsolutePath(canonical)) return reject(`canonicalized to ${canonical}`)

  const result = await runWslCommand(distro, directoryCheckArgs(canonical))
  return result.code === 0 ? canonical : reject(`not a directory in ${distro}`)
}

/** `verifiedDirectory`, but always the real path: links resolved on the host or inside the distro. */
async function realDirectory(session: Session, directory: string): Promise<string | null> {
  const verified = await verifiedDirectory(session, directory)
  if (!verified) return null
  // A WSL folder comes back from `verifiedDirectory` canonical when `realpath` worked; insist on that here.
  if (session.kind === 'wsl') return (await canonicalizeWslPath(session.distro!, verified)) === verified ? verified : null
  try {
    return await fs.realpath(verified)
  } catch {
    return null
  }
}

/** Where a folder or shell lives, for a message: "in WSL (Ubuntu)", "on Windows". */
function environmentName(session: Session): string {
  if (session.kind === 'wsl') return `in WSL (${session.distro ?? 'no distribution'})`
  return process.platform === 'win32' ? 'on Windows' : 'on this computer'
}

async function revealDirectory(session: Session, directory: string): Promise<void> {
  if (session.kind === 'native') {
    await shell.openPath(directory)
    return
  }

  const distro = session.distro
  if (!distro) return
  // The file manager needs a Windows-side path; this is a display conversion.
  const windowsPath = (await toWindows(distro, directory)) ?? uncPathFor(distro, directory)
  await shell.openPath(windowsPath)
}

/** Hands a verified WSL folder to the registered Windows VS Code installation, reporting a failure to the user. */
async function openDirectoryInVsCode(session: Session, directory: string): Promise<void> {
  try {
    const url = safeVsCodeRemoteUrl(buildVsCodeRemoteUri(session, process.platform, directory))
    if (!url) throw new Error('Refusing to open an unexpected VS Code URL.')
    await shell.openExternal(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'Could not open VS Code',
      `Could not hand the WSL folder to the registered Windows VS Code installation. Make sure VS Code is installed and the Remote - WSL extension is available locally.\n\n${detail}`
    )
  }
}

/** Whether this process can show the session's folder in a file manager: a WSL folder needs Windows and a distro. */
function canRevealSession(session: Session): boolean {
  return session.kind !== 'wsl' || (process.platform === 'win32' && Boolean(session.distro))
}

/** Whether this process can open the session's folder in VS Code: only WSL folders, from Windows. */
function canOpenSessionInVsCode(session: Session): boolean {
  return process.platform === 'win32' && session.kind === 'wsl' && Boolean(session.distro)
}

export function registerIpcHandlers(
  security: IpcSecurityContext,
  ptyManager: PtyManager,
  miniWindow: MiniWindowController,
  titleBar: TitleBarController,
  inbox: { recorder: InboxRecorder; chat: InboxChatService; openCodeConfig: OpenCodeConfigService },
  taskbar?: TaskbarAttention,
  floatingTerminalKey?: FloatingTerminalKey
): void {
  const inboxRecorder = inbox.recorder
  const chat = inbox.chat
  const pendingEnsures = new Map<string, symbol>()
  // Inbox shells and conversation terminals have reserved identities, resolved from main-owned state.
  let inboxTerminalGeneration = 0
  let pendingInboxConfiguration: symbol | undefined
  const getShellSession = terminalSessionResolver({ getSession, listDistros, platform: process.platform })
  const getTerminalSession = async (id: string): Promise<Session | null> => {
    const threadId = inboxTerminalThreadId(id)
    return threadId ? chat.terminalSession(threadId) : getShellSession(id)
  }
  const threadTerminalLaunch = async (req: EnsurePtyRequest, session: Session): Promise<PtyLaunchOptions | null> => {
    const threadId = inboxTerminalThreadId(session.id)
    if (!threadId) {
      if (inboxTerminalThreadId(req.terminalId)) throw new Error('Invalid Inbox thread terminal.')
      return null
    }
    if (req.terminalId !== session.id) throw new Error('Invalid Inbox thread terminal launch.')
    const threadDirectory = chat.fileRoot(threadId)?.path
    if (!threadDirectory) throw new Error('The thread directory is not available.')
    const directory = await verifiedDirectory(session, threadDirectory)
    if (!directory) throw new Error('The thread directory is not available.')
    const launch = await chat.terminalLaunch(threadId)
    // Recheck after filesystem work: removing a thread must not leave a late launch behind.
    const current = chat.terminalSession(threadId)
    if (chat.fileRoot(threadId)?.path !== threadDirectory || current.kind !== session.kind || current.distro !== session.distro) {
      throw new Error('The thread directory has changed.')
    }
    return { directory, ...launch }
  }
  const restoredShellLaunch = async (
    req: EnsurePtyRequest,
    session: Session,
    restarting = false,
  ): Promise<PtyLaunchOptions | undefined> => {
    const current = ptyManager.terminalInfo(req.terminalId)
    // Reattaching a live or exited PTY does not relaunch it or recheck its folder.
    if (current && !restarting) return undefined
    const saved = (current?.sessionId === session.id ? current.directory : null) ??
      ptyManager.savedDirectory(req.terminalId, session)
    if (!saved) return undefined
    try {
      const directory = await verifiedDirectory(session, saved, true)
      if (!directory) return undefined
      if (session.kind === 'native') {
        await fs.access(directory, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      } else {
        const accessible = await runWslCommand(session.distro!, ['test', '-x', directory])
        if (accessible.code !== 0) return undefined
      }
      return { directory }
    } catch {
      // A missing folder or unavailable target uses the ordinary home-directory launch.
      return undefined
    }
  }
  // The renderer names a terminal and an expected cwd, never an arbitrary filesystem root.
  const terminalDirectory = async (req: TerminalDirectoryRequest): Promise<DirectoryContext> => {
    if (!isFileRoot(req) || !req.terminalId) throw new Error('Invalid terminal directory request.')
    const terminal = ptyManager.terminalInfo(req.terminalId)
    if (!terminal) throw new Error('Terminal no longer exists.')
    const session = await getTerminalSession(terminal.sessionId)
    if (!session) throw new Error('Session no longer exists.')
    const candidate = terminal.directory
    if (!candidate || candidate !== req.directory) throw new Error('The terminal directory has changed.')
    const directory = await verifiedDirectory(session, candidate)
    if (!directory) throw new Error('Terminal folder not found.')
    const current = ptyManager.terminalInfo(req.terminalId)
    if (!current || current.sessionId !== terminal.sessionId || current.directory !== candidate) {
      throw new Error('The terminal directory has changed.')
    }
    return { ...session, path: directory }
  }
  const fileRoot = async (root: FileRoot): Promise<DirectoryContext> => {
    if (!isFileRoot(root)) throw new Error('Invalid file root.')
    if (root.terminalId) return terminalDirectory(root)
    const session = chat.fileRoot(root.sessionId!)
    if (!session) throw new Error('Session no longer exists.')
    return session
  }
  const handle = <Req, Res>(
    channel: IpcChannel,
    handler: (req: Req, event: Electron.IpcMainInvokeEvent) => Promise<Res> | Res
  ): void => {
    ipcMain.handle(channel, async (event, req: unknown, ...extra: unknown[]) => {
      assertIpcSender(event, security)
      if (extra.length > 0) throw new Error(`Invalid IPC argument count for ${channel}.`)
      assertIpcPayload(channel, req)
      return handler(req as Req, event)
    })
  }

  handle<void, AppInfo>(IpcChannels.appInfo, () => createAppInfo(app.getVersion()))

  handle<void, PlatformInfo>(IpcChannels.platformInfo, () => ({
    platform: hostPlatform(),
    isWindows: process.platform === 'win32'
  }))

  handle<string, void>(IpcChannels.clipboardWriteText, (text) => {
    if (typeof text !== 'string') throw new Error('Invalid clipboard text.')
    clipboard.writeText(text)
  })

  // The same paste Ctrl/Cmd+V does, into whatever the sender has focused. Nothing is returned, so the
  // page cannot read the clipboard through this; it only receives the paste event a keypress would give.
  handle<void, void>(IpcChannels.clipboardPaste, (_req, event) => {
    event.sender.paste()
  })

  handle<void, WorkspaceData>(IpcChannels.workspaceList, () => loadWorkspace())
  handle<NewTodoProject, TodoProject>(IpcChannels.todoProjectsCreate, (input) =>
    createTodoProject(input)
  )
  handle<UpdateTodoProjectRequest, TodoProject | null>(IpcChannels.todoProjectsUpdate, (req) =>
    updateTodoProject(req)
  )
  handle<string, void>(IpcChannels.todoProjectsRemove, (id) => removeTodoProject(id))

  handle<NewTodoTask, TodoTask>(IpcChannels.todoTasksCreate, (input) => createTodoTask(input))
  handle<UpdateTodoTaskRequest, TodoTask | null>(IpcChannels.todoTasksUpdate, (req) =>
    updateTodoTask(req)
  )
  handle<MoveTodoTaskRequest, TodoTask[] | null>(IpcChannels.todoTasksMove, (req) =>
    moveTodoTask(req)
  )
  handle<string, void>(IpcChannels.todoTasksRemove, (id) => removeTodoTask(id))

  handle<NewSession, Session>(IpcChannels.sessionsCreate, (input) => createSession(input))
  handle<string, Session | null>(IpcChannels.sessionsDuplicate, (id) => duplicateSession(id))
  handle<UpdateSessionRequest, Session | null>(IpcChannels.sessionsUpdate, (req) =>
    updateSession(req)
  )
  handle<ReorderSessionRequest, Session[] | null>(IpcChannels.sessionsReorder, (req) =>
    reorderSession(req)
  )
  handle<string, void>(IpcChannels.sessionsRemove, async (id) => {
    ptyManager.disposeForSourceSession(id)
    await removeSession(id)
  })
  handle<CreateSessionTabRequest, Session | null>(IpcChannels.tabsCreate, (req) =>
    createSessionTab(req)
  )
  handle<SelectSessionTabRequest, Session | null>(IpcChannels.tabsSelect, (req) =>
    selectSessionTab(req)
  )
  handle<UpdateSessionTabRequest, Session | null>(IpcChannels.tabsUpdate, (req) =>
    updateSessionTab(req)
  )
  handle<RemoveSessionTabRequest, Session | null>(IpcChannels.tabsRemove, (req) =>
    removeSessionTab(req)
  )

  handle<void, InboxThread[]>(IpcChannels.inboxList, () => inboxRecorder.list())
  handle<InboxSetReadRequest, InboxThread | null>(IpcChannels.inboxSetRead, (req) =>
    inboxRecorder.setRead(req.id, req.read)
  )
  handle<InboxSetArchivedRequest, InboxThread | null>(IpcChannels.inboxSetArchived, (req) =>
    inboxRecorder.setArchived(req.id, req.archived)
  )
  handle<InboxSetPinnedRequest, InboxThread | null>(IpcChannels.inboxSetPinned, (req) =>
    inboxRecorder.setPinned(req.id, req.pinned)
  )
  handle<InboxSetCustomTitleRequest, InboxThread | null>(IpcChannels.inboxSetCustomTitle, (req) =>
    inboxRecorder.setCustomTitle(req.id, req.customTitle)
  )
  handle<InboxRemoveRequest, void>(IpcChannels.inboxRemove, async (req) => {
    // First, so that Git refusing (uncommitted changes) leaves the thread in place to try again.
    if (req.removeWorktree) await chat.removeThreadWorktree(req.id)
    await chat.removeDraft(`thread:${req.id}`)
    await chat.removeAsides(req.id)
    inboxRecorder.remove(req.id)
    const terminalId = inboxThreadTerminalId(req.id)
    pendingEnsures.delete(terminalId)
    ptyManager.dispose(terminalId)
  })
  handle<void, InboxFoldersState>(IpcChannels.inboxFolders, () => chat.folders())
  handle<InboxAddFolderRequest, InboxFolder>(IpcChannels.inboxFoldersAdd, async (req) => {
    // OpenCode's service runs where the folder lives: in WSL on Windows, natively on macOS.
    if (process.platform === 'win32' && req.kind !== 'wsl') throw new Error('On Windows, Inbox folders must be in WSL.')
    if (process.platform !== 'win32' && req.kind !== 'native') throw new Error('WSL folders are only available on Windows.')
    const resolution = await resolveForTarget(req.kind, req.distro, req.path)
    const distro = resolution.distro ?? req.distro
    const check = await validatePath({ kind: req.kind, ...(distro ? { distro } : {}), path: resolution.path })
    if (!check.exists) throw new Error(check.error ?? 'That folder does not exist.')
    return chat.addFolder({
      directory: resolution.path,
      target: req.kind === 'wsl' ? { kind: 'wsl', distro: distro as string } : { kind: 'native' },
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.icon ? { icon: req.icon } : {}),
    })
  })
  handle<InboxUpdateFolderRequest, InboxFolder>(IpcChannels.inboxFoldersUpdate, (req) => chat.updateFolder(req))
  handle<InboxRemoveFolderRequest, void>(IpcChannels.inboxFoldersRemove, (req) => chat.removeFolder(req.id))
  handle<InboxComposerState, InboxComposerState>(IpcChannels.inboxComposerSet, (req) => chat.setComposer(req))
  handle<InboxGitInfoRequest, InboxGitInfo>(IpcChannels.inboxGitInfo, (req) => chat.gitInfo(req))

  // OpenCode runs where its configuration lives: inside WSL on Windows, on this computer elsewhere. The renderer
  // only names which; the folder and file are worked out in the main process.
  const configTarget = async (req: OpenCodeConfigTarget): Promise<OpenCodeConfigTarget> => {
    if (process.platform === 'win32') {
      if (req.kind !== 'wsl' || !req.distro) throw new Error('On Windows, OpenCode runs in WSL.')
      const match = (await listDistros()).find((distro) => distro.name === req.distro)
      if (!match) throw new Error(`The WSL distribution ${req.distro} was not found.`)
      return { kind: 'wsl', distro: match.name }
    }
    if (req.kind !== 'native' || req.distro !== undefined) throw new Error('WSL is only available on Windows.')
    return { kind: 'native' }
  }
  handle<OpenCodeConfigRequest, OpenCodeConfigSnapshot>(IpcChannels.opencodeConfigRead, async (req) =>
    inbox.openCodeConfig.read(await configTarget(req)))
  handle<OpenCodeConfigPreviewRequest, OpenCodeConfigPreview>(IpcChannels.opencodeConfigPreview, async (req) =>
    inbox.openCodeConfig.preview(await configTarget(req), req.draft))
  handle<OpenCodeConfigSaveRequest, OpenCodeConfigSnapshot>(IpcChannels.opencodeConfigSave, async (req) =>
    inbox.openCodeConfig.save(await configTarget(req), req.draft, req.revision))

  handle<ChatConfigureRequest, void>(IpcChannels.chatConfigure, (req) => chat.configure(req.executable))
  handle<ChatOptionsRequest, ChatOptions>(IpcChannels.chatOptions, (req) => chat.chatOptions(req))
  handle<ChatCreateRequest, InboxThread>(IpcChannels.chatCreate, (req) => chat.create(req))
  const inboxGitRoot = (threadId: string): DirectoryContext => {
    const session = chat.fileRoot(threadId)
    if (!session) throw new Error('This thread is no longer in the Inbox.')
    return session
  }
  handle<InboxChangesRequest, InboxChangesResponse>(IpcChannels.inboxChanges, (req) => readInboxGitChanges(inboxGitRoot(req.threadId), req.details))
  handle<InboxChangeDiffRequest, InboxChangeDiff>(IpcChannels.inboxChangeDiff, (req) => readInboxGitDiff(inboxGitRoot(req.threadId), req.path))
  /**
   * The checkout a Git graph request names: a thread's recorded directory, or a live terminal's
   * current directory, verified on disk as for the terminal's Git chip. The renderer never names a path.
   */
  const gitGraphRoot = async (req: GitRootRequest): Promise<DirectoryContext> => {
    if ('threadId' in req) return inboxGitRoot(req.threadId)
    const terminal = ptyManager.terminalInfo(req.terminalId)
    if (!terminal) throw new Error('This terminal is no longer running.')
    const session = await getTerminalSession(terminal.sessionId)
    const directory = session && terminal.directory ? await verifiedDirectory(session, terminal.directory) : null
    if (!session || !directory) throw new Error('The folder of this terminal could not be found.')
    return { ...session, path: directory }
  }
  handle<GitGraphRequest, InboxGitGraph>(IpcChannels.gitGraph, async (req) => readInboxGitGraph(await gitGraphRoot(req), req.limit, req.scope))
  handle<GitCommitRequest, InboxGitCommitDetails>(IpcChannels.gitCommit, async (req) => readInboxGitCommit(await gitGraphRoot(req), req.hash))
  handle<GitRootRequest, InboxGitFetchResult>(IpcChannels.gitFetch, async (req) => fetchInboxGit(await gitGraphRoot(req)))
  handle<GitRootRequest, InboxChangesResponse>(IpcChannels.gitChanges, async (req) => readInboxGitChanges(await gitGraphRoot(req), true))
  handle<GitCommitDiffRequest, InboxChangeDiff>(IpcChannels.gitCommitDiff, async (req) => {
    const { hash, path, ...root } = req
    return readInboxGitCommitDiff(await gitGraphRoot(root), hash, path)
  })
  handle<GitRootRequest & { path: string }, InboxChangeDiff>(IpcChannels.gitChangeDiff, async (req) => {
    const { path, ...root } = req
    return readInboxGitDiff(await gitGraphRoot(root), path)
  })
  handle<ChatMessagesRequest, ChatMessagesPage>(IpcChannels.chatMessages, (req) => chat.messages(req))
  handle<ChatSearchRequest, ChatSearchResponse>(IpcChannels.chatSearch, (req) => chat.search(req))
  handle<ChatFilesRequest, ChatFileEntry[]>(IpcChannels.chatFiles, (req) => chat.files(req))
  handle<ChatFilesCheckRequest, ChatFileEntry[]>(IpcChannels.chatFilesCheck, (req) => chat.checkFiles(req))
  handle<void, ChatDraftList>(IpcChannels.chatDrafts, () => chat.drafts())
  handle<ChatDraftRequest, ChatDraft>(IpcChannels.chatDraft, async (req) => chat.draft(req, req.action === 'tree' ? await fileRoot(req) : undefined))
  handle<ChatSendRequest, ChatPendingMessage | null>(IpcChannels.chatSend, (req) => chat.send(req))
  handle<ChatDiscardPendingRequest, void>(IpcChannels.chatDiscardPending, (req) => chat.discardPending(req))
  handle<ChatSetDeliveryRequest, void>(IpcChannels.chatSetDelivery, (req) => chat.setDelivery(req))
  handle<ChatAsideRequest, ChatAsideAnswer>(IpcChannels.chatAside, (req) => chat.aside(req))
  handle<ChatAsideHistoryRequest, ChatAsideEntry[]>(IpcChannels.chatAsideHistory, (req) => chat.asideHistory(req))
  handle<ChatMcpRequest, ChatMcpState>(IpcChannels.chatMcp, (req) => chat.mcpList(req))
  handle<ChatMcpSetRequest, void>(IpcChannels.chatMcpSet, (req) => chat.mcpSetEnabled(req))
  handle<ChatThreadRequest, void>(IpcChannels.chatInterrupt, (req) => chat.interrupt(req.threadId))
  handle<ChatThreadRequest, void>(IpcChannels.chatCompact, (req) => chat.compact(req.threadId))
  handle<ChatThreadRequest, ChatGoal | null>(IpcChannels.chatGoal, (req) => chat.goal(req.threadId))
  handle<ChatThreadRequest, ChatBackgroundState>(IpcChannels.chatBackground, (req) => chat.backgroundTasks(req.threadId))
  handle<ChatGoalRequest, void>(IpcChannels.chatGoalSet, (req) => chat.setGoal(req))
  handle<ChatThreadRequest, void>(IpcChannels.chatRedo, (req) => chat.redo(req.threadId))
  handle<ChatRevertRequest, ChatRevert>(IpcChannels.chatRevert, (req) => chat.revert(req))
  handle<ChatForkRequest, ChatForkResult>(IpcChannels.chatFork, (req) => chat.fork(req))
  handle<ChatThreadRequest, void>(IpcChannels.chatRegenerateTitle, (req) => chat.regenerateTitle(req.threadId))
  handle<ChatThreadRequest, ChatRequests>(IpcChannels.chatRequests, (req) => chat.requests(req.threadId))
  handle<ChatPermissionReplyRequest, void>(IpcChannels.chatPermissionReply, (req) => chat.replyPermission(req))
  handle<ChatFormReplyRequest, void>(IpcChannels.chatFormReply, (req) => chat.replyForm(req))
  handle<ChatThreadRequest, void>(IpcChannels.chatSubscribe, (req) => chat.subscribe(req.threadId))
  handle<ChatThreadRequest, void>(IpcChannels.chatUnsubscribe, (req) => chat.unsubscribe(req.threadId))

  handle<void, WindowMode>(IpcChannels.windowModeGet, () => miniWindow.mode)
  handle<SetWindowModeRequest, WindowMode>(IpcChannels.windowModeSet, (req) => {
    miniWindow.set(req.mode)
    return miniWindow.mode
  })

  handle<WindowChromeColors, void>(IpcChannels.windowChromeSet, (req) => titleBar.setColors(req))

  handle<TaskbarAttentionRequest, void>(IpcChannels.attentionUpdate, (req) => taskbar?.update(req))
  handle<void, void>(IpcChannels.attentionBeep, () => shell.beep())
  handle<{ active: boolean }, void>(IpcChannels.floatingTerminalActive, ({ active }) => floatingTerminalKey?.setActive(active))

  handle<InboxTerminalSettings, InboxTerminalConfiguration>(IpcChannels.ptyConfigureInbox, async (req) => {
    if (process.platform !== 'win32' && req.distro !== null) throw new Error('WSL is only available on Windows.')
    const pending = Symbol()
    pendingInboxConfiguration = pending
    const distros = process.platform === 'win32' ? await listDistros() : []
    const next = inboxTerminalSession(process.platform, distros, req.distro)
    if (req.distro !== null && !next) throw new Error(`The WSL distribution ${req.distro} was not found.`)
    const current = await getShellSession(INBOX_TERMINAL_SESSION_ID)
    if (pendingInboxConfiguration !== pending) throw new Error('The sidebar terminal selection changed. Try again.')
    const changed = current?.kind !== next?.kind || current?.distro !== next?.distro
    if (changed) {
      // Invalidate launches still checking a directory before stopping the old shells.
      inboxTerminalGeneration++
      const hasShells = Object.keys(ptyManager.statuses()).some((id) =>
        ptyManager.terminalInfo(id)?.sessionId === INBOX_TERMINAL_SESSION_ID)
      // At startup, saved directories already carry their distro; preserve matching ones.
      if (hasShells) ptyManager.disposeForSourceSession(INBOX_TERMINAL_SESSION_ID)
    }
    getShellSession.setInboxSession(next)
    return { session: next, changed }
  })

  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyEnsure, async (req) => {
    const pending = Symbol()
    const generation = inboxTerminalGeneration
    pendingEnsures.set(req.terminalId, pending)
    try {
      const session = await getTerminalSession(req.sessionId)
      if (!session) return 'none'
      const launch = await threadTerminalLaunch(req, session) ?? await restoredShellLaunch(req, session)
      if (pendingEnsures.get(req.terminalId) !== pending ||
        (req.sessionId === INBOX_TERMINAL_SESSION_ID && generation !== inboxTerminalGeneration)) return 'none'
      return ptyManager.ensure(
        req.terminalId,
        session,
        req.size,
        validateTerminalPalette(req.palette),
        launch
      )
    } finally {
      if (pendingEnsures.get(req.terminalId) === pending) pendingEnsures.delete(req.terminalId)
    }
  })
  handle<RestartPtyRequest, PtyStatus>(IpcChannels.ptyRestart, async (req) => {
    const pending = Symbol()
    const generation = inboxTerminalGeneration
    pendingEnsures.set(req.terminalId, pending)
    try {
      const session = await getTerminalSession(req.sessionId)
      if (!session) return 'none'
      const launch = await threadTerminalLaunch(req, session) ?? await restoredShellLaunch(req, session, true)
      if (pendingEnsures.get(req.terminalId) !== pending ||
        (req.sessionId === INBOX_TERMINAL_SESSION_ID && generation !== inboxTerminalGeneration)) return 'none'
      return ptyManager.restart(
        req.terminalId,
        session,
        req.size,
        validateTerminalPalette(req.palette),
        launch
      )
    } finally {
      if (pendingEnsures.get(req.terminalId) === pending) pendingEnsures.delete(req.terminalId)
    }
  })
  handle<WritePtyRequest, void>(IpcChannels.ptyWrite, (req) => {
    ptyManager.write(req.terminalId, req.data)
  })
  handle<ResizePtyRequest, void>(IpcChannels.ptyResize, (req) => {
    ptyManager.resize(req.terminalId, req.size)
  })
  handle<UpdatePtyPaletteRequest, void>(IpcChannels.ptyPalette, (req) => {
    ptyManager.setPalette(req.terminalId, validateTerminalPalette(req.palette))
  })
  handle<string, void>(IpcChannels.ptyDispose, (sessionId) => {
    pendingEnsures.delete(sessionId)
    ptyManager.dispose(sessionId)
  })
  handle<void, Record<string, PtyStatus>>(IpcChannels.ptyStatuses, () => ptyManager.statuses())
  handle<void, Record<string, string>>(IpcChannels.ptyDirectories, () => ptyManager.directories())
  handle<DropPtyFilesRequest, PtyDropResult>(IpcChannels.ptyDropFiles, async (req) => {
    if (
      !req ||
      typeof req.terminalId !== 'string' ||
      !Array.isArray(req.files) ||
      !req.files.every(isDropPtyFile) ||
      (req.treeEntry !== undefined && (
        !req.treeEntry ||
        !isFileRoot(req.treeEntry) ||
        typeof req.treeEntry.path !== 'string' ||
        req.treeEntry.path.length === 0 ||
        !isSafeRelativePath(req.treeEntry.path)
      )) ||
      !isTerminalDropMode(req.mode)
    ) {
      throw new Error('Invalid terminal file drop.')
    }

    const droppedFiles = req.treeEntry
      ? [...req.files, { name: req.treeEntry.path.split('/').pop()! }]
      : req.files
    const terminal = ptyManager.terminalInfo(req.terminalId)
    if (!terminal || ptyManager.status(req.terminalId) !== 'running') {
      return terminalDropUnavailable(droppedFiles)
    }

    const session = await getTerminalSession(terminal.sessionId)
    if (!session) return terminalDropUnavailable(droppedFiles)

    const files = [...req.files]
    if (req.treeEntry) {
      const source = await fileRoot(req.treeEntry)
      files.push(await fileTreeDropFile(source, req.treeEntry.path, process.platform))
    }
    return resolveTerminalDrop(session, process.platform, files, req.mode)
  })

  handle<void, boolean>(IpcChannels.wslAvailable, () => isWslAvailable())
  handle<void, Distro[]>(IpcChannels.wslDistros, () => listDistros())

  handle<void, string | null>(IpcChannels.pathBrowse, async (_req, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  handle<ResolvePathRequest, PathResolution>(IpcChannels.pathResolve, (req) =>
    resolveForTarget(req.kind, req.distro, req.rawPath)
  )
  handle<ValidatePathRequest, PathCheckResult>(IpcChannels.pathValidate, (req) => validatePath(req))
  handle<ListWslDirectoriesRequest, WslDirectoryListing>(IpcChannels.pathListWslDirectories, (req) => listWslDirectories(req))
  handle<string, void>(IpcChannels.pathRevealTerminal, async (terminalId) => {
    const terminal = ptyManager.terminalInfo(terminalId)
    if (!terminal?.directory) return

    const session = await getTerminalSession(terminal.sessionId)
    if (!session || !canRevealSession(session)) return

    const directory = await verifiedDirectory(session, terminal.directory)
    if (!directory) return

    await revealDirectory(session, directory)
  })
  handle<string, void>(IpcChannels.pathOpenTerminalInVsCode, async (terminalId) => {
    const terminal = ptyManager.terminalInfo(terminalId)
    if (!terminal?.directory) return

    const session = await getTerminalSession(terminal.sessionId)
    if (!session || !canOpenSessionInVsCode(session)) return

    const directory = await verifiedDirectory(session, terminal.directory)
    if (!directory) return

    await openDirectoryInVsCode(session, directory)
  })
  // The folder of an Inbox thread or project. Main resolves the ID from the Inbox store, so the renderer
  // never names a path, and the folder is verified like a terminal's before it reaches the desktop.
  const inboxDirectory = async (id: string, allowed: (session: Session) => boolean): Promise<{ session: Session; directory: string } | null> => {
    const root = chat.fileRoot(id)
    if (!root || !allowed(root)) return null
    const directory = await verifiedDirectory(root, root.path)
    return directory ? { session: root, directory } : null
  }
  handle<string, void>(IpcChannels.pathRevealInbox, async (id) => {
    const folder = await inboxDirectory(id, canRevealSession)
    if (folder) await revealDirectory(folder.session, folder.directory)
  })
  handle<string, void>(IpcChannels.pathOpenInboxInVsCode, async (id) => {
    const folder = await inboxDirectory(id, canOpenSessionInVsCode)
    if (folder) await openDirectoryInVsCode(folder.session, folder.directory)
  })
  // A folder the Files tree shows, named relative to the tree's root like a listing. Both ends are resolved
  // to their real paths, so a folder that is (or was swapped for) a link out of the root is refused.
  const treeFolder = async (
    req: FilesListRequest,
    allowed: (session: Session) => boolean = () => true,
  ): Promise<{ context: DirectoryContext; directory: string } | null> => {
    if (!isFileRoot(req) || typeof req.path !== 'string' || !isSafeRelativePath(req.path)) {
      throw new Error('Invalid folder request.')
    }
    const context = await fileRoot(req)
    if (!allowed(context)) return null
    const root = await realDirectory(context, context.path)
    if (!root) return null
    const directory = req.path ? await realDirectory(context, treeFolderPath(context, req.path)) : root
    if (!directory || !isWithinRoot(context.kind, root, directory)) {
      console.warn('[path] not using a Files tree folder outside its root')
      return null
    }
    return { context, directory }
  }
  handle<FilesListRequest, void>(IpcChannels.pathRevealTreeFolder, async (req) => {
    const folder = await treeFolder(req, canRevealSession)
    if (folder) await revealDirectory(folder.context, folder.directory)
  })
  // The new terminal's shell starts there through the saved-directory record, which the launch checks again.
  handle<StartTerminalInFolderRequest, void>(IpcChannels.ptyStartInFolder, async (req) => {
    if (inboxTerminalThreadId(req.sessionId) || !req.terminalId.startsWith(`${req.sessionId}:tab:`)) {
      throw new Error('Invalid terminal.')
    }
    if (ptyManager.terminalInfo(req.terminalId)) throw new Error('That terminal is already running.')
    const session = await getTerminalSession(req.sessionId)
    if (!session) throw new Error('Session no longer exists.')
    const folder = await treeFolder(req.folder)
    if (!folder) throw new Error('Folder not found.')
    if (folder.context.kind !== session.kind || (session.kind === 'wsl' && folder.context.distro !== session.distro)) {
      throw new Error(`This folder is ${environmentName(folder.context)}, but the terminal runs ${environmentName(session)}.`)
    }
    ptyManager.rememberDirectory(req.terminalId, session, folder.directory)
  })

  handle<GitTerminalInfoRequest, GitTerminalInfoResponse | null>(
    IpcChannels.gitTerminalInfo,
    async (req) => {
      if (!req || typeof req.terminalId !== 'string' || !req.terminalId) {
        throw new Error('Invalid terminal Git request.')
      }

      const terminal = ptyManager.terminalInfo(req.terminalId)
      if (!terminal) return null

      const session = await getTerminalSession(terminal.sessionId)
      if (!session) return null

      const candidateDirectory = terminal.directory
      if (!candidateDirectory) return null
      const directory = await verifiedDirectory(session, candidateDirectory)
      if (!directory) return null

      try {
        return { ...await readGitTerminalInfo(session, directory), directory: candidateDirectory }
      } catch {
        // Terminal metadata is intentionally best-effort. The header should
        // disappear when Git cannot read the current directory.
        return null
      }
    }
  )

  handle<FilesListRequest, FileTreeListResponse>(IpcChannels.filesList, async (req) => {
    if (!isFileRoot(req) || typeof req.path !== 'string') throw new Error('Invalid file request.')
    return listSessionDirectory(await fileRoot(req), req.path)
  })

  handle<FilesReadRequest, FileReadResponse>(IpcChannels.filesRead, async (req) => {
    if (!isFileRoot(req) || typeof req.path !== 'string') throw new Error('Invalid file request.')
    return readSessionFile(await fileRoot(req), req.path)
  })
}
