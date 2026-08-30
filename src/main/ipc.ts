import { promises as fs } from 'node:fs'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import {
  type AppInfo,
  type CreateSessionTabRequest,
  type DropPtyFile,
  type DropPtyFilesRequest,
  type GitDiffRequest,
  type GitInfoRequest,
  type GitStatusRequest,
  IpcChannels,
  type EnsurePtyRequest,
  type MoveSessionRequest,
  type MoveTodoTaskRequest,
  type PlatformInfo,
  type ReorderSessionRequest,
  type RemoveSessionTabRequest,
  type ResizePtyRequest,
  type ResolvePathRequest,
  type TerminalPalette,
  type PtyDropResult,
  type PtyDropRejection,
  type TerminalDropMode,
  type UpdatePtyPaletteRequest,
  type UpdateProjectRequest,
  type UpdateTodoProjectRequest,
  type UpdateTodoTaskRequest,
  type UpdateSessionRequest,
  type UpdateSessionTabRequest,
  type SelectSessionTabRequest,
  type ValidatePathRequest,
  type WritePtyRequest,
  type WorkspaceData
} from '@shared/ipc'
import type {
  Distro,
  GitDiffResponse,
  HostPlatform,
  GitInfoResponse,
  GitStatusResponse,
  NewProject,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  PathCheckResult,
  PathResolution,
  Project,
  TodoProject,
  TodoTask,
  OpenCodeTuiPluginRequest,
  OpenCodeTuiPluginState,
  OpenCodeTuiSetEnabledRequest,
  OpenCodeTuiSetInstanceLabelModeRequest,
  OpenCodeTuiSettings,
  OpenCodeTokenRatePluginRequest,
  OpenCodeTokenRatePluginState,
  OpenCodeAlertSetEnabledRequest,
  OpenCodeAlertSettings,
  Session,
  PtyStatus
} from '@shared/types'
import type { PtyManager } from './pty/manager'
import { resolveTerminalDrop } from './pty/drop'
import type { OpenCodeTuiStatusManager } from './opencode/tui-status'
import type { OpenCodeTokenRatePluginManager } from './opencode/token-rate'
import type { OpenCodeAlertManager } from './opencode/alerts'
import { createAppInfo } from '@shared/app-info'
import { isWslAvailable, listDistros, runWsl } from './wsl/distros'
import { canonicalizeWslPath, resolveForTarget, toWindows, uncPathFor } from './wsl/paths'
import { buildVsCodeRemoteUri } from './vscode'
import { safeVsCodeRemoteUrl } from './external-links'
import { readGitDiff, readGitInfo, readGitStatus } from './git'
import {
  createProject,
  createTodoProject,
  createTodoTask,
  createSession,
  duplicateSession,
  getSession,
  loadWorkspace,
  moveSession,
  removeProject,
  removeTodoProject,
  removeTodoTask,
  removeSession,
  reorderSession,
  createSessionTab,
  removeSessionTab,
  selectSessionTab,
  updateProject,
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
    const result = await runWsl(['-d', req.distro, 'test', '-d', canonical ?? path])
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

async function revealSession(session: Session): Promise<void> {
  await revealDirectory(session, session.path)
}

export function registerIpcHandlers(
  ptyManager: PtyManager,
  opencodeTuiStatusManager: OpenCodeTuiStatusManager,
  opencodeTokenRatePluginManager: OpenCodeTokenRatePluginManager,
  opencodeAlertManager: OpenCodeAlertManager
): void {
  const handle = <Req, Res>(
    channel: string,
    handler: (req: Req, event: Electron.IpcMainInvokeEvent) => Promise<Res> | Res
  ): void => {
    ipcMain.handle(channel, (event, req: Req) => handler(req, event))
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

  handle<void, WorkspaceData>(IpcChannels.workspaceList, () => loadWorkspace())
  handle<NewProject, Project>(IpcChannels.projectsCreate, (input) => createProject(input))
  handle<UpdateProjectRequest, Project | null>(IpcChannels.projectsUpdate, (req) =>
    updateProject(req)
  )
  handle<string, void>(IpcChannels.projectsRemove, async (id) => {
    // Removing a project must not leave any child shell running.
    const workspace = await loadWorkspace()
    for (const session of workspace.sessions) {
      if (session.projectId === id) {
        ptyManager.disposeForSourceSession(session.id)
      }
    }
    await removeProject(id)
  })

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

  handle<NewSession, Session>(IpcChannels.sessionsCreate, async (input) => {
    const resolution = await resolveForTarget(input.kind, input.distro, input.path)
    return createSession({
      ...input,
      path: resolution.path,
      ...(resolution.distro ? { distro: resolution.distro } : {})
    })
  })
  handle<string, Session | null>(IpcChannels.sessionsDuplicate, (id) => duplicateSession(id))
  handle<UpdateSessionRequest, Session | null>(IpcChannels.sessionsUpdate, (req) =>
    updateSession(req)
  )
  handle<MoveSessionRequest, Session | null>(IpcChannels.sessionsMove, (req) => moveSession(req))
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

  handle<OpenCodeTuiPluginRequest, OpenCodeTuiPluginState>(
    IpcChannels.opencodeTuiPluginState,
    async (req) => {
      return opencodeTuiStatusManager.pluginState(req.distro)
    }
  )
  handle<OpenCodeTuiPluginRequest, OpenCodeTuiPluginState>(
    IpcChannels.opencodeTuiPluginInstall,
    (req) => opencodeTuiStatusManager.installPlugin(req.distro)
  )
  handle<OpenCodeTuiPluginRequest, OpenCodeTuiPluginState>(
    IpcChannels.opencodeTuiPluginRemove,
    (req) => opencodeTuiStatusManager.removePlugin(req.distro)
  )
  handle<void, OpenCodeTuiSettings>(IpcChannels.opencodeTuiSettings, () =>
    opencodeTuiStatusManager.settings()
  )
  handle<OpenCodeTuiSetEnabledRequest, OpenCodeTuiSettings>(
    IpcChannels.opencodeTuiSetEnabled,
    (req) => {
      if (typeof req?.enabled !== 'boolean') {
        throw new Error('Invalid OpenCode TUI enabled setting.')
      }
      return opencodeTuiStatusManager.setEnabled(req.enabled)
    }
  )
  handle<OpenCodeTuiSetInstanceLabelModeRequest, OpenCodeTuiSettings>(
    IpcChannels.opencodeTuiSetInstanceLabelMode,
    (req) => {
      if (req?.mode !== 'numbered' && req?.mode !== 'title') {
        throw new Error('Invalid OpenCode TUI instance label mode.')
      }
      return opencodeTuiStatusManager.setInstanceLabelMode(req.mode)
    }
  )

  handle<OpenCodeTokenRatePluginRequest, OpenCodeTokenRatePluginState>(
    IpcChannels.opencodeTokenRatePluginState,
    (req) => opencodeTokenRatePluginManager.pluginState(req.target)
  )
  handle<OpenCodeTokenRatePluginRequest, OpenCodeTokenRatePluginState>(
    IpcChannels.opencodeTokenRatePluginInstall,
    (req) => opencodeTokenRatePluginManager.installPlugin(req.target)
  )
  handle<OpenCodeTokenRatePluginRequest, OpenCodeTokenRatePluginState>(
    IpcChannels.opencodeTokenRatePluginRemove,
    (req) => opencodeTokenRatePluginManager.removePlugin(req.target)
  )

  handle<void, OpenCodeAlertSettings>(IpcChannels.opencodeAlertsSettings, () =>
    opencodeAlertManager.settings()
  )
  handle<OpenCodeAlertSetEnabledRequest, OpenCodeAlertSettings>(
    IpcChannels.opencodeAlertsSetEnabled,
    (req) => {
      if (typeof req?.enabled !== 'boolean') {
        throw new Error('Invalid OpenCode alerts enabled setting.')
      }
      return opencodeAlertManager.setEnabled(req.enabled)
    }
  )

  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyEnsure, async (req) => {
    const session = await getSession(req.sessionId)
    if (!session) return 'none'
    return ptyManager.ensure(
      req.terminalId,
      session,
      req.size,
      validateTerminalPalette(req.palette)
    )
  })
  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyRestart, async (req) => {
    const session = await getSession(req.sessionId)
    if (!session) return 'none'
    return ptyManager.restart(
      req.terminalId,
      session,
      req.size,
      validateTerminalPalette(req.palette)
    )
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
      !isTerminalDropMode(req.mode)
    ) {
      throw new Error('Invalid terminal file drop.')
    }

    const terminal = ptyManager.terminalInfo(req.terminalId)
    if (!terminal || ptyManager.status(req.terminalId) !== 'running') {
      return terminalDropUnavailable(req.files)
    }

    const session = await getSession(terminal.sessionId)
    if (!session) return terminalDropUnavailable(req.files)

    return resolveTerminalDrop(session, process.platform, req.files, req.mode)
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
  handle<string, void>(IpcChannels.pathReveal, async (sessionId) => {
    const session = await getSession(sessionId)
    if (session) await revealSession(session)
  })
  handle<string, void>(IpcChannels.pathRevealTerminal, async (terminalId) => {
    const terminal = ptyManager.terminalInfo(terminalId)
    if (!terminal?.directory) return

    const session = await getSession(terminal.sessionId)
    if (!session || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) return

    await revealDirectory(session, terminal.directory)
  })
  handle<string, void>(IpcChannels.pathOpenInVsCode, async (sessionId) => {
    const session = await getSession(sessionId)
    if (!session || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) return

    try {
      const url = safeVsCodeRemoteUrl(buildVsCodeRemoteUri(session, process.platform))
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
  handle<string, void>(IpcChannels.pathOpenTerminalInVsCode, async (terminalId) => {
    const terminal = ptyManager.terminalInfo(terminalId)
    if (!terminal?.directory) return

    const session = await getSession(terminal.sessionId)
    if (!session || process.platform !== 'win32' || session.kind !== 'wsl' || !session.distro) return

    try {
      const url = safeVsCodeRemoteUrl(
        buildVsCodeRemoteUri(session, process.platform, terminal.directory)
      )
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
    if (!req || typeof req.sessionId !== 'string' || !req.sessionId) {
      throw new Error('Invalid Git session request.')
    }
    const session = await getSession(req.sessionId)
    if (!session) throw new Error('Session no longer exists.')
    return readGitInfo(session)
  })

  handle<GitStatusRequest, GitStatusResponse>(IpcChannels.gitStatus, async (req) => {
    if (!req || typeof req.sessionId !== 'string' || !req.sessionId) {
      throw new Error('Invalid Git session request.')
    }
    const session = await getSession(req.sessionId)
    if (!session) throw new Error('Session no longer exists.')
    return readGitStatus(session)
  })

  handle<GitDiffRequest, GitDiffResponse>(IpcChannels.gitDiff, async (req) => {
    if (!req || typeof req.sessionId !== 'string' || !req.sessionId || typeof req.path !== 'string' || !req.path) {
      throw new Error('Invalid Git diff request.')
    }
    const session = await getSession(req.sessionId)
    if (!session) throw new Error('Session no longer exists.')
    return readGitDiff(session, req.path)
  })
}
