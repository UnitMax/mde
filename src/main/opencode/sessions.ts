import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import type { OpenCodeSessionSummary, Session } from '@shared/types'
import { buildLaunchSpec, type LaunchSpec } from '../pty/launch'
import { decodeWslOutput, wslEnv } from '../wsl/distros'
import { resolveWslExecutable, type HostExecutable } from '../windows-executable'
import { nativeLoginShell } from '../native-environment'

const UNSUPPORTED = 'Session history requires OpenCode 2 or newer.'
const SESSION_GONE = 'This OpenCode session no longer exists. Refresh the session list.'
const MAX_QUERY_BYTES = 32 * 1024 * 1024
/** A cold background service has to start before it can answer. */
const QUERY_TIMEOUT_MS = 30_000
/** OpenCode never returns more than this many sessions per page. */
const SESSION_PAGE_SIZE = 120
const MAX_SESSION_PAGES = 100
const API_OPERATIONS = ['session.list', 'session.get'] as const
const API_PARAMETERS = ['limit', 'cursor', 'sessionID'] as const
const OPAQUE_CURSOR = /^[A-Za-z0-9_=.-]{1,2048}$/

export interface OpenCodeApiRequest {
  operation: (typeof API_OPERATIONS)[number]
  params: Partial<Record<(typeof API_PARAMETERS)[number], string>>
}

export type OpenCodeApiQuery = (
  session: Session,
  executable: string,
  request: OpenCodeApiRequest
) => Promise<unknown>

export function validateOpenCodeExecutable(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error('Invalid OpenCode executable.')
  }
}

export function validateOpenCodeSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^ses_[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid OpenCode session ID.')
  }
}

export function parseMetadataOutput(stdout: string, begin: string, end: string): unknown {
  const start = stdout.indexOf(begin)
  const finish = stdout.indexOf(end, start + begin.length)
  if (start < 0 || finish < 0) throw new Error('Could not read OpenCode API output.')
  try {
    return JSON.parse(stdout.slice(start + begin.length, finish).trim())
  } catch {
    throw new Error(`OpenCode returned invalid session metadata. ${UNSUPPORTED}`)
  }
}

/** Only fixed operations and parameters reach the CLI, each as its own literal argument. */
export function openCodeApiArguments(request: OpenCodeApiRequest): string[] {
  if (!API_OPERATIONS.includes(request.operation)) throw new Error('Unsupported OpenCode API operation.')
  const args: string[] = [request.operation]
  for (const [name, value] of Object.entries(request.params)) {
    if (!(API_PARAMETERS as readonly string[]).includes(name) || typeof value !== 'string') {
      throw new Error('Unsupported OpenCode API parameter.')
    }
    if (name === 'sessionID') validateOpenCodeSessionId(value)
    else if (name === 'limit' ? !/^\d{1,4}$/.test(value) : !OPAQUE_CURSOR.test(value)) {
      throw new Error('Invalid OpenCode API parameter.')
    }
    args.push('--param', `${name}=${value}`)
  }
  return args
}

/** A fixed script frames only the CLI output, after the user's login shell has loaded. */
export function metadataQueryLaunch(
  session: Session,
  executable: string,
  request: OpenCodeApiRequest,
  marker: string,
  hostExecutable?: HostExecutable,
): {
  spec: LaunchSpec
  begin: string
  end: string
} {
  validateOpenCodeExecutable(executable)
  const apiArguments = openCodeApiArguments(request)
  const native = session.kind === 'native'
  if (!native && !session.distro) throw new Error('Session history requires a configured WSL distro.')
  const begin = `__MDE_OPENCODE_BEGIN_${marker}__`
  const end = `__MDE_OPENCODE_END_${marker}__`
  const script = [
    // OpenCode versions that exit before stdout drains truncate large JSON
    // responses when stdout is a pipe. Writing to a regular file avoids that.
    'umask 077',
    'mde_query_output=$(mktemp "${TMPDIR:-/tmp}/mde-opencode-query.XXXXXX") || exit 1',
    'trap \'rm -f -- "$mde_query_output"\' 0',
    "trap 'exit 129' HUP",
    "trap 'exit 130' INT",
    "trap 'exit 143' TERM",
    'mde_executable=$1',
    'mde_begin=$2',
    'mde_end=$3',
    'shift 3',
    '"$mde_executable" api "$@" > "$mde_query_output"',
    'mde_query_status=$?',
    'printf "\\n%s\\n" "$mde_begin"',
    'cat -- "$mde_query_output" || exit 1',
    'printf "\\n%s\\n" "$mde_end"',
    'exit "$mde_query_status"',
  ].join('\n')
  const spec = buildLaunchSpec(session, {
    platform: native ? 'darwin' : 'win32',
    windowsExecutable: hostExecutable,
    defaultShell: native ? nativeLoginShell() : undefined,
    workingDirectory: '/',
    agent: {
      executable: '/bin/sh',
      args: ['-c', script, 'mde-opencode-query', executable, begin, end, ...apiArguments]
    },
  })
  return { spec, begin, end }
}

