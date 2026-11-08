import type { ChatBackgroundState, ChatBackgroundTask, InboxThread } from '@shared/types'
import { OpenCodeServiceError, type OpenCodeServiceClient } from './client'
import { ServiceShapeError } from './parse'

type Client = Pick<OpenCodeServiceClient, 'request'>
type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}

function label(value: unknown, limit = 512): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').trim().slice(0, limit) || undefined
}

/** Reject a changed experimental response rather than claiming that no work is running. */
export function parseBackgroundJobs(value: unknown): ChatBackgroundTask[] {
  const data = record(value)?.data
  if (!Array.isArray(data)) throw new ServiceShapeError('a background task list')
  const jobs = new Map<string, ChatBackgroundTask>()
  for (const entry of data) {
    const job = record(entry)
    if (!job || typeof job.status !== 'string') throw new ServiceShapeError('a background task')
    // Completed but unconsumed jobs can also be returned by this API.
    if (['completed', 'error', 'cancelled'].includes(job.status)) continue
    if (job.status !== 'running') throw new ServiceShapeError('a background task status')
    if (typeof job.id !== 'string' || !/^[^\u0000-\u001f\u007f-\u009f]{1,256}$/.test(job.id) ||
      typeof job.sessionID !== 'string' || !/^ses_[A-Za-z0-9_-]{1,200}$/.test(job.sessionID) || typeof job.kind !== 'string') {
      throw new ServiceShapeError('a background task')
    }
    const kind = job.kind === 'shell' || job.kind === 'subagent' || job.kind === 'image' ? job.kind : 'other'
    const command = kind === 'shell' ? label(job.command, 4096) : undefined
    const time = record(job.time)?.started
    jobs.set(job.id, {
      id: job.id,
      kind,
      title: label(job.title) ?? label(job.description) ?? command ?? (kind === 'subagent' ? 'Subagent' : kind === 'image' ? 'Image generation' : 'Background task'),
      ...(command ? { command } : {}),
      ...(typeof time === 'number' && Number.isFinite(time) && time > 0 ? { startedAt: time } : {}),
    })
  }
  return [...jobs.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id))
}

async function jobsFor(client: Client, thread: InboxThread): Promise<ChatBackgroundTask[]> {
  return parseBackgroundJobs(await client.request(thread.target, 'job.list', {
    query: { sessionID: thread.id, status: 'running', descendants: 'true' },
  }))
}

export async function listBackgroundTasks(client: Client, thread: InboxThread): Promise<ChatBackgroundState> {
  try {
    return { supported: true, tasks: await jobsFor(client, thread) }
  } catch (error) {
    if (error instanceof OpenCodeServiceError && [404, 405, 501].includes(error.status) && error.tag !== 'SessionNotFoundError') {
      return { supported: false, tasks: [] }
    }
    throw error
  }
}

