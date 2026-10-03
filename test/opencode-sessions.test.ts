import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import {
  listOpenCodeSessions,
  metadataQueryLaunch,
  parseMetadataOutput,
  parseOpenCodeSession,
  readOpenCodeSession
} from '../src/main/opencode/sessions'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

const session: Session = {
  id: 'workspace-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/home/me/current', createdAt: '2026-01-01T00:00:00Z'
}

const row = {
  id: 'ses_example', title: 'Fix tests', directory: '/home/me/other',
  time_created: 100, time_updated: 200, parent_id: 'ses_parent', time_archived: 250,
  model: JSON.stringify({ id: 'model-1', providerID: 'provider-1', variant: 'high' }),
  agent: 'build', summary_files: 2, summary_additions: 10, summary_deletions: 3,
  cost: 0.12, tokens_input: 1000, tokens_output: 200, tokens_reasoning: 10,
  tokens_cache_read: 500, tokens_cache_write: 0
}
const schema = Object.keys(row).map((name) => ({ name }))

afterEach(() => execFile.mockReset())

describe('OpenCode global session metadata', () => {
  it('reads every directory and more than 100 sessions, including archived and child sessions', async () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...row, id: `ses_${index}`, directory: `/workspace/project-${index % 5}`
    }))
    const query = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce(rows)
    const sessions = await listOpenCodeSessions(session, 'custom-opencode', query)
    expect(sessions).toHaveLength(125)
    expect(new Set(sessions.map((item) => item.directory)).size).toBe(5)
    expect(sessions[0]).toMatchObject({ parentId: 'ses_parent', archivedAt: 250 })
    expect(query.mock.calls[1]?.[2]).not.toMatch(/WHERE|LIMIT|project_id|message|permission/i)
    expect(query.mock.calls[1]?.[2]).toContain('ORDER BY time_updated DESC, id DESC')
    expect(query.mock.calls[0]?.slice(0, 2)).toEqual([session, 'custom-opencode'])
  })

  it('selects only available metadata columns and supports databases without optional fields', async () => {
    const required = { id: 'ses_old', title: '', directory: '/workspace/old', time_created: 0, time_updated: 0 }
    const query = vi.fn().mockResolvedValueOnce(Object.keys(required).map((name) => ({ name })))
      .mockResolvedValueOnce([required])
    expect(await listOpenCodeSessions(session, 'opencode', query)).toEqual([
      { id: 'ses_old', title: 'Untitled session', directory: '/workspace/old', createdAt: 0, updatedAt: 0 }
    ])
    expect(query.mock.calls[1]?.[2]).toBe('SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC, id DESC')
  })

  it('normalizes model, changes, and usage without exposing other database fields', () => {
    const result = parseOpenCodeSession({ ...row, permission: 'private', metadata: 'private', summary_diffs: 'private' })
    expect(result).toMatchObject({
      model: { id: 'model-1', providerId: 'provider-1', variant: 'high' },
      changes: { files: 2, additions: 10, deletions: 3 },
      tokens: { input: 1000, output: 200, reasoning: 10, cacheRead: 500, cacheWrite: 0 },
      cost: 0.12
    })
    expect(result).not.toHaveProperty('permission')
    expect(result).not.toHaveProperty('metadata')
    expect(result).not.toHaveProperty('summary_diffs')
    expect(parseOpenCodeSession({ ...row, model: 'invalid', cost: NaN })).not.toHaveProperty('model')
    expect(() => parseOpenCodeSession({ ...row, time_created: 'invalid' })).toThrow('invalid session metadata')
  })

  it('fails clearly on unsupported schemas and deleted sessions', async () => {
    await expect(listOpenCodeSessions(session, 'opencode', vi.fn().mockResolvedValue([])))
      .rejects.toThrow('database format is unsupported')
    const query = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce([])
    await expect(readOpenCodeSession(session, 'opencode', 'ses_deleted', query)).rejects.toThrow('no longer exists')
  })

  it('looks up the selected ID again and refuses SQL or control-character injection', async () => {
    const query = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce([row])
    expect(await readOpenCodeSession(session, 'opencode', row.id, query)).toMatchObject({ directory: row.directory })
    expect(query.mock.calls[1]?.[2]).toContain("WHERE id = 'ses_example'")
    const unused = vi.fn()
    await expect(readOpenCodeSession(session, 'opencode', "ses_x' OR 1=1 --", unused)).rejects.toThrow('Invalid OpenCode session ID')
    await expect(listOpenCodeSessions(session, 'opencode\nunsafe', unused)).rejects.toThrow('Invalid OpenCode executable')
    expect(unused).not.toHaveBeenCalled()
  })
})

describe('OpenCode query transport', () => {
  it('preserves executable and query as literal arguments through the configured login shell', () => {
    const executable = "/home/me/agent's tools/opencode;literal"
    const query = 'SELECT title FROM session'
    const { spec, begin, end } = metadataQueryLaunch({ ...session, shell: '/bin/fish' }, executable, query, 'test')
    expect(spec.file).toBe('wsl.exe')
    expect(spec.args.slice(0, 5)).toEqual(['-d', 'Ubuntu-24.04', '--cd', '/', '-e'])
    expect(spec.args).toContain('/bin/sh')
    expect(spec.args).toContain('/bin/fish')
    expect(spec.args.slice(-4)).toEqual([executable, query, begin, end])
    expect(spec.args.at(-6)).toContain('"$1" db "$2" --format json > "$mde_query_output"')
  })

  it('extracts framed JSON despite login banners and rejects missing frames or invalid JSON', () => {
    expect(parseMetadataOutput('login banner\nBEGIN\n[]\nEND\nlogout', 'BEGIN', 'END')).toEqual([])
    expect(() => parseMetadataOutput('[]', 'BEGIN', 'END')).toThrow('database output')
    expect(() => parseMetadataOutput('BEGIN not json END', 'BEGIN', 'END')).toThrow('invalid session metadata')
    expect(() => parseMetadataOutput('BEGIN {} END', 'BEGIN', 'END')).toThrow('invalid session metadata')
  })

  it('handles framed output with the normal executable and bounded execution options', async () => {
    execFile.mockImplementation((_file, args, options, callback) => {
      expect(options).toMatchObject({ timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })
      const data = execFile.mock.calls.length === 1 ? schema : [row]
      callback(null, Buffer.from(`banner\n${args.at(-2)}\n${JSON.stringify(data)}\n${args.at(-1)}`), Buffer.alloc(0))
    })
    expect(await listOpenCodeSessions(session, 'opencode')).toHaveLength(1)
  })

  it('decodes UTF-16 output from WSL versions that ignore WSL_UTF8', async () => {
    execFile.mockImplementation((_file, args, _options, callback) => {
      const data = execFile.mock.calls.length === 1 ? schema : [row]
      callback(null, Buffer.from(`${args.at(-2)}\n${JSON.stringify(data)}\n${args.at(-1)}`, 'utf16le'), Buffer.alloc(0))
    })
    expect(await listOpenCodeSessions(session, 'opencode')).toHaveLength(1)
  })

  it.each([
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '', 'output size limit'],
    [{ killed: true }, '', 'timed out'],
    [{ code: 1 }, 'no such table: session', 'unsupported'],
    [{ code: 1 }, 'private diagnostic', 'Check the configured executable']
  ])('maps transport failure %j to a safe message', async (error, stderr, message) => {
    execFile.mockImplementation((_file, _args, _options, callback) => callback(error, Buffer.alloc(0), Buffer.from(stderr)))
    await expect(listOpenCodeSessions(session, 'opencode')).rejects.toThrow(message)
  })
})
