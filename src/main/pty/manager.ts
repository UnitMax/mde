import { homedir } from 'node:os'
import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Session, PtyDataChunk, PtyExitInfo, PtySize, PtyStatus } from '@shared/types'
import { buildLaunchSpec, type LaunchContext } from './launch'

interface PtySession {
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
 * Owns every node-pty instance, keyed by session id. One PTY per session,
 * created lazily and kept alive until the session is removed or the app quits —
 * switching sessions in the sidebar must never reach this class.
 */
export class PtyManager {
  private readonly sessions = new Map<string, PtySession>()

  constructor(private readonly events: PtyEvents) {}

  status(sessionId: string): PtyStatus {
    return this.sessions.get(sessionId)?.status ?? 'none'
  }

  statuses(): Record<string, PtyStatus> {
    const out: Record<string, PtyStatus> = {}
    for (const [id, session] of this.sessions) out[id] = session.status
    return out
  }

  /**
   * Creates the PTY on first view of a session. Idempotent, and deliberately
   * never respawns: an exited shell stays exited until the user asks for a
   * restart, so switching back to the session does not silently revive it.
   */
  ensure(session: Session, size: PtySize): PtyStatus {
    const existing = this.sessions.get(session.id)
    if (existing) return existing.status

    const spec = buildLaunchSpec(session, launchContext())
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
      this.events.onData({ sessionId: session.id, data })
    })
    const exitListener = child.onExit(({ exitCode, signal }) => {
      const current = this.sessions.get(session.id)
      if (current) current.status = 'exited'
      const info: PtyExitInfo = { sessionId: session.id, exitCode }
      if (signal !== undefined) info.signal = signal
      this.events.onExit(info)
    })

    this.sessions.set(session.id, {
      pty: child,
      status: 'running',
      disposeListeners: () => {
        dataListener.dispose()
        exitListener.dispose()
      }
    })

    return 'running'
  }

  restart(session: Session, size: PtySize): PtyStatus {
    this.dispose(session.id)
    return this.ensure(session, size)
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'running') return
    session.pty.write(data)
  }

  resize(sessionId: string, size: PtySize): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'running') return
    const { cols, rows } = clampSize(size)
    try {
      session.pty.resize(cols, rows)
    } catch (error) {
      // Racing a process that exited between the check and the call.
      console.warn(`[pty] resize failed for ${sessionId}:`, error)
    }
  }

  dispose(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.disposeListeners()
    if (session.status === 'running') {
      try {
        session.pty.kill()
      } catch (error) {
        console.warn(`[pty] kill failed for ${sessionId}:`, error)
      }
    }
  }

  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.dispose(sessionId)
  }
}
