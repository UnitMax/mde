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
  type GitDiffRequest,
  type GitInfoRequest,
  type TerminalDirectoryRequest,
  type FileRoot,
  type GitTerminalInfoRequest,
  IpcChannels,
  type EnsurePtyRequest,
  type RestartPtyRequest,
  type FilesListRequest,
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
  GitDiffResponse,
  HostPlatform,
  GitInfoResponse,
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
  ChatSetDeliveryRequest,
  ChatAsideRequest,
  ChatAsideAnswer,
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
import { readGitDiff, readGitInfo, readGitTerminalInfo } from './git'
import { readInboxGitChanges, readInboxGitDiff } from './inbox/changes'
import { terminalSessionResolver } from './inbox/terminal'
import { isSafeRelativePath, listSessionDirectory, readSessionFile } from './files/tree'
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

export function registerIpcHandlers(
  security: IpcSecurityContext,
  ptyManager: PtyManager,
  miniWindow: MiniWindowController,
  titleBar: TitleBarController,
  inbox: { recorder: InboxRecorder; chat: InboxChatService; openCodeConfig: OpenCodeConfigService }
): void {
  const inboxRecorder = inbox.recorder
  const chat = inbox.chat
  const pendingEnsures = new Map<string, symbol>()
  // Inbox shells and conversation terminals have reserved identities, resolved from main-owned state.
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
  handle<ChatMessagesRequest, ChatMessagesPage>(IpcChannels.chatMessages, (req) => chat.messages(req))
  handle<void, ChatDraftList>(IpcChannels.chatDrafts, () => chat.drafts())
  handle<ChatDraftRequest, ChatDraft>(IpcChannels.chatDraft, async (req) => chat.draft(req, req.action === 'tree' ? await fileRoot(req) : undefined))
  handle<ChatSendRequest, ChatPendingMessage | null>(IpcChannels.chatSend, (req) => chat.send(req))
  handle<ChatDiscardPendingRequest, void>(IpcChannels.chatDiscardPending, (req) => chat.discardPending(req))
  handle<ChatSetDeliveryRequest, void>(IpcChannels.chatSetDelivery, (req) => chat.setDelivery(req))
  handle<ChatAsideRequest, ChatAsideAnswer>(IpcChannels.chatAside, (req) => chat.aside(req))
  handle<ChatMcpRequest, ChatMcpState>(IpcChannels.chatMcp, (req) => chat.mcpList(req))
  handle<ChatMcpSetRequest, void>(IpcChannels.chatMcpSet, (req) => chat.mcpSetEnabled(req))
  handle<ChatThreadRequest, void>(IpcChannels.chatInterrupt, (req) => chat.interrupt(req.threadId))
  handle<ChatThreadRequest, void>(IpcChannels.chatCompact, (req) => chat.compact(req.threadId))
  handle<ChatThreadRequest, ChatGoal | null>(IpcChannels.chatGoal, (req) => chat.goal(req.threadId))
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

  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyEnsure, async (req) => {
    const pending = Symbol()
    pendingEnsures.set(req.terminalId, pending)
    try {
      const session = await getTerminalSession(req.sessionId)
      if (!session) return 'none'
      const launch = await threadTerminalLaunch(req, session) ?? await restoredShellLaunch(req, session)
      if (pendingEnsures.get(req.terminalId) !== pending) return 'none'
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
    pendingEnsures.set(req.terminalId, pending)
    try {
      const session = await getTerminalSession(req.sessionId)
      if (!session) return 'none'
      const launch = await threadTerminalLaunch(req, session) ?? await restoredShellLaunch(req, session, true)
      if (pendingEnsures.get(req.terminalId) !== pending) return 'none'
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
    if (!session || (session.kind === 'wsl' && (process.platform !== 'win32' || !session.distro))) return

    const directory = await verifiedDirectory(session, terminal.directory)
    if (!directory) return

    await revealDirectory(session, directory)
  })
  handle<string, void>(IpcChannels.pathOpenTerminalInVsCode, async (terminalId) => {
    const terminal = ptyManager.terminalInfo(terminalId)
    if (!terminal?.directory) return

    const session = await getTerminalSession(terminal.sessionId)
    if (!session || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) return

    const directory = await verifiedDirectory(session, terminal.directory)
    if (!directory) return

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
  })

  handle<GitInfoRequest, GitInfoResponse>(IpcChannels.gitInfo, async (req) => {
    return readGitInfo(await terminalDirectory(req))
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

  handle<GitDiffRequest, GitDiffResponse>(IpcChannels.gitDiff, async (req) => {
    if (!req || typeof req.path !== 'string' || !req.path) throw new Error('Invalid Git diff request.')
    return readGitDiff(await terminalDirectory(req), req.path)
  })

  handle<FilesListRequest, FileTreeListResponse>(IpcChannels.filesList, async (req) => {
    if (!isFileRoot(req) || typeof req.path !== 'string') throw new Error('Invalid file request.')
    return listSessionDirectory(await fileRoot(req), req.path)
  })

  handle<FilesReadRequest, FileReadResponse>(IpcChannels.filesRead, async (req) => {
    if (!isFileRoot(req) || typeof req.path !== 'string') throw new Error('Invalid file request.')
    return readSessionFile(await fileRoot(req), req.path)
  })
}
