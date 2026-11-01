import type { OpenCodePluginTarget } from '@shared/types'
import type { OpenCodeServiceClient } from './client'
import { serviceTargetKey } from './discovery'

/** One decoded service event; `data` is untrusted and checked by its consumer. */
export interface ServiceEvent {
  type: string
  data: Record<string, unknown>
}

const MAX_EVENT_BYTES = 8 * 1024 * 1024
const EVENT_TYPE = /^[a-z][a-z0-9._-]{0,99}$/

/** Incremental `text/event-stream` decoder that yields each event's data. */
export class SseParser {
  private buffer = ''
  private data: string[] = []

  push(chunk: string): string[] {
    this.buffer += chunk
    if (this.buffer.length > MAX_EVENT_BYTES) {
      // A runaway event is dropped rather than buffered without bound.
      this.buffer = ''
      this.data = []
      return []
    }
    const events: string[] = []
    let newline: number
    while ((newline = this.buffer.search(/\r?\n|\r/)) >= 0) {
      const line = this.buffer.slice(0, newline)
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1
      this.buffer = this.buffer.slice(newline + width)
      if (line === '') {
        if (this.data.length > 0) events.push(this.data.join('\n'))
        this.data = []
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(line.startsWith('data: ') ? 6 : 5))
      }
      // Comments (`: heartbeat`), `id:`, `event:` and `retry:` lines are not needed.
    }
    return events
  }
}

export function parseServiceEvent(raw: string): ServiceEvent | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || !EVENT_TYPE.test(record.type)) return null
  const data = record.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return { type: record.type, data: data as Record<string, unknown> }
}

/** The OpenCode session an event belongs to, wherever the event keeps it. */
export function serviceEventSessionId(event: ServiceEvent): string | null {
  const direct = event.data.sessionID
  if (typeof direct === 'string') return direct
  for (const key of ['form', 'request', 'info']) {
    const nested = event.data[key]
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).sessionID === 'string') {
      return (nested as Record<string, unknown>).sessionID as string
    }
  }
  return null
}

export interface ServiceEventStreamsOptions {
  onEvent(target: OpenCodePluginTarget, event: ServiceEvent): void
  /** Called on every successful (re)connect; `reconnected` is false for the first one. */
  onConnected?(target: OpenCodePluginTarget, reconnected: boolean): void
  onFailure?(target: OpenCodePluginTarget, error: unknown): void
  /** Delay before the next attempt after `failures` consecutive failures. */
  backoffMs?(failures: number): number
  maxFailures?: number
}

const defaultBackoff = (failures: number): number => Math.min(30_000, 1_000 * 2 ** Math.max(0, failures - 1))

interface StreamState {
  target: OpenCodePluginTarget
  controller: AbortController
  failures: number
  connectedBefore: boolean
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * One live event stream per target. A dropped stream reconnects with backoff;
 * after several failures in a row it stops until `ensure` is called again.
 */
export class ServiceEventStreams {
  private readonly streams = new Map<string, StreamState>()

  constructor(
    private readonly client: Pick<OpenCodeServiceClient, 'openEvents'>,
    private readonly options: ServiceEventStreamsOptions,
  ) {}

  isOpen(target: OpenCodePluginTarget): boolean {
    return this.streams.has(serviceTargetKey(target))
  }

  ensure(target: OpenCodePluginTarget): void {
    const key = serviceTargetKey(target)
    if (this.streams.has(key)) return
    const state: StreamState = {
      target,
      controller: new AbortController(),
      failures: 0,
      connectedBefore: false,
      timer: null,
    }
    this.streams.set(key, state)
    void this.run(key, state)
  }

  stop(target: OpenCodePluginTarget): void {
    const key = serviceTargetKey(target)
    const state = this.streams.get(key)
    if (!state) return
    this.streams.delete(key)
    state.controller.abort()
    if (state.timer) clearTimeout(state.timer)
  }

  stopAll(): void {
    for (const state of [...this.streams.values()]) this.stop(state.target)
  }

  private async run(key: string, state: StreamState): Promise<void> {
    while (this.streams.get(key) === state) {
      let received = false
      try {
        const body = await this.client.openEvents(state.target, state.controller.signal)
        this.options.onConnected?.(state.target, state.connectedBefore)
        state.connectedBefore = true
        const parser = new SseParser()
        const decoder = new TextDecoder()
        const reader = body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
              const event = parseServiceEvent(raw)
              if (!event) continue
              received = true
              state.failures = 0
              if (event.type === 'server.connected') continue
              this.options.onEvent(state.target, event)
            }
          }
        } finally {
          reader.releaseLock()
        }
      } catch (error) {
        if (state.controller.signal.aborted) return
        this.options.onFailure?.(state.target, error)
      }
      if (this.streams.get(key) !== state) return
      if (!received) state.failures += 1
      if (state.failures >= (this.options.maxFailures ?? 5)) {
        this.streams.delete(key)
        return
      }
      const delay = (this.options.backoffMs ?? defaultBackoff)(Math.max(1, state.failures))
      await new Promise<void>((resolve) => {
        state.timer = setTimeout(() => {
          state.timer = null
          resolve()
        }, delay)
        state.timer.unref?.()
      })
    }
  }
}
