import { homedir } from 'node:os'
import { nativeLoginShell } from '../native-environment'
import * as nodePty from 'node-pty'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import type { TerminalPalette } from '@shared/ipc'
import type {
  AgentCommand,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtySize,
  PtyStatus,
  Session
} from '@shared/types'
import { buildLaunchSpec, type LaunchContext } from './launch'
import { TerminalQueryResponder } from './terminal-queries'
import { HeldQueryAnswerer } from './held-queries'
import type { TerminalDirectoryStore } from './directories'
import { resolveWindowsShell, resolveWslExecutable } from '../windows-executable'

interface PtySession {
  pty: IPty
  sourceSessionId: string
  status: PtyStatus
  currentDirectory: string | null
  disposeListeners: () => void
  queryResponder: TerminalQueryResponder
  /** Output kept while no view shows the terminal yet (a shell started in the background); null once shown. */
  held: string[] | null
  heldLength: number
  /** Answers the shell's terminal queries while its output is kept, so none is answered late. */
  heldQueries: HeldQueryAnswerer | null
  /** Whether the shell has written anything yet; input waiting for that is in `pendingInput`. */
  started: boolean
  pendingInput: string[]
  pendingInputTimer?: NodeJS.Timeout
}

/** How much output a terminal started in the background keeps until it is shown; older output is dropped. */
export const HELD_OUTPUT_LIMIT = 2 * 1024 * 1024
/** How long typed-ahead input waits for a silent shell before it is written anyway. */
const START_INPUT_FALLBACK_MS = 3000

export interface PtyEvents {
  onData(chunk: PtyDataChunk): void
  onDirectory(update: PtyDirectoryUpdate): void
  onExit(info: PtyExitInfo): void
}

export interface PtyTerminalInfo {
  sessionId: string
  directory: string | null
}

export interface PtyLaunchOptions {
  /** Main-owned values passed in the child environment, never as command-line arguments. */
  environment?: Record<string, string>
  directory?: string
  agent?: AgentCommand
  /**
   * Started before any view shows it: its output is kept (up to `HELD_OUTPUT_LIMIT`) and sent on when a view
   * first attaches, which is the renderer's next `ensure` for it.
   */
  background?: boolean
}

function clampSize(size: PtySize): PtySize {
  return {
    cols: Math.max(1, Math.floor(size.cols) || 80),
    rows: Math.max(1, Math.floor(size.rows) || 24)
  }
}

