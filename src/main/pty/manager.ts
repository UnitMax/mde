import { homedir } from 'node:os'
import * as nodePty from 'node-pty'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import type { TerminalPalette } from '@shared/ipc'
import type { Session, PtyDataChunk, PtyExitInfo, PtySize, PtyStatus } from '@shared/types'
import { buildLaunchSpec, type LaunchContext } from './launch'
import { TerminalQueryResponder } from './terminal-queries'

interface PtySession {
  pty: IPty
  sourceSessionId: string
  status: PtyStatus
  disposeListeners: () => void
  queryResponder: TerminalQueryResponder
}

export interface PtyEvents {
  onData(chunk: PtyDataChunk): void
  onExit(info: PtyExitInfo): void
}

export interface PtyLaunchIntegration {
  prepare(terminalId: string, session: Session): Record<string, string> | undefined
  dispose(terminalId: string): void
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

function ptyEnv(additional?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // Electron sets these for its own child processes; a user shell must not inherit them.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  Object.assign(env, additional)
  return env
}

function isBundledConptyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    'conpty.dll',
    'Cannot launch conpty',
    'Failed to load conpty',
  ].some((fragment) => message.includes(fragment))
}

function spawnPty(
  file: string,
  args: string[],
  options: IWindowsPtyForkOptions,
  platform: NodeJS.Platform,
): IPty {
  if (platform !== 'win32') return nodePty.spawn(file, args, options)

  try {
    // The bundled backend passes terminal-owned queries through to MDE. The
    // inbox ConPTY consumes OSC 10/11 without replying on affected systems.
    return nodePty.spawn(file, args, {
      ...options,
      useConpty: true,
      useConptyDll: true,
    })
  } catch (error) {
    if (!isBundledConptyError(error)) throw error
    console.warn('[pty] bundled ConPTY unavailable; falling back to inbox ConPTY:', error)
    return nodePty.spawn(file, args, {
      ...options,
      useConpty: true,
      useConptyDll: false,
    })
  }
}

/**
 * Owns every node-pty instance, keyed by runtime terminal id. Multiple PTYs
 * may be launched from one persisted workspace session when the terminal view
 * is split.
 */
export class PtyManager {
  private readonly sessions = new Map<string, PtySession>()
  private readonly integrations: PtyLaunchIntegration[]

  constructor(
    private readonly events: PtyEvents,
    integration?: PtyLaunchIntegration | PtyLaunchIntegration[]
  ) {
    this.integrations = integration
      ? Array.isArray(integration)
        ? integration
        : [integration]
      : []
  }

  private prepareIntegrations(terminalId: string, session: Session): Record<string, string> {
    const environment: Record<string, string> = {}
    for (const integration of this.integrations) {
      Object.assign(environment, integration.prepare(terminalId, session))
    }
    return environment
  }

  private disposeIntegrations(terminalId: string): void {
    for (const integration of this.integrations) integration.dispose(terminalId)
  }

  status(terminalId: string): PtyStatus {
    return this.sessions.get(terminalId)?.status ?? 'none'
  }

  statuses(): Record<string, PtyStatus> {
    const out: Record<string, PtyStatus> = {}
    for (const [id, session] of this.sessions) out[id] = session.status
    return out
  }

  /**
   * Creates the PTY on first view of a terminal. Idempotent, and deliberately
   * never respawns: an exited shell stays exited until the user asks for a
   * restart, so switching back to the session does not silently revive it.
   */
  ensure(
    terminalId: string,
    session: Session,
    size: PtySize,
    palette: TerminalPalette,
  ): PtyStatus {
    const existing = this.sessions.get(terminalId)
    if (existing) {
      existing.queryResponder.setPalette(palette)
      return existing.status
    }

    const environment = this.prepareIntegrations(terminalId, session)
    const spec = buildLaunchSpec(session, {
      ...launchContext(),
      environment,
      wslEnvironment: environment
    })
    const { cols, rows } = clampSize(size)

    let child: IPty
    try {
      child = spawnPty(spec.file, spec.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: spec.cwd ?? homedir(),
        env: ptyEnv(environment),
      }, process.platform)
    } catch (error) {
      this.disposeIntegrations(terminalId)
      throw error
    }

    const queryResponder = new TerminalQueryResponder(palette)
    // Answer palette probes beside the PTY so latency-sensitive TUIs do not
    // have to wait for a main -> renderer -> main IPC round trip.
    const dataListener = child.onData((data) => {
      const result = queryResponder.process(data)
      for (const response of result.responses) child.write(response)
      if (result.data) this.events.onData({ terminalId, data: result.data })
    })
    const exitListener = child.onExit(({ exitCode, signal }) => {
      const pending = queryResponder.flush()
      if (pending) this.events.onData({ terminalId, data: pending })
      const current = this.sessions.get(terminalId)
      if (current) current.status = 'exited'
      this.disposeIntegrations(terminalId)
      const info: PtyExitInfo = { sessionId: session.id, terminalId, exitCode }
      if (signal !== undefined) info.signal = signal
      this.events.onExit(info)
    })

    this.sessions.set(terminalId, {
      pty: child,
      sourceSessionId: session.id,
      status: 'running',
      queryResponder,
      disposeListeners: () => {
        dataListener.dispose()
        exitListener.dispose()
      }
    })

    return 'running'
  }

  restart(
    terminalId: string,
    session: Session,
    size: PtySize,
    palette: TerminalPalette,
  ): PtyStatus {
    this.dispose(terminalId)
    return this.ensure(terminalId, session, size, palette)
  }

  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId)
    if (!session || session.status !== 'running') return
    session.pty.write(data)
  }

  resize(terminalId: string, size: PtySize): void {
    const session = this.sessions.get(terminalId)
    if (!session || session.status !== 'running') return
    const { cols, rows } = clampSize(size)
    try {
      session.pty.resize(cols, rows)
    } catch (error) {
      // Racing a process that exited between the check and the call.
      console.warn(`[pty] resize failed for ${terminalId}:`, error)
    }
  }

  setPalette(terminalId: string, palette: TerminalPalette): void {
    this.sessions.get(terminalId)?.queryResponder.setPalette(palette)
  }

  dispose(terminalId: string): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    this.sessions.delete(terminalId)
    this.disposeIntegrations(terminalId)
    session.disposeListeners()
    if (session.status === 'running') {
      try {
        session.pty.kill()
      } catch (error) {
        console.warn(`[pty] kill failed for ${terminalId}:`, error)
      }
    }
  }

  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.dispose(sessionId)
  }
}