const runApiQuery: OpenCodeApiQuery = (session, executable, request) => {
  const native = session.kind === 'native'
  const { spec, begin, end } = metadataQueryLaunch(session, executable, request, randomUUID(), native ? undefined : resolveWslExecutable('win32'))
  return new Promise((resolve, reject) => {
    execFile(spec.file, spec.args, {
      env: native ? process.env : wslEnv(),
      cwd: spec.cwd,
      encoding: 'buffer',
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: MAX_QUERY_BYTES,
      windowsHide: true,
    }, (error, rawStdout, rawStderr) => {
      const stdout = native ? rawStdout.toString('utf8') : decodeWslOutput(rawStdout)
      const stderr = native ? rawStderr.toString('utf8') : decodeWslOutput(rawStderr)
      if (error) {
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new Error('OpenCode session history exceeded the output size limit.'))
        } else if (error.killed) {
          reject(new Error('Reading OpenCode session history timed out.'))
        } else if (request.operation === 'session.get' && /SessionNotFoundError/.test(stdout)) {
          reject(new Error(SESSION_GONE))
        } else if (/unknown (command|argument)|operation not found/i.test(stderr + stdout)) {
          reject(new Error(UNSUPPORTED))
        } else {
          reject(new Error('Could not read OpenCode session history. Check the configured executable and login environment.'))
        }
        return
      }
      try {
        resolve(parseMetadataOutput(stdout, begin, end))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OpenCode returned invalid session metadata.')
  }
  return value as Record<string, unknown>
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Maps an OpenCode 2 `Session.Info`, keeping only metadata and ignoring everything else. */
export function parseOpenCodeSession(value: unknown): OpenCodeSessionSummary {
  const info = record(value)
  validateOpenCodeSessionId(info.id)
  const time = record(info.time)
  const directory = record(info.location).directory
  const createdAt = number(time.created)
  const updatedAt = number(time.updated)
  if (typeof directory !== 'string' || createdAt === undefined || updatedAt === undefined) {
    throw new Error('OpenCode returned invalid session metadata.')
  }
  const result: OpenCodeSessionSummary = {
    id: info.id,
    title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Untitled session',
    directory,
    createdAt,
    updatedAt,
    parentId: text(info.parentID),
    archivedAt: number(time.archived),
    agent: text(info.agent),
    cost: number(info.cost),
  }
  const model = optionalRecord(info.model)
  if (model && typeof model.id === 'string' && typeof model.providerID === 'string') {
    result.model = { id: model.id, providerId: model.providerID, variant: text(model.variant) }
  }
  const usage = optionalRecord(info.tokens)
  if (usage) {
    const cache = optionalRecord(usage.cache)
    const tokens = {
      input: number(usage.input),
      output: number(usage.output),
      reasoning: number(usage.reasoning),
      cacheRead: number(cache?.read),
      cacheWrite: number(cache?.write),
    }
    if (Object.values(tokens).some((value) => value !== undefined)) result.tokens = tokens
  }
  return result
}

function pageCursor(value: unknown): string | undefined {
  const next = optionalRecord(value)?.next
  if (next === undefined || next === null) return undefined
  if (typeof next !== 'string' || !OPAQUE_CURSOR.test(next)) throw new Error('OpenCode returned invalid session metadata.')
  return next
}

export async function listOpenCodeSessions(
  session: Session,
  executable: string,
  query: OpenCodeApiQuery = runApiQuery
): Promise<OpenCodeSessionSummary[]> {
  validateOpenCodeExecutable(executable)
  const sessions = new Map<string, OpenCodeSessionSummary>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const response = record(await query(session, executable, {
      operation: 'session.list',
      params: { limit: String(SESSION_PAGE_SIZE), ...(cursor ? { cursor } : {}) },
    }))
    if (!Array.isArray(response.data)) throw new Error('OpenCode returned invalid session metadata.')
    for (const item of response.data) {
      const parsed = parseOpenCodeSession(item)
      sessions.set(parsed.id, parsed)
    }
    const next = pageCursor(response.cursor)
    // A full page may still be the last one, so an empty or short page also ends the walk.
    if (response.data.length < SESSION_PAGE_SIZE || !next || next === cursor) break
    cursor = next
  }
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
}

export async function readOpenCodeSession(
  session: Session,
  executable: string,
  id: string,
  query: OpenCodeApiQuery = runApiQuery
): Promise<OpenCodeSessionSummary> {
  validateOpenCodeSessionId(id)
  validateOpenCodeExecutable(executable)
  const response = record(await query(session, executable, { operation: 'session.get', params: { sessionID: id } }))
  if (!response.data) throw new Error(SESSION_GONE)
  return parseOpenCodeSession(response.data)
}
