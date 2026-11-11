import { posix } from 'node:path'
import {
  MDE_MCP_MAX_DEPTH,
  MDE_MCP_SPAWNS_PER_MINUTE,
  type MdeMcpRequest,
  type MdeMcpResponse,
} from '@shared/mde-mcp'
import { PROMPT_CONTROL_CHARACTERS, PROMPT_TEXT_LIMIT } from '@shared/prompt-text'
import type {
  ChatCreateRequest,
  InboxComposerState,
  InboxFolder,
  InboxThread,
  OpenCodeModelRef,
  OpenCodeTarget,
} from '@shared/types'
import { worktreeBranchProblem } from '@shared/worktree-branch'
import { serviceTargetKey } from '../opencode/service/discovery'
import { parseWslUncPath } from '../wsl/paths'

/**
 * What the MDE MCP's tools do inside MDE. Every request has already passed the listener's token check; what it
 * asks for is checked here as strictly as the same request from MDE's own window, and then goes through the
 * same Inbox code: a thread an agent starts is an ordinary Inbox thread.
 */

export interface McpThreadOptions {
  /** The thread whose agent asked; absent when the caller is not an Inbox thread. */
  parentId?: string
}

export interface MdeMcpHost {
  /** False where the Inbox is not offered (Linux), or before it is ready. */
  available(): boolean
  /** Whether threads for this OpenCode can be started here: WSL on Windows, native on macOS. */
  targetAllowed(target: OpenCodeTarget): boolean
  thread(id: string): InboxThread | undefined
  folders(): InboxFolder[]
  composer(): InboxComposerState
  /**
   * Resolves and checks a directory on the target (a Windows path is translated into WSL), then adds it as a
   * project, or returns the project it already is. The person's chosen project is left as it was.
   */
  addFolder(target: OpenCodeTarget, directory: string): Promise<InboxFolder>
  currentBranch(folder: InboxFolder): Promise<string | null>
  create(request: ChatCreateRequest, options: McpThreadOptions): Promise<InboxThread>
  now(): number
}

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/
const CREATE_KEYS = new Set(['prompt', 'directory', 'agent', 'model', 'mode', 'worktree'])

class ToolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolError(`\`${key}\` must be a string.`)
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max || CONTROLS.test(trimmed)) throw new ToolError(`\`${key}\` is not valid.`)
  return trimmed
}

/** `provider/model`; the model part may itself hold slashes (`openrouter/anthropic/claude-sonnet-4`). */
export function parseModelArgument(value: string): OpenCodeModelRef {
  const slash = value.indexOf('/')
  const providerId = slash > 0 ? value.slice(0, slash) : ''
  const id = slash > 0 ? value.slice(slash + 1) : ''
  if (!providerId || !id || providerId.length > 512 || id.length > 512) {
    throw new ToolError('`model` must be "provider/model", for example "anthropic/claude-sonnet-4".')
  }
  return { providerId, id }
}

