import { describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { listBackgroundTasks, parseBackgroundJobs } from '../src/main/opencode/service/background'
import { OpenCodeServiceError, SERVICE_OPERATIONS, serviceUrl, type ServiceOperation, type ServiceRequest } from '../src/main/opencode/service/client'
import { assertIpcPayload } from '../src/main/ipc-validation'
import { IpcChannels } from '../src/shared/ipc'

const thread = { id: 'ses_parent', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' } } as InboxThread
const shell = { id: 'job_server', sessionID: thread.id, kind: 'shell', status: 'running', title: 'Web server', command: 'python3 server.py', shellID: 'sh_server', time: { started: 1000 } }
function client(responses: Partial<Record<ServiceOperation, unknown>> = {}) {
  return { request: vi.fn(async (_target: unknown, operation: ServiceOperation, _request?: ServiceRequest) => {
    const response = responses[operation]
    if (response instanceof Error) throw response
    return response
  }) }
}

describe('OpenCode background tasks', () => {
  it('lists only running jobs, keeps subagent and unknown task kinds, and deduplicates IDs', () => {
    const jobs = parseBackgroundJobs({ data: [
      shell, shell,
      { ...shell, id: 'job_done', status: 'completed' },
      { id: 'job_child', sessionID: 'ses_child', kind: 'subagent', status: 'running', description: 'Review code' },
      { id: 'job_image', sessionID: thread.id, kind: 'image', status: 'running' },
      { id: 'job_future', sessionID: thread.id, kind: 'future', status: 'running', title: 'Future job' },
    ] })
    expect(jobs).toEqual(expect.arrayContaining([
      { id: shell.id, title: shell.title, command: shell.command, kind: 'shell', startedAt: 1000 },
      { id: 'job_child', kind: 'subagent', title: 'Review code' },
      { id: 'job_image', kind: 'image', title: 'Image generation' },
      { id: 'job_future', kind: 'other', title: 'Future job' },
    ]))
    expect(jobs).toHaveLength(4)
  })

  it('rejects malformed answers rather than reporting zero tasks', () => {
    for (const value of [null, {}, { data: null }, { data: [null] }, { data: [{ ...shell, id: '' }] }, { data: [{ ...shell, sessionID: '../other' }] }]) {
      expect(() => parseBackgroundJobs(value)).toThrow('does not understand')
    }
  })

  it('asks for the thread and its descendants on the correct service and returns only UI fields', async () => {
    const api = client({ 'job.list': { data: [shell] } })
    const state = await listBackgroundTasks(api, thread)
    expect(api.request).toHaveBeenCalledWith(thread.target, 'job.list', { query: { sessionID: thread.id, status: 'running', descendants: 'true' } })
    expect(state.supported).toBe(true)
    expect(state.tasks[0]).not.toHaveProperty('shellId')
    expect(state.tasks[0]).not.toHaveProperty('sessionId')
  })

  it('distinguishes unsupported APIs from connection, authorization and shape failures', async () => {
    for (const status of [404, 405, 501]) {
      expect(await listBackgroundTasks(client({ 'job.list': new OpenCodeServiceError('Unavailable', status) }), thread)).toEqual({ supported: false, tasks: [] })
    }
    for (const error of [new Error('Offline'), new OpenCodeServiceError('Unauthorized', 401), new OpenCodeServiceError('Gone', 404, 'SessionNotFoundError')]) {
      await expect(listBackgroundTasks(client({ 'job.list': error }), thread)).rejects.toBe(error)
    }
    await expect(listBackgroundTasks(client({ 'job.list': {} }), thread)).rejects.toThrow('does not understand')
  })

  it('exposes only read access for background tasks', () => {
    expect(Object.values(IpcChannels)).not.toContain('chat:background-stop')
    expect(SERVICE_OPERATIONS).not.toHaveProperty('shell.remove')
    expect(SERVICE_OPERATIONS).not.toHaveProperty('shell.get')
    for (const bad of [null, {}, { threadId: '../other' }, { threadId: 'ses_one', taskId: 'job_one' }]) {
      expect(() => assertIpcPayload(IpcChannels.chatBackground, bad)).toThrow()
    }
    expect(serviceUrl('http://localhost:1234', 'job.list', { query: { sessionID: thread.id, status: 'running', descendants: 'true' } })).toContain('/api/experimental/job?sessionID=ses_parent&status=running&descendants=true')
  })
})
