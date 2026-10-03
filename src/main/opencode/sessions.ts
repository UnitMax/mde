import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import type { OpenCodeSessionSummary, Session } from '@shared/types'
import { buildLaunchSpec, type LaunchSpec } from '../pty/launch'
import { decodeWslOutput, wslEnv } from '../wsl/distros'

const REQUIRED_COLUMNS = ['id', 'title', 'directory', 'time_created', 'time_updated']
const OPTIONAL_COLUMNS = [
  'parent_id', 'time_archived', 'agent', 'model', 'summary_files',
  'summary_additions', 'summary_deletions', 'cost', 'tokens_input',
  'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write',
]
const UNSUPPORTED = 'This OpenCode database format is unsupported. Update OpenCode to use session history.'
const MAX_QUERY_BYTES = 32 * 1024 * 1024

export type OpenCodeMetadataQuery = (
  session: Session,
  executable: string,
  query: string
) => Promise<unknown[]>

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

export function parseMetadataOutput(stdout: string, begin: string, end: string): unknown[] {
  const start = stdout.indexOf(begin)
  const finish = stdout.indexOf(end, start + begin.length)
  if (start < 0 || finish < 0) throw new Error('Could not read OpenCode database output.')
  let result: unknown
  try {
    result = JSON.parse(stdout.slice(start + begin.length, finish).trim())
  } catch {
    throw new Error('OpenCode returned invalid session metadata.')
  }
  if (!Array.isArray(result)) throw new Error('OpenCode returned invalid session metadata.')
  return result
}

/** A fixed script frames only the CLI output, after the user's login shell has loaded. */
export function metadataQueryLaunch(
  session: Session,
  executable: string,
  query: string,
  marker: string
): {
  spec: LaunchSpec
  begin: string
  end: string
} {
  validateOpenCodeExecutable(executable)
  if (session.kind !== 'wsl' || !session.distro) throw new Error('Session history requires a WSL terminal.')
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
    '"$1" db "$2" --format json > "$mde_query_output"',
    'mde_query_status=$?',
    'printf "\\n%s\\n" "$3"',
    'cat -- "$mde_query_output" || exit 1',
    'printf "\\n%s\\n" "$4"',
    'exit "$mde_query_status"',
  ].join('\n')
  const spec = buildLaunchSpec(session, {
    platform: 'win32',
    workingDirectory: '/',
    agent: { executable: '/bin/sh', args: ['-c', script, 'mde-opencode-query', executable, query, begin, end] },
  })
  return { spec, begin, end }
}

const runMetadataQuery: OpenCodeMetadataQuery = (session, executable, query) => {
  const { spec, begin, end } = metadataQueryLaunch(session, executable, query, randomUUID())
  return new Promise((resolve, reject) => {
    execFile(spec.file, spec.args, {
      env: wslEnv(),
      encoding: 'buffer',
      timeout: 15_000,
      maxBuffer: MAX_QUERY_BYTES,
      windowsHide: true,
    }, (error, rawStdout, rawStderr) => {
      const stdout = decodeWslOutput(rawStdout)
      const stderr = decodeWslOutput(rawStderr)
      if (error) {
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new Error('OpenCode session history exceeded the output size limit.'))
        } else if (error.killed) {
          reject(new Error('Reading OpenCode session history timed out.'))
        } else if (/unknown (command|argument)|no such (table|column)/i.test(stderr + stdout)) {
          reject(new Error(UNSUPPORTED))
        } else {
          reject(new Error('Could not read OpenCode session history. Check the configured executable and WSL login environment.'))
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

export function parseOpenCodeSession(value: unknown): OpenCodeSessionSummary {
  const row = record(value)
  validateOpenCodeSessionId(row.id)
  const createdAt = number(row.time_created)
  const updatedAt = number(row.time_updated)
  if (typeof row.title !== 'string' || typeof row.directory !== 'string' || createdAt === undefined || updatedAt === undefined) {
    throw new Error('OpenCode returned invalid session metadata.')
  }
  const result: OpenCodeSessionSummary = {
    id: row.id,
    title: row.title.trim() || 'Untitled session',
    directory: row.directory,
    createdAt,
    updatedAt,
    parentId: text(row.parent_id),
    archivedAt: number(row.time_archived),
    agent: text(row.agent),
    cost: number(row.cost),
  }
  try {
    const model = record(typeof row.model === 'string' ? JSON.parse(row.model) : row.model)
    if (typeof model.id === 'string' && typeof model.providerID === 'string') {
      result.model = { id: model.id, providerId: model.providerID, variant: text(model.variant) }
    }
  } catch {
    // Optional model metadata differs across OpenCode versions.
  }
  const changes = {
    files: number(row.summary_files),
    additions: number(row.summary_additions),
    deletions: number(row.summary_deletions),
  }
  if (Object.values(changes).some((value) => value !== undefined)) result.changes = changes
  const tokens = {
    input: number(row.tokens_input),
    output: number(row.tokens_output),
    reasoning: number(row.tokens_reasoning),
    cacheRead: number(row.tokens_cache_read),
    cacheWrite: number(row.tokens_cache_write),
  }
  if (Object.values(tokens).some((value) => value !== undefined)) result.tokens = tokens
  return result
}

async function sessionQuery(
  session: Session,
  executable: string,
  where: string,
  query: OpenCodeMetadataQuery
): Promise<OpenCodeSessionSummary[]> {
  validateOpenCodeExecutable(executable)
  const schema = await query(session, executable, 'PRAGMA table_info("session")')
  const columns = new Set(schema.map((value) => record(value).name))
  if (!REQUIRED_COLUMNS.every((name) => columns.has(name))) throw new Error(UNSUPPORTED)
  const selected = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS.filter((name) => columns.has(name))]
  const rows = await query(session, executable,
    `SELECT ${selected.join(', ')} FROM session${where} ORDER BY time_updated DESC, id DESC`)
  return rows.map(parseOpenCodeSession)
}

export function listOpenCodeSessions(
  session: Session,
  executable: string,
  query: OpenCodeMetadataQuery = runMetadataQuery
): Promise<OpenCodeSessionSummary[]> {
  return sessionQuery(session, executable, '', query)
}

export async function readOpenCodeSession(
  session: Session,
  executable: string,
  id: string,
  query: OpenCodeMetadataQuery = runMetadataQuery
): Promise<OpenCodeSessionSummary> {
  validateOpenCodeSessionId(id)
  // ID validation excludes SQL syntax. The renderer never supplies query text.
  const rows = await sessionQuery(session, executable, ` WHERE id = '${id}'`, query)
  if (!rows[0]) throw new Error('This OpenCode session no longer exists. Refresh the session list.')
  return rows[0]
}