function launchContext(session: Session): LaunchContext {
  const context: LaunchContext = { platform: process.platform }
  if (process.platform === 'win32') {
    context.windowsExecutable = session.kind === 'wsl'
      ? resolveWslExecutable()
      : { file: resolveWindowsShell(session.shell) }
  }
  if (process.platform === 'darwin') context.defaultShell = nativeLoginShell()
  else if (process.env.SHELL) context.defaultShell = process.env.SHELL
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

function spawnPty(
  file: string,
  args: string[],
  options: IWindowsPtyForkOptions,
  platform: NodeJS.Platform,
): IPty {
  if (platform !== 'win32') return nodePty.spawn(file, args, options)

  // The bundled backend passes terminal-owned queries through to MDE. The
  // inbox ConPTY consumes OSC 10/11 without replying on affected systems.
  // Do not retry with the inbox backend: a damaged or unavailable bundled
  // component must leave the terminal unavailable rather than changing its
  // security and behavior profile at runtime.
  return nodePty.spawn(file, args, {
    ...options,
    useConpty: true,
    useConptyDll: true,
  })
}

/**
 * Owns every node-pty instance, keyed by runtime terminal id. Multiple PTYs
 * may be launched from one persisted workspace session when the terminal view
 * is split.
 */
export class PtyManager {
  private readonly sessions = new Map<string, PtySession>()

  constructor(
    private readonly events: PtyEvents,
    private readonly directoryStore?: TerminalDirectoryStore,
  ) {}

  /** Sets the folder a terminal that has not started yet opens in, through the same record a restart reads. */
  rememberDirectory(terminalId: string, session: Session, directory: string): void {
    this.directoryStore?.remember(terminalId, session, directory)
  }

  savedDirectory(terminalId: string, session: Session): string | undefined {
    return this.directoryStore?.get(terminalId, session)
  }

  status(terminalId: string): PtyStatus {
    return this.sessions.get(terminalId)?.status ?? 'none'
  }

  statuses(): Record<string, PtyStatus> {
    const out: Record<string, PtyStatus> = {}
    for (const [id, session] of this.sessions) out[id] = session.status
    return out
  }

  directories(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, session] of this.sessions) {
      if (session.currentDirectory) out[id] = session.currentDirectory
    }
    return out
  }

  terminalInfo(terminalId: string): PtyTerminalInfo | null {
    const session = this.sessions.get(terminalId)
    if (!session) return null
    return { sessionId: session.sourceSessionId, directory: session.currentDirectory }
  }

  /**
   * Creates the PTY on first view of a terminal. Reattaching synchronizes the
   * existing PTY to the renderer's measured size but deliberately never
   * respawns it: an exited shell stays exited until the user asks for a restart.
   */
  ensure(
    terminalId: string,
    session: Session,
    size: PtySize,
    palette: TerminalPalette,
    options?: PtyLaunchOptions,
  ): PtyStatus {
    const existing = this.sessions.get(terminalId)
    if (existing) {
      existing.queryResponder.setPalette(palette)
      this.resize(terminalId, size)
      this.release(terminalId, existing)
      return existing.status
    }

    const context = launchContext(session)
    const forwardedKeys = Object.keys(options?.environment ?? {})
    if (forwardedKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error('Invalid terminal environment variable.')
    const processEnvironment = ptyEnv(options?.environment)
    if (session.kind === 'wsl' && options?.environment) {
      // WSLENV forwards these from Windows into WSL without putting their values in wsl.exe argv.
      const inherited = (processEnvironment.WSLENV ?? '').split(':').filter((entry) => entry && !forwardedKeys.includes(entry.split('/')[0]!))
      processEnvironment.WSLENV = [...inherited, ...forwardedKeys.map((key) => `${key}/u`)].join(':')
    }
    const spec = buildLaunchSpec(session, {
      ...context,
      workingDirectory: options?.directory,
      agent: options?.agent
    })
    const { cols, rows } = clampSize(size)

    const child = spawnPty(spec.file, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd ?? homedir(),
      env: processEnvironment,
    }, process.platform)

    const queryResponder = new TerminalQueryResponder(palette)
    // Native homes and explicit launch directories are known before the first
    // prompt. WSL's default home is learned from OSC 7, which tracks later changes.
    let currentDirectory: string | null = options?.directory ?? (session.kind === 'native' ? homedir() : null)
    // Answer palette probes beside the PTY so latency-sensitive TUIs do not
    // have to wait for a main -> renderer -> main IPC round trip.
    const dataListener = child.onData((data) => {
      const result = queryResponder.process(data)
      for (const response of result.responses) child.write(response)
      if (result.directory && result.directory !== currentDirectory) {
        currentDirectory = result.directory
        const current = this.sessions.get(terminalId)
        if (current) current.currentDirectory = currentDirectory
        this.directoryStore?.remember(terminalId, session, currentDirectory)
        this.events.onDirectory({ terminalId, directory: currentDirectory })
      }
      const current = this.sessions.get(terminalId)
      if (current?.held) {
        if (result.data) {
          const kept = current.heldQueries ? current.heldQueries.process(result.data) : { data: result.data, responses: [] }
          for (const response of kept.responses) child.write(response)
          if (kept.data) {
            current.held.push(kept.data)
            current.heldLength += kept.data.length
            while (current.heldLength > HELD_OUTPUT_LIMIT && current.held.length > 1) current.heldLength -= current.held.shift()!.length
          }
        }
      } else if (result.data) {
        this.events.onData({ terminalId, data: result.data })
      }
      // Typed-ahead input goes after any answer to a query, which the shell may be waiting to read first.
      if (current && !current.started) this.markStarted(current)
    })
    const exitListener = child.onExit(({ exitCode, signal }) => {
      const pending = queryResponder.flush()
      if (pending) this.events.onData({ terminalId, data: pending })
      const current = this.sessions.get(terminalId)
      if (current) current.status = 'exited'
      const info: PtyExitInfo = { sessionId: session.id, terminalId, exitCode }
      if (signal !== undefined) info.signal = signal
      this.events.onExit(info)
    })

    this.sessions.set(terminalId, {
      pty: child,
      sourceSessionId: session.id,
      status: 'running',
      currentDirectory,
      queryResponder,
      held: options?.background ? [] : null,
      heldLength: 0,
      heldQueries: options?.background ? new HeldQueryAnswerer() : null,
      started: false,
      pendingInput: [],
      disposeListeners: () => {
        dataListener.dispose()
        exitListener.dispose()
      }
    })
    if (currentDirectory) {
      this.directoryStore?.remember(terminalId, session, currentDirectory)
      this.events.onDirectory({ terminalId, directory: currentDirectory })
    }

    return 'running'
  }

  restart(
    terminalId: string,
    session: Session,
    size: PtySize,
    palette: TerminalPalette,
    options?: PtyLaunchOptions,
  ): PtyStatus {
    this.dispose(terminalId, false)
    return this.ensure(terminalId, session, size, palette, options)
  }

  /** Sends a background terminal's kept output to the view that now shows it, and stops keeping it. */
  private release(terminalId: string, session: PtySession): void {
    const held = session.held
    if (!held) return
    const rest = session.heldQueries?.flush()
    if (rest) held.push(rest)
    session.held = null
    session.heldLength = 0
    session.heldQueries = null
    if (held.length) this.events.onData({ terminalId, data: held.join('') })
  }

  private markStarted(session: PtySession): void {
    session.started = true
    clearTimeout(session.pendingInputTimer)
    session.pendingInputTimer = undefined
    const input = session.pendingInput.splice(0)
    if (session.status === 'running') for (const data of input) session.pty.write(data)
  }

  /**
   * Types input into a shell once it has started: at once if it has written anything, otherwise on its first
   * output, or after a few seconds of silence. The terminal driver keeps what is typed ahead until the shell
   * reads it, so this only avoids writing into a process that is still being created.
   */
  writeWhenStarted(terminalId: string, data: string): boolean {
    const session = this.sessions.get(terminalId)
    if (!session || session.status !== 'running') return false
    if (session.started) {
      session.pty.write(data)
      return true
    }
    session.pendingInput.push(data)
    session.pendingInputTimer ??= setTimeout(() => {
      const current = this.sessions.get(terminalId)
      if (current === session && !session.started) this.markStarted(session)
    }, START_INPUT_FALLBACK_MS)
    return true
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

  dispose(terminalId: string, forgetDirectory = true): void {
    if (forgetDirectory) this.directoryStore?.forget(terminalId)
    const session = this.sessions.get(terminalId)
    if (!session) return
    this.sessions.delete(terminalId)
    clearTimeout(session.pendingInputTimer)
    this.events.onDirectory({ terminalId, directory: null })
    session.disposeListeners()
    if (session.status === 'running') {
      try {
        session.pty.kill()
      } catch (error) {
        console.warn(`[pty] kill failed for ${terminalId}:`, error)
      }
    }
  }

  /** Disposes every runtime terminal launched from one persisted session. */
  disposeForSourceSession(sessionId: string): void {
    this.directoryStore?.forgetSession(sessionId)
    for (const [terminalId, session] of this.sessions) {
      if (session.sourceSessionId === sessionId) this.dispose(terminalId)
    }
  }

  disposeAll(): void {
    for (const terminalId of [...this.sessions.keys()]) this.dispose(terminalId, false)
  }
}
