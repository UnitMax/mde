import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import {
  listOpenCodeSessions,
  metadataQueryLaunch,
  openCodeApiArguments,
  parseMetadataOutput,
  parseOpenCodeSession,
  readOpenCodeSession
} from '../src/main/opencode/sessions'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

import * as hostExecutables from '../src/main/windows-executable'

const wslExecutable = { file: 'D:\\Windows\\System32\\wsl.exe', cwd: 'D:\\Windows\\System32' }
beforeEach(() => {
  vi.spyOn(hostExecutables, 'resolveWslExecutable').mockReturnValue(wslExecutable)
})

const session: Session = {
  id: 'workspace-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/home/me/current', createdAt: '2026-01-01T00:00:00Z'
}

const info = {
  id: 'ses_example', projectID: 'project-1', title: 'Fix tests', location: { directory: '/home/me/other' },
  time: { created: 100, updated: 200, archived: 250 }, parentID: 'ses_parent',
  model: { id: 'model-1', providerID: 'provider-1', variant: 'high' }, agent: 'build',
  cost: 0.12, tokens: { input: 1000, output: 200, reasoning: 10, cache: { read: 500, write: 0 } }
}

function page(items: unknown[], next: string | null = null): unknown {
  return { data: items, cursor: { previous: null, next } }
}

afterEach(() => {
  execFile.mockReset()
  vi.restoreAllMocks()
})

describe('OpenCode global session metadata', () => {
  it('follows the cursor across pages, covering every directory, child and archived session', async () => {
    const sessions = Array.from({ length: 125 }, (_, index) => ({
      ...info, id: `ses_${index}`, location: { directory: `/workspace/project-${index % 5}` }
    }))
    const query = vi.fn()
      .mockResolvedValueOnce(page(sessions.slice(0, 120), 'next-page'))
      .mockResolvedValueOnce(page(sessions.slice(120), 'tail-cursor'))
    const result = await listOpenCodeSessions(session, 'custom-opencode', query)
    expect(result).toHaveLength(125)
    expect(new Set(result.map((item) => item.directory)).size).toBe(5)
    expect(result[0]).toMatchObject({ parentId: 'ses_parent', archivedAt: 250 })
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0]).toEqual([session, 'custom-opencode', { operation: 'session.list', params: { limit: '120' } }])
    expect(query.mock.calls[1]?.[2]).toEqual({ operation: 'session.list', params: { limit: '120', cursor: 'next-page' } })
  })

  it('stops on a missing cursor, an empty page, or a repeated cursor and orders newest first', async () => {
    const full = Array.from({ length: 120 }, (_, index) => ({ ...info, id: `ses_${index}` }))
    const older = { ...info, id: 'ses_older', time: { created: 1, updated: 2 } }
    const newer = { ...info, id: 'ses_newer', time: { created: 1, updated: 900 } }
    expect(await listOpenCodeSessions(session, 'opencode', vi.fn().mockResolvedValue(page([older, newer])))).toMatchObject([
      { id: 'ses_newer' }, { id: 'ses_older' }
    ])
    const noCursor = vi.fn().mockResolvedValue({ data: full, cursor: {} })
    expect(await listOpenCodeSessions(session, 'opencode', noCursor)).toHaveLength(120)
    expect(noCursor).toHaveBeenCalledTimes(1)
    const repeating = vi.fn().mockResolvedValue(page(full, 'same'))
    expect(await listOpenCodeSessions(session, 'opencode', repeating)).toHaveLength(120)
    expect(repeating).toHaveBeenCalledTimes(2)
  })

  it('bounds the number of pages it will walk', async () => {
    let call = 0
    const endless = vi.fn(async () => page(
      Array.from({ length: 120 }, (_, index) => ({ ...info, id: `ses_${call}_${index}` })), `cursor-${call++}`
    ))
    expect(await listOpenCodeSessions(session, 'opencode', endless)).toHaveLength(12_000)
    expect(endless).toHaveBeenCalledTimes(100)
  })

  it('normalizes model and usage without exposing other fields', () => {
    const result = parseOpenCodeSession({ ...info, permissions: ['private'], metadata: { private: true }, revert: 'private' })
    expect(result).toMatchObject({
      id: 'ses_example', title: 'Fix tests', directory: '/home/me/other', createdAt: 100, updatedAt: 200,
      model: { id: 'model-1', providerId: 'provider-1', variant: 'high' },
      tokens: { input: 1000, output: 200, reasoning: 10, cacheRead: 500, cacheWrite: 0 },
      cost: 0.12
    })
    for (const hidden of ['permissions', 'metadata', 'revert', 'projectID']) expect(result).not.toHaveProperty(hidden)
    expect(parseOpenCodeSession({ ...info, model: 'invalid', cost: NaN, tokens: null })).not.toHaveProperty('model')
    expect(parseOpenCodeSession({ ...info, title: undefined })).toMatchObject({ title: 'Untitled session' })
    expect(parseOpenCodeSession({ ...info, title: '   ' })).toMatchObject({ title: 'Untitled session' })
    expect(parseOpenCodeSession({ ...info, time: { created: 1, updated: 2 } })).toMatchObject({ archivedAt: undefined })
    expect(() => parseOpenCodeSession({ ...info, time: { created: 'invalid', updated: 2 } })).toThrow('invalid session metadata')
    expect(() => parseOpenCodeSession({ ...info, location: {} })).toThrow('invalid session metadata')
    expect(() => parseOpenCodeSession({ ...info, id: 'not-a-session' })).toThrow('Invalid OpenCode session ID')
  })

  it('rejects malformed pages and cursors', async () => {
    await expect(listOpenCodeSessions(session, 'opencode', vi.fn().mockResolvedValue([]))).rejects.toThrow('invalid session metadata')
    await expect(listOpenCodeSessions(session, 'opencode', vi.fn().mockResolvedValue({ cursor: {} }))).rejects.toThrow('invalid session metadata')
    await expect(listOpenCodeSessions(session, 'opencode', vi.fn().mockResolvedValue(page([], 'bad cursor;'))))
      .rejects.toThrow('invalid session metadata')
  })

  it('looks up the selected ID again and refuses malformed IDs and executables', async () => {
    const query = vi.fn().mockResolvedValue({ data: info })
    expect(await readOpenCodeSession(session, 'opencode', info.id, query)).toMatchObject({ directory: info.location.directory })
    expect(query.mock.calls[0]?.[2]).toEqual({ operation: 'session.get', params: { sessionID: 'ses_example' } })
    await expect(readOpenCodeSession(session, 'opencode', 'ses_deleted', vi.fn().mockResolvedValue({})))
      .rejects.toThrow('no longer exists')
    const unused = vi.fn()
    await expect(readOpenCodeSession(session, 'opencode', "ses_x' OR 1=1 --", unused)).rejects.toThrow('Invalid OpenCode session ID')
    await expect(readOpenCodeSession(session, 'opencode', 'ses_x\nnext', unused)).rejects.toThrow('Invalid OpenCode session ID')
    await expect(listOpenCodeSessions(session, 'opencode\nunsafe', unused)).rejects.toThrow('Invalid OpenCode executable')
    expect(unused).not.toHaveBeenCalled()
  })
})

