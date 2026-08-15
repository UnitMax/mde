import { promises as fs } from 'node:fs'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  IpcChannels,
  type EnsurePtyRequest,
  type MoveSessionRequest,
  type PlatformInfo,
  type ResizePtyRequest,
  type ResolvePathRequest,
  type UpdateProjectRequest,
  type UpdateSessionRequest,
  type ValidatePathRequest,
  type WritePtyRequest
} from '@shared/ipc'
import type {
  Distro,
  HostPlatform,
  NewProject,
  NewSession,
  PathCheckResult,
  PathResolution,
  Project,
  SendOpenCodeMessageRequest,
  SendOpenCodeMessageResponse,
  Session,
  PtyStatus
} from '@shared/types'
import type { PtyManager } from './pty/manager'
import type { OpenCodeManager } from './opencode/manager'
import { isWslAvailable, listDistros, runWsl } from './wsl/distros'
import { resolveForTarget, toWindows, uncPathFor } from './wsl/paths'
import {
  createProject,
  createSession,
  getSession,
  loadWorkspace,
  moveSession,
  removeProject,
  removeSession,
  updateProject,
  updateSession
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

async function validatePath(req: ValidatePathRequest): Promise<PathCheckResult> {
  const path = req.path.trim()
  if (!path) return { exists: false }

  if (req.kind === 'wsl') {
    if (!req.distro) return { exists: false, error: 'No distro selected' }
    if (!(await isWslAvailable())) return { exists: false, error: 'WSL is not available' }

    // Validated inside the distro, not through the Windows filesystem: a path
    // like /home/me/src does not exist on Windows at all.
    const result = await runWsl(['-d', req.distro, 'test', '-d', path])
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

async function revealSession(session: Session): Promise<void> {
  if (session.kind === 'native') {
    await shell.openPath(session.path)
    return
  }

  const distro = session.distro
  if (!distro) return
  // The file manager needs a Windows-side path; this is a display conversion.
  const windowsPath = (await toWindows(distro, session.path)) ?? uncPathFor(distro, session.path)
  await shell.openPath(windowsPath)
}

export function registerIpcHandlers(ptyManager: PtyManager, opencodeManager: OpenCodeManager): void {
  const handle = <Req, Res>(
    channel: string,
    handler: (req: Req, event: Electron.IpcMainInvokeEvent) => Promise<Res> | Res
  ): void => {
    ipcMain.handle(channel, (event, req: Req) => handler(req, event))
  }

  handle<void, PlatformInfo>(IpcChannels.platformInfo, () => ({
    platform: hostPlatform(),
    isWindows: process.platform === 'win32'
  }))

  handle<void, { projects: Project[]; sessions: Session[] }>(IpcChannels.workspaceList, () =>
    loadWorkspace()
  )
  handle<NewProject, Project>(IpcChannels.projectsCreate, (input) => createProject(input))
  handle<UpdateProjectRequest, Project | null>(IpcChannels.projectsUpdate, (req) =>
    updateProject(req)
  )
  handle<string, void>(IpcChannels.projectsRemove, async (id) => {
    // Removing a project must not leave any child shell running.
    const workspace = await loadWorkspace()
    for (const session of workspace.sessions) {
      if (session.projectId === id) {
        ptyManager.dispose(session.id)
        opencodeManager.dispose(session.id)
      }
    }
    await removeProject(id)
  })

  handle<NewSession, Session>(IpcChannels.sessionsCreate, (input) => createSession(input))
  handle<UpdateSessionRequest, Session | null>(IpcChannels.sessionsUpdate, (req) =>
    updateSession(req)
  )
  handle<MoveSessionRequest, Session | null>(IpcChannels.sessionsMove, (req) => moveSession(req))
  handle<string, void>(IpcChannels.sessionsRemove, async (id) => {
    ptyManager.dispose(id)
    opencodeManager.dispose(id)
    await removeSession(id)
  })

  handle<SendOpenCodeMessageRequest, SendOpenCodeMessageResponse>(
    IpcChannels.opencodeSend,
    async (req) => {
      const session = await getSession(req.sessionId)
      if (!session) throw new Error('Session no longer exists.')
      return { messages: await opencodeManager.send(session, req.text) }
    }
  )

  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyEnsure, async (req) => {
    const session = await getSession(req.sessionId)
    if (!session) return 'none'
    return ptyManager.ensure(session, req.size)
  })
  handle<EnsurePtyRequest, PtyStatus>(IpcChannels.ptyRestart, async (req) => {
    const session = await getSession(req.sessionId)
    if (!session) return 'none'
    return ptyManager.restart(session, req.size)
  })
  handle<WritePtyRequest, void>(IpcChannels.ptyWrite, (req) => {
    ptyManager.write(req.sessionId, req.data)
  })
  handle<ResizePtyRequest, void>(IpcChannels.ptyResize, (req) => {
    ptyManager.resize(req.sessionId, req.size)
  })
  handle<string, void>(IpcChannels.ptyDispose, (sessionId) => {
    ptyManager.dispose(sessionId)
  })
  handle<void, Record<string, PtyStatus>>(IpcChannels.ptyStatuses, () => ptyManager.statuses())

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
}
