import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  MDE_MCP_ALLOW_COMMANDS_MS,
  type AgentTerminalClaim,
  type AgentTerminalDecision,
  type AgentTerminalOpenRequest,
  type AgentTerminalRefusal,
  type MdeMcpTerminalCommands,
  type MdeMcpTerminalSettings,
  type MdeMcpTerminalSettingsUpdate,
} from '@shared/mde-mcp'
import type { TerminalPalette } from '@shared/ipc'
import type { OpenCodeTarget } from '@shared/types'
import { writeTextAtomic } from '../store/atomic-json'

/**
 * Inbox terminal panes that agents open through the MDE MCP (`open_terminal`). The window decides where the pane
 * goes and answers with its terminal ID; main starts that pane's shell itself, in the background, in the
 * directory it checked, so the shell runs even while no view shows it (the floating terminal hidden with F11).
 * A command is typed into the shell by main from its own copy, never from the window; whether it runs at once
 * or waits for the person's approval is the person's setting.
 */

/** How long the window has to add the pane before the agent is told it could not. */
export const AGENT_TERMINAL_CLAIM_TIMEOUT_MS = 20_000
/** Requests the window has not answered yet; more are refused, so a looping agent cannot pile them up. */
export const AGENT_TERMINAL_PENDING_LIMIT = 4

export interface AgentTerminalHost {
  /** Asks the window for a pane; false when there is no window to ask. */
  send(request: AgentTerminalOpenRequest): boolean
  /**
   * Starts the claimed pane's shell in the directory, in the background. Throws with a reason the agent reads
   * when the pane is not a new Inbox terminal pane or the directory is not where the Inbox terminal runs.
   */
  start(terminalId: string, target: OpenCodeTarget, directory: string, palette: TerminalPalette): Promise<void>
  /** Types a line into the shell and presses Enter. */
  run(terminalId: string, command: string): void
  now(): number
}

export interface AgentTerminalOpening {
  target: OpenCodeTarget
  directory: string
  title: string
  command: string | null
  /** The title of the thread whose agent asked. */
  from: string | null
}

export type AgentTerminalOutcome = { terminalId: string; command: 'none' | 'running' | 'waiting' }

interface Pending {
  opening: AgentTerminalOpening
  approval: boolean
  resolve: (outcome: AgentTerminalOutcome) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const SETTINGS_FILE = 'mde-mcp.json'

function isCommands(value: unknown): value is MdeMcpTerminalCommands {
  return value === 'ask' || value === 'run'
}

export class AgentTerminals {
  private host: AgentTerminalHost | null = null
  private readonly pending = new Map<string, Pending>()
  /** Commands waiting for approval, by terminal ID. */
  private readonly approvals = new Map<string, string>()
  private commands: MdeMcpTerminalCommands = 'ask'
  private allowedUntil: number | null = null
  private loaded: Promise<void> | null = null

  constructor(private readonly userData: string) {}

  /** Wired by the IPC layer, which owns the PTYs and the window. Until then terminals cannot be opened. */
  attach(host: AgentTerminalHost): void {
    this.host = host
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(join(this.userData, SETTINGS_FILE), 'utf8')) as unknown
        const commands = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).terminalCommands : undefined
        if (isCommands(commands)) this.commands = commands
      } catch {
        // No file yet, or an unreadable one: commands wait for approval.
      }
    })()
    return this.loaded
  }

  private allowance(now: number): number | null {
    if (this.allowedUntil !== null && this.allowedUntil <= now) this.allowedUntil = null
    return this.allowedUntil
  }

  async settings(): Promise<MdeMcpTerminalSettings> {
    await this.load()
    return { commands: this.commands, allowedUntil: this.allowance(this.host?.now() ?? Date.now()) }
  }

  async setSettings(update: MdeMcpTerminalSettingsUpdate): Promise<MdeMcpTerminalSettings> {
    await this.load()
    if (!isCommands(update.commands)) throw new Error('Invalid setting.')
    if (update.allowedUntil === null) this.allowedUntil = null
    if (update.commands !== this.commands) {
      this.commands = update.commands
      await writeTextAtomic(join(this.userData, SETTINGS_FILE), `${JSON.stringify({ terminalCommands: this.commands }, null, 2)}\n`)
    }
    return this.settings()
  }

  /** Asks the window for the pane and waits until its shell has started (or why it could not). */
  async open(opening: AgentTerminalOpening): Promise<AgentTerminalOutcome> {
    await this.load()
    const host = this.host
    if (!host) throw new Error('MDE is still starting. Try again in a moment.')
    if (this.pending.size >= AGENT_TERMINAL_PENDING_LIMIT) throw new Error('MDE is still opening other terminals. Try again in a moment.')
    const approval = opening.command !== null && this.commands === 'ask' && this.allowance(host.now()) === null
    const requestId = randomUUID()
    return new Promise<AgentTerminalOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error('MDE’s window did not open the terminal. Is MDE showing a dialog, or still loading?'))
      }, AGENT_TERMINAL_CLAIM_TIMEOUT_MS)
      this.pending.set(requestId, { opening, approval, resolve, reject, timer })
      const sent = host.send({ requestId, title: opening.title, command: opening.command, approval, from: opening.from })
      if (!sent) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('MDE has no window open to show the terminal in.'))
      }
    })
  }

  private take(requestId: string): Pending | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) return undefined
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    return pending
  }

  /** The window added the pane: start its shell, and type the command or keep it for approval. */
  async claim(claim: AgentTerminalClaim): Promise<void> {
    const pending = this.take(claim.requestId)
    const host = this.host
    if (!pending || !host) throw new Error('That terminal request is no longer waiting.')
    const { opening, approval } = pending
    try {
      await host.start(claim.terminalId, opening.target, opening.directory, claim.palette)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      pending.reject(failure)
      throw failure
    }
    let command: AgentTerminalOutcome['command'] = 'none'
    if (opening.command !== null) {
      // The setting may have changed while the window was adding the pane: a stricter one still applies.
      if (approval || (this.commands === 'ask' && this.allowance(host.now()) === null)) {
        this.approvals.set(claim.terminalId, opening.command)
        command = 'waiting'
      } else {
        host.run(claim.terminalId, opening.command)
        command = 'running'
      }
    }
    pending.resolve({ terminalId: claim.terminalId, command })
  }

  /** The window could not add the pane. */
  refuse(refusal: AgentTerminalRefusal): void {
    this.take(refusal.requestId)?.reject(new Error(refusal.reason))
  }

  /** The person answered a command's approval bar. Only a command main is keeping can run. */
  decide(decision: AgentTerminalDecision): void {
    const command = this.approvals.get(decision.terminalId)
    if (command === undefined) return
    this.approvals.delete(decision.terminalId)
    if (decision.decision === 'cancel' || !this.host) return
    if (decision.decision === 'run-for-hour') this.allowedUntil = this.host.now() + MDE_MCP_ALLOW_COMMANDS_MS
    this.host.run(decision.terminalId, command)
  }

  /** A pane closed, or its shell went: a command still waiting for it is dropped. */
  forget(terminalId: string): void {
    this.approvals.delete(terminalId)
  }

  /** Every waiting command, when the Inbox terminal's shells are replaced (another WSL distro). */
  forgetAll(): void {
    this.approvals.clear()
  }

  waiting(terminalId: string): string | undefined {
    return this.approvals.get(terminalId)
  }
}