describe('OpenCode query transport', () => {
  function frame(args: string[], payload: unknown): string {
    const marker = args.indexOf('mde-opencode-query')
    return `banner\n${args[marker + 2]}\n${JSON.stringify(payload)}\n${args[marker + 3]}`
  }

  it('does not run the CLI or create output files when trusted host resolution fails', async () => {
    vi.mocked(hostExecutables.resolveWslExecutable).mockImplementation(() => { throw new Error('Windows WSL executable is unavailable') })
    await expect(listOpenCodeSessions(session, 'opencode')).rejects.toThrow('Windows WSL executable is unavailable')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('passes the executable and API request as literal arguments through the configured login shell', () => {
    const executable = "/home/me/agent's tools/opencode;literal"
    const request = { operation: 'session.get', params: { sessionID: 'ses_example' } } as const
    const { spec, begin, end } = metadataQueryLaunch({ ...session, shell: '/bin/fish' }, executable, request, 'test', wslExecutable)
    expect(spec.file).toBe(wslExecutable.file)
    expect(spec.cwd).toBe(wslExecutable.cwd)
    expect(spec.args.slice(0, 5)).toEqual(['-d', 'Ubuntu-24.04', '--cd', '/', '-e'])
    expect(spec.args).toContain('/bin/sh')
    expect(spec.args).toContain('/bin/fish')
    expect(spec.args.slice(spec.args.indexOf('mde-opencode-query') + 1)).toEqual([
      executable, begin, end, 'session.get', '--param', 'sessionID=ses_example'
    ])
    const script = spec.args[spec.args.indexOf('mde-opencode-query') - 1]
    expect(script).toContain('"$mde_executable" api "$@" > "$mde_query_output"')
    expect(script).not.toContain('db')
  })

  it('allows only known operations and parameters with well-formed values', () => {
    expect(openCodeApiArguments({ operation: 'session.list', params: { limit: '120', cursor: 'eyJhbmNob3IiOnt9fQ==' } }))
      .toEqual(['session.list', '--param', 'limit=120', '--param', 'cursor=eyJhbmNob3IiOnt9fQ=='])
    const bad = [
      { operation: 'session.delete', params: {} },
      { operation: 'session.list', params: { directory: '/tmp' } },
      { operation: 'session.list', params: { limit: '12; rm -rf /' } },
      { operation: 'session.list', params: { limit: '120', cursor: 'a b' } },
      { operation: 'session.list', params: { limit: '120', cursor: 'a\nb' } },
      { operation: 'session.get', params: { sessionID: 'ses_x\n' } },
      { operation: 'session.get', params: { sessionID: '--data' } }
    ]
    for (const request of bad) expect(() => openCodeApiArguments(request as never)).toThrow()
  })

  it('extracts framed JSON despite login banners and rejects missing frames or invalid JSON', () => {
    expect(parseMetadataOutput('login banner\nBEGIN\n{"data":[]}\nEND\nlogout', 'BEGIN', 'END')).toEqual({ data: [] })
    expect(() => parseMetadataOutput('[]', 'BEGIN', 'END')).toThrow('API output')
    expect(() => parseMetadataOutput('BEGIN not json END', 'BEGIN', 'END')).toThrow('invalid session metadata')
    expect(() => parseMetadataOutput('BEGIN HTTP 404 END', 'BEGIN', 'END')).toThrow('OpenCode 2 or newer')
  })

  it('handles framed output with the normal executable and bounded execution options', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      expect(file).toBe(wslExecutable.file)
      expect(options.cwd).toBe(wslExecutable.cwd)
      expect(options).toMatchObject({ timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true })
      callback(null, Buffer.from(frame(args, page([info]))), Buffer.alloc(0))
    })
    expect(await listOpenCodeSessions(session, 'opencode')).toHaveLength(1)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('decodes UTF-16 output from WSL versions that ignore WSL_UTF8', async () => {
    execFile.mockImplementation((_file, args, _options, callback) => {
      callback(null, Buffer.from(frame(args, page([info])), 'utf16le'), Buffer.alloc(0))
    })
    expect(await listOpenCodeSessions(session, 'opencode')).toHaveLength(1)
  })

  it.each([
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '', 'output size limit'],
    [{ killed: true }, '', 'timed out'],
    [{ code: 1 }, 'error: unknown command "api"', 'OpenCode 2 or newer'],
    [{ code: 1 }, 'Error: Operation not found: session.list', 'OpenCode 2 or newer'],
    [{ code: 1 }, 'private diagnostic', 'Check the configured executable']
  ])('maps transport failure %j to a safe message', async (error, stderr, message) => {
    execFile.mockImplementation((_file, _args, _options, callback) => callback(error, Buffer.alloc(0), Buffer.from(stderr)))
    await expect(listOpenCodeSessions(session, 'opencode')).rejects.toThrow(message)
  })

  it('reports a deleted session when the API says it is not found', async () => {
    execFile.mockImplementation((_file, args, _options, callback) => callback(
      { code: 1 }, Buffer.from(frame(args, { _tag: 'SessionNotFoundError', sessionID: 'ses_example' })), Buffer.from('HTTP 404 Not Found')
    ))
    await expect(readOpenCodeSession(session, 'opencode', 'ses_example')).rejects.toThrow('no longer exists')
  })

  it('treats a CLI that ignores the API command as an unsupported version', async () => {
    execFile.mockImplementation((_file, args, _options, callback) => {
      const marker = args.indexOf('mde-opencode-query')
      callback(null, Buffer.from(`${args[marker + 2]}\nUsage: opencode [project]\n${args[marker + 3]}`), Buffer.alloc(0))
    })
    await expect(listOpenCodeSessions(session, 'opencode')).rejects.toThrow('OpenCode 2 or newer')
  })
})
