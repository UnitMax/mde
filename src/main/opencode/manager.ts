import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { OpenCodeChatMessage, Session } from '@shared/types'

export const BIG_PICKLE_MODEL = { providerID: 'opencode', modelID: 'big-pickle' } as const
export const OPENCODE_INLINE_CONFIG = {
  permission: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    external_directory: 'deny'
  }
} as const
const SERVER_START_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 120_000
const MAX_DIAGNOSTIC_LENGTH = 1_000

interface OpenCodeRuntime {
  child: ChildProcessWithoutNullStreams
  url: string
  sessionId: string
}

interface OpenCodeSessionResponse {
  id: string
}

interface OpenCodePromptResponse {
  info: {
    id: string
    error?: unknown
  }
  parts: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clip(value: string): string {
  return value.length > MAX_DIAGNOSTIC_LENGTH ? `${value.slice(0, MAX_DIAGNOSTIC_LENGTH)}…` : value
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}

/** Extracts the only content this prototype renders from an OpenCode response. */
export function extractTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ''

  return parts
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.type === 'text' && part.ignored !== true && typeof part.text === 'string'
    )
    .map((part) => part.text as string)
    .join('\n')
    .trim()
}

export function describeResponseParts(parts: unknown): string {
  if (!Array.isArray(parts) || parts.length === 0) return 'none'

  const types = new Set(
    parts.map((part) => (isRecord(part) && typeof part.type === 'string' ? part.type : 'unknown'))
  )
  return [...types].join(', ')
}

export function createPromptBody(text: string): {
  model: typeof BIG_PICKLE_MODEL
  parts: Array<{ type: 'text'; text: string }>
} {
  return {
    model: BIG_PICKLE_MODEL,
    parts: [{ type: 'text', text }]
  }
}

/** The OpenCode SDK uses this same startup marker for `opencode serve`. */
export function parseServerUrl(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^opencode server listening on\s+(https?:\/\/\S+)/i)
    if (match?.[1]) return match[1]
  }
  return null
}

function terminationError(error: unknown): Error {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  if (code === 'ENOENT') {
    return new Error('OpenCode CLI was not found on PATH. Install OpenCode and restart mde.')
  }
  return new Error(`Could not start OpenCode: ${errorMessage(error)}`)
}

async function requestJson<T>(
  url: string,
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    const message = errorMessage(error)
    if (message.includes('timeout') || message.includes('aborted')) {
      throw new Error('OpenCode did not respond within two minutes.')
    }
    throw new Error(`OpenCode request failed: ${message}`)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`OpenCode request failed (${response.status}): ${clip(text)}`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('OpenCode returned an invalid response.')
  }
}

function providerError(error: unknown): string {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === 'string') {
    return error.data.message
  }
  return 'OpenCode could not generate a response. Confirm OpenCode Zen is logged in with `opencode providers login`.'
}

/**
 * Runs one local, text-only OpenCode server for each native mde session. The
 * server and OpenCode session live only for this mde process; no credentials
 * cross the Electron boundary.
 */
export class OpenCodeManager {
  private readonly runtimes = new Map<string, OpenCodeRuntime>()
  private readonly starting = new Map<string, Promise<OpenCodeRuntime>>()
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly pending = new Set<string>()

  async send(session: Session, text: string): Promise<OpenCodeChatMessage> {
    const prompt = text.trim()
    if (!prompt) throw new Error('Message cannot be empty.')
    if (session.kind !== 'native') {
      throw new Error('OpenCode GUI integration currently supports native sessions only.')
    }
    if (this.pending.has(session.id)) throw new Error('A message is already being sent for this session.')

    this.pending.add(session.id)
    try {
      const runtime = await this.ensureRuntime(session)
      const response = await requestJson<OpenCodePromptResponse>(
        runtime.url,
        `/session/${encodeURIComponent(runtime.sessionId)}/message`,
        createPromptBody(prompt),
        REQUEST_TIMEOUT_MS
      )

      if (response.info.error) throw new Error(providerError(response.info.error))
      const reply = extractTextParts(response.parts)
      if (!reply) {
        throw new Error(`OpenCode returned no visible text (response parts: ${describeResponseParts(response.parts)}).`)
      }

      return { id: response.info.id, role: 'assistant', text: reply }
    } finally {
      this.pending.delete(session.id)
    }
  }

  dispose(sessionId: string): void {
    this.runtimes.delete(sessionId)
    const child = this.children.get(sessionId)
    this.children.delete(sessionId)
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
  }

  disposeAll(): void {
    for (const sessionId of [...this.children.keys()]) this.dispose(sessionId)
  }

  private async ensureRuntime(session: Session): Promise<OpenCodeRuntime> {
    const existing = this.runtimes.get(session.id)
    if (existing) return existing

    const starting = this.starting.get(session.id)
    if (starting) return starting

    const next = this.startRuntime(session)
    this.starting.set(session.id, next)
    try {
      const runtime = await next
      this.runtimes.set(session.id, runtime)
      return runtime
    } finally {
      this.starting.delete(session.id)
    }
  }

  private async startRuntime(session: Session): Promise<OpenCodeRuntime> {
    const child = spawn(
      'opencode',
      ['serve', '--pure', '--hostname=127.0.0.1', '--port=0'],
      {
        cwd: session.path,
        env: {
          ...process.env,
          // Inline configuration has higher precedence than project config.
          // Only read-only workspace inspection tools are available in this GUI prototype.
          OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_INLINE_CONFIG)
        },
        windowsHide: true
      }
    )
    this.children.set(session.id, child)

    try {
      const url = await this.waitForServerUrl(child)
      const created = await requestJson<OpenCodeSessionResponse>(url, '/session', { title: session.name }, SERVER_START_TIMEOUT_MS)
      if (!created.id) throw new Error('OpenCode did not create a session.')

      child.once('exit', () => {
        if (this.children.get(session.id) === child) this.children.delete(session.id)
        const runtime = this.runtimes.get(session.id)
        if (runtime?.child === child) this.runtimes.delete(session.id)
      })

      return { child, url, sessionId: created.id }
    } catch (error) {
      this.dispose(session.id)
      throw error
    }
  }

  private waitForServerUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = ''
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.stdout.off('data', onOutput)
        child.stderr.off('data', onOutput)
        callback()
      }
      const onOutput = (chunk: Buffer): void => {
        output = clip(`${output}${chunk.toString()}`)
        const url = parseServerUrl(output)
        if (url) settle(() => resolve(url))
      }
      const timeout = setTimeout(() => {
        settle(() => reject(new Error(`Timed out waiting for OpenCode to start. ${clip(output)}`)))
      }, SERVER_START_TIMEOUT_MS)

      child.stdout.on('data', onOutput)
      child.stderr.on('data', onOutput)
      child.once('error', (error) => settle(() => reject(terminationError(error))))
      child.once('exit', (code) => {
        settle(() => reject(new Error(`OpenCode exited before starting (code ${code ?? 'unknown'}). ${clip(output)}`)))
      })
    })
  }
}