/** A directory the caller named, in the target's own format: a Linux path in WSL, a POSIX path on macOS. */
function directoryArgument(target: OpenCodeTarget, value: string): string {
  if (target.kind === 'wsl') {
    const unc = parseWslUncPath(value)
    if (unc) {
      if (unc.distro.toLowerCase() !== target.distro.toLowerCase()) throw new ToolError(`\`directory\` is in another WSL distro than ${target.distro}.`)
      return unc.path
    }
    // A Windows path (C:\…) is translated by the host, as when a folder is picked in MDE.
    if (/^[A-Za-z]:[\\/]/.test(value)) return value
  }
  if (!value.startsWith('/')) throw new ToolError('`directory` must be an absolute path.')
  if (value.includes('\\') || value.split('/').some((part) => part === '.' || part === '..')) {
    throw new ToolError('`directory` must be a plain absolute path, without `.` or `..`.')
  }
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

/**
 * The bridge's working directory as a directory in the target, or null. OpenCode starts the bridge in the
 * project's directory; a Windows MDE started from inside WSL sees it as a `\\wsl.localhost\…` path.
 */
export function callerDirectory(target: OpenCodeTarget, cwd: string): string | null {
  if (target.kind === 'wsl') {
    const unc = parseWslUncPath(cwd)
    return unc && unc.distro.toLowerCase() === target.distro.toLowerCase() ? unc.path : null
  }
  return posix.isAbsolute(cwd) ? cwd : null
}

export class MdeMcpTools {
  private spawns: number[] = []

  constructor(private readonly host: MdeMcpHost) {}

  async handle(request: MdeMcpRequest): Promise<MdeMcpResponse> {
    if (!this.host.available()) return { ok: false, error: 'The MDE Inbox is not available on this computer, so MDE cannot start threads.' }
    if (!this.host.targetAllowed(request.target)) return { ok: false, error: 'This MDE does not run threads in that OpenCode.' }
    try {
      if (request.tool === 'list_projects') return this.listProjects(request)
      if (request.tool === 'create_thread') return await this.createThread(request)
      return { ok: false, error: `Unknown tool: ${request.tool}` }
    } catch (error) {
      if (error instanceof ToolError) return { ok: false, error: error.message }
      throw error
    }
  }

  private listProjects(request: MdeMcpRequest): MdeMcpResponse {
    const key = serviceTargetKey(request.target)
    const projects = this.host.folders()
      .filter((folder) => serviceTargetKey(folder.target) === key)
      .map((folder) => ({
        name: folder.name,
        directory: folder.directory,
        ...(folder.worktree ? { worktree: { branch: folder.worktree.branch, base: folder.worktree.base } } : {}),
      }))
    return { ok: true, text: JSON.stringify({ projects }, null, 2), data: { projects } }
  }

  /** The calling thread, when it is an Inbox thread of the same OpenCode. */
  private parent(request: MdeMcpRequest): InboxThread | undefined {
    if (!request.sessionId) return undefined
    const thread = this.host.thread(request.sessionId)
    return thread && serviceTargetKey(thread.target) === serviceTargetKey(request.target) ? thread : undefined
  }

  /** How many agent-started threads lead up to `thread`: 0 for one a person started. */
  private depth(thread: InboxThread | undefined): number {
    let depth = 0
    const seen = new Set<string>()
    let current = thread
    while (current?.spawnedBy && !seen.has(current.id)) {
      seen.add(current.id)
      depth += 1
      const parentId = current.spawnedBy.threadId
      current = parentId ? this.host.thread(parentId) : undefined
    }
    return depth
  }

  private async folderFor(target: OpenCodeTarget, directory: string, preferredId: string | undefined): Promise<InboxFolder> {
    const key = serviceTargetKey(target)
    const matches = this.host.folders().filter((folder) => serviceTargetKey(folder.target) === key && folder.directory === directory)
    const match = matches.find((folder) => folder.id === preferredId) ?? matches[0]
    return match ?? this.host.addFolder(target, directory)
  }

  private async createThread(request: MdeMcpRequest): Promise<MdeMcpResponse> {
    const args = request.arguments
    const unknown = Object.keys(args).find((key) => !CREATE_KEYS.has(key))
    if (unknown) throw new ToolError(`Unknown argument \`${unknown}\`.`)
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new ToolError('`prompt` must say what the new thread should do.')
    if (args.prompt.length > PROMPT_TEXT_LIMIT) throw new ToolError(`\`prompt\` is longer than ${PROMPT_TEXT_LIMIT} characters.`)
    if (PROMPT_CONTROL_CHARACTERS.test(args.prompt)) throw new ToolError('`prompt` holds control characters.')
    const prompt = args.prompt
    const directoryText = optionalText(args, 'directory', 4096)
    const agentText = optionalText(args, 'agent', 128)
    const modelText = optionalText(args, 'model', 1025)
    const mode = args.mode === undefined || args.mode === null ? 'gui' : args.mode
    if (mode !== 'gui' && mode !== 'terminal') throw new ToolError('`mode` must be "gui" or "terminal".')
    if (args.worktree !== undefined && args.worktree !== null && !isRecord(args.worktree)) throw new ToolError('`worktree` must be an object.')
    const worktreeArgs = isRecord(args.worktree) ? args.worktree : undefined
    const branch = worktreeArgs ? optionalText(worktreeArgs, 'branch', 100) : undefined
    if (branch) {
      const problem = worktreeBranchProblem(branch)
      if (problem) throw new ToolError(`\`worktree.branch\`: ${problem}`)
    }
    const baseText = worktreeArgs ? optionalText(worktreeArgs, 'base', 256) : undefined
    if (agentText && !AGENT_ID.test(agentText)) throw new ToolError('`agent` is not an agent name.')

    const parent = this.parent(request)
    if (this.depth(parent) + 1 > MDE_MCP_MAX_DEPTH) {
      throw new ToolError(`Threads started by agents may only go ${MDE_MCP_MAX_DEPTH} levels deep, and this one is already at the limit.`)
    }
    const now = this.host.now()
    this.spawns = this.spawns.filter((at) => now - at < 60_000)
    if (this.spawns.length >= MDE_MCP_SPAWNS_PER_MINUTE) {
      throw new ToolError(`Agents may start at most ${MDE_MCP_SPAWNS_PER_MINUTE} threads a minute. Wait a moment and try again.`)
    }

    const target = request.target
    const directory = directoryText
      ? directoryArgument(target, directoryText)
      : parent?.directory ?? callerDirectory(target, request.cwd)
    if (!directory) throw new ToolError('MDE cannot tell which directory this thread works in. Pass `directory`.')
    const folder = await this.folderFor(target, directory, parent?.folderId)

    const composer = this.host.composer()
    const model = modelText ? parseModelArgument(modelText) : parent?.model ?? composer.model
    if (!model) throw new ToolError('MDE does not know which model to use. Pass `model` as "provider/model".')
    const agent = agentText ?? composer.agent ?? 'build'
    let worktree: ChatCreateRequest['worktree']
    if (worktreeArgs) {
      if (folder.worktree) throw new ToolError(`${folder.name} is already a Git worktree. Start the thread in it without \`worktree\`, or name the repository's own directory.`)
      const base = baseText ?? await this.host.currentBranch(folder)
      if (!base) throw new ToolError('The directory has no current branch to start the worktree from. Pass `worktree.base`.')
      worktree = { base, ...(branch ? { branch } : {}) }
    }

    // Counted before the work starts, so calls arriving together cannot all slip under the limit.
    this.spawns.push(now)
    const thread = await this.host.create(
      { folderId: folder.id, text: prompt, agent, model, mode, ...(worktree ? { worktree } : {}) },
      parent ? { parentId: parent.id } : {},
    )
    const data = {
      threadId: thread.id,
      title: thread.customTitle ?? thread.title,
      project: folder.name,
      directory: thread.directory,
      ...(thread.worktree ? { worktree: { branch: thread.worktree.branch, base: thread.worktree.base } } : {}),
    }
    if (thread.sendError) {
      return { ok: false, error: `MDE started thread ${thread.id} in ${thread.directory}, but could not send it the prompt. Its prompt is kept as a draft in MDE.` }
    }
    return {
      ok: true,
      text: `Started thread ${thread.id} in ${thread.directory}${thread.worktree ? ` (new worktree on branch ${thread.worktree.branch})` : ''}. It works on its own; the person follows it in MDE.\n${JSON.stringify(data, null, 2)}`,
      data,
    }
  }
}
