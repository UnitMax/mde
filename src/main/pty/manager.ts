import { homedir } from 'node:os'
import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Project, PtyDataChunk, PtyExitInfo, PtySize, PtyStatus } from '@shared/types'
import { buildLaunchSpec, type LaunchContext } from './launch'

interface Session {
  pty: IPty
  status: PtyStatus
  disposeListeners: () => void
}

export interface PtyEvents {
  onData(chunk: PtyDataChunk): void
  onExit(info: PtyExitInfo): void
}

function clampSize(size: PtySize): PtySize {
  return {
    cols: Math.max(1, Math.floor(size.cols) || 80),
    rows: Math.max(1, Math.floor(size.rows) || 24)
  }
}

function launchContext(): LaunchContext {
  const context: LaunchContext = { platform: process.platform }
  if (process.env.SHELL) context.defaultShell = process.env.SHELL
  return context
}

function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // Electron sets these for its own child processes; a user shell must not inherit them.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

/**
 * Owns every node-pty instance, keyed by project id. One PTY per project,
 * created lazily and kept alive until the project is removed or the app quits —
 * switching projects in the sidebar must never reach this class.
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly events: PtyEvents) {}

  status(projectId: string): PtyStatus {
    return this.sessions.get(projectId)?.status ?? 'none'
  }

  statuses(): Record<string, PtyStatus> {
    const out: Record<string, PtyStatus> = {}
    for (const [id, session] of this.sessions) out[id] = session.status
    return out
  }

  /** Creates the PTY if there is not already a live one. Idempotent. */
  ensure(project: Project, size: PtySize): PtyStatus {
    const existing = this.sessions.get(project.id)
    if (existing && existing.status === 'running') return 'running'
    if (existing) this.dispose(project.id)

    const spec = buildLaunchSpec(project, launchContext())
    const { cols, rows } = clampSize(size)

    const child = nodePty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd ?? homedir(),
      env: ptyEnv(),
      useConpty: process.platform === 'win32'
    })

    // Forward output the moment it arrives. Buffering into lines would stall
    // TUI redraws, which depend on partial writes landing promptly.
    const dataListener = child.onData((data) => {
      this.events.onData({ projectId: project.id, data })
    })
    const exitListener = child.onExit(({ exitCode, signal }) => {
      const session = this.sessions.get(project.id)
      if (session) session.status = 'exited'
      const info: PtyExitInfo = { projectId: project.id, exitCode }
      if (signal !== undefined) info.signal = signal
      this.events.onExit(info)
    })

    this.sessions.set(project.id, {
      pty: child,
      status: 'running',
      disposeListeners: () => {
        dataListener.dispose()
        exitListener.dispose()
      }
    })

    return 'running'
  }

  restart(project: Project, size: PtySize): PtyStatus {
    this.dispose(project.id)
    return this.ensure(project, size)
  }

  write(projectId: string, data: string): void {
    const session = this.sessions.get(projectId)
    if (!session || session.status !== 'running') return
    session.pty.write(data)
  }

  resize(projectId: string, size: PtySize): void {
    const session = this.sessions.get(projectId)
    if (!session || session.status !== 'running') return
    const { cols, rows } = clampSize(size)
    try {
      session.pty.resize(cols, rows)
    } catch (error) {
      // Racing a process that exited between the check and the call.
      console.warn(`[pty] resize failed for ${projectId}:`, error)
    }
  }

  dispose(projectId: string): void {
    const session = this.sessions.get(projectId)
    if (!session) return
    this.sessions.delete(projectId)
    session.disposeListeners()
    if (session.status === 'running') {
      try {
        session.pty.kill()
      } catch (error) {
        console.warn(`[pty] kill failed for ${projectId}:`, error)
      }
    }
  }

  disposeAll(): void {
    for (const projectId of [...this.sessions.keys()]) this.dispose(projectId)
  }
}
