import type { OpenCodePluginTarget } from '@shared/types'
import { serviceTargetKey, type OpenCodeServiceDiscover, type OpenCodeServiceEndpoint } from './discovery'

/** The only OpenCode service operations MDE calls, each with a fixed method and path. */
export const SERVICE_OPERATIONS = {
  'agent.list': { method: 'GET', path: '/api/agent' },
  'provider.list': { method: 'GET', path: '/api/provider' },
  'model.list': { method: 'GET', path: '/api/model' },
  'model.default': { method: 'GET', path: '/api/model/default' },
  'session.create': { method: 'POST', path: '/api/session' },
  'session.active': { method: 'GET', path: '/api/session/active' },
  'session.get': { method: 'GET', path: '/api/session/{sessionID}' },
  'session.update': { method: 'PATCH', path: '/api/session/{sessionID}' },
  'session.message.list': { method: 'GET', path: '/api/session/{sessionID}/message' },
  'session.prompt': { method: 'POST', path: '/api/session/{sessionID}/prompt' },
  'session.interrupt': { method: 'POST', path: '/api/session/{sessionID}/interrupt' },
  'session.revert.stage': { method: 'POST', path: '/api/session/{sessionID}/revert/stage' },
  'session.revert.clear': { method: 'DELETE', path: '/api/session/{sessionID}/revert' },
  'session.fork': { method: 'POST', path: '/api/session/{sessionID}/fork' },
  'session.switchAgent': { method: 'POST', path: '/api/session/{sessionID}/agent' },
  'session.switchModel': { method: 'POST', path: '/api/session/{sessionID}/model' },
  'session.permission.list': { method: 'GET', path: '/api/session/{sessionID}/permission' },
  'session.permission.reply': { method: 'POST', path: '/api/session/{sessionID}/permission/{requestID}/reply' },
  'session.form.list': { method: 'GET', path: '/api/session/{sessionID}/form' },
  'session.form.reply': { method: 'POST', path: '/api/session/{sessionID}/form/{formID}/reply' },
} as const satisfies Record<string, { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string }>

export type ServiceOperation = keyof typeof SERVICE_OPERATIONS

const PATH_PARAMETERS: Record<string, RegExp> = {
  sessionID: /^ses_[A-Za-z0-9_-]{1,200}$/,
  requestID: /^per_[A-Za-z0-9_-]{1,200}$/,
  formID: /^frm_[A-Za-z0-9_-]{1,200}$/,
}
const QUERY_PARAMETERS: Record<string, RegExp> = {
  limit: /^\d{1,4}$/,
  order: /^(asc|desc)$/,
  cursor: /^[A-Za-z0-9_=.-]{1,2048}$/,
  'location[directory]': /^[^\u0000-\u001f\u007f-\u009f]{1,4096}$/,
}

export const SERVICE_REQUEST_TIMEOUT_MS = 30_000
export const SERVICE_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const SERVICE_MAX_BODY_BYTES = 1024 * 1024

export interface ServiceRequest {
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
}

/** A non-2xx answer from the service; `message` is safe to show. */
export class OpenCodeServiceError extends Error {
  constructor(message: string, readonly status: number, readonly tag?: string) {
    super(message)
    this.name = 'OpenCodeServiceError'
  }
}

export const SERVICE_UNREACHABLE =
  'Could not reach the OpenCode background service. On Windows, WSL must forward localhost ' +
  '(the default; check `localhostForwarding` in .wslconfig).'

/** Builds the request URL from a fixed template; parameters never change the path's shape. */
export function serviceUrl(origin: string, operation: ServiceOperation, request: ServiceRequest = {}): string {
  const spec = SERVICE_OPERATIONS[operation]
  if (!spec) throw new Error('Unsupported OpenCode service operation.')
  const params = request.params ?? {}
  const path = spec.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    const pattern = PATH_PARAMETERS[name]
    if (typeof value !== 'string' || !pattern?.test(value)) throw new Error(`Invalid OpenCode ${name}.`)
    return value
  })
  for (const name of Object.keys(params)) {
    if (!spec.path.includes(`{${name}}`)) throw new Error('Unsupported OpenCode service parameter.')
  }
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(request.query ?? {})) {
    const pattern = QUERY_PARAMETERS[name]
    if (!pattern || typeof value !== 'string' || !pattern.test(value)) throw new Error('Invalid OpenCode query parameter.')
    search.append(name, value)
  }
  const query = search.toString()
  return `${origin}${path}${query ? `?${query}` : ''}`
}

export function basicAuthorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
}

/** Reads a response body up to `limit` bytes; larger bodies are rejected, not truncated. */
export async function readLimitedText(response: Response, limit: number): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => {})
    throw new Error('The OpenCode service sent more data than MDE accepts.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new Error('The OpenCode service sent more data than MDE accepts.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function errorMessage(text: string, status: number): { message: string; tag?: string } {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const message = typeof parsed.message === 'string' ? parsed.message.slice(0, 500) : undefined
    const tag = typeof parsed._tag === 'string' ? parsed._tag.slice(0, 100) : undefined
    if (message) return { message, tag }
  } catch {
    // Not JSON; fall through to a generic message.
  }
  return { message: `OpenCode answered with status ${status}.` }
}

/** True for failures that a fresh discovery (restarting the service) can fix. */
function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return false
  const cause = (error as Error & { cause?: { code?: unknown } }).cause
  return error instanceof TypeError || typeof cause?.code === 'string'
}

export interface OpenCodeServiceClientOptions {
  discover: OpenCodeServiceDiscover
  /** The configured OpenCode executable, read on every discovery. */
  executable(): string
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

/**
 * Talks to the per-target OpenCode background service over loopback HTTP with
 * Basic auth. Endpoints are discovered lazily, cached, and rediscovered once
 * when the service refuses the connection or the password.
 */
export class OpenCodeServiceClient {
  private readonly endpoints = new Map<string, Promise<OpenCodeServiceEndpoint>>()
  private readonly fetch: typeof fetch

  constructor(private readonly options: OpenCodeServiceClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  endpoint(target: OpenCodePluginTarget): Promise<OpenCodeServiceEndpoint> {
    const key = serviceTargetKey(target)
    let pending = this.endpoints.get(key)
    if (!pending) {
      pending = this.options.discover(target, this.options.executable())
      this.endpoints.set(key, pending)
      // A failed discovery is not cached, so the next request tries again.
      pending.catch(() => {
        if (this.endpoints.get(key) === pending) this.endpoints.delete(key)
      })
    }
    return pending
  }

  /** Drops a cached endpoint, but only the one a failed request used. */
  private forget(target: OpenCodePluginTarget, stale: Promise<OpenCodeServiceEndpoint>): void {
    const key = serviceTargetKey(target)
    if (this.endpoints.get(key) === stale) this.endpoints.delete(key)
  }

  /** Forgets every endpoint, e.g. after the executable setting changed. */
  reset(): void {
    this.endpoints.clear()
  }

  async request(target: OpenCodePluginTarget, operation: ServiceOperation, request: ServiceRequest = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const pending = this.endpoint(target)
      const endpoint = await pending
      try {
        return await this.send(endpoint, operation, request)
      } catch (error) {
        const retry = attempt === 0 &&
          ((error instanceof OpenCodeServiceError && error.status === 401) || isConnectionFailure(error))
        if (retry) {
          this.forget(target, pending)
          continue
        }
        if (isConnectionFailure(error)) throw new Error(SERVICE_UNREACHABLE)
        if (error instanceof Error && error.name === 'TimeoutError') throw new Error('The OpenCode service did not answer in time.')
        throw error
      }
    }
  }

  private async send(endpoint: OpenCodeServiceEndpoint, operation: ServiceOperation, request: ServiceRequest): Promise<unknown> {
    const url = serviceUrl(endpoint.url, operation, request)
    const { method } = SERVICE_OPERATIONS[operation]
    const body = request.body === undefined ? undefined : JSON.stringify(request.body)
    if (body !== undefined && Buffer.byteLength(body) > (operation === 'session.prompt' ? 32 * 1024 * 1024 : SERVICE_MAX_BODY_BYTES)) throw new Error('The message is too large.')
    const response = await this.fetch(url, {
      method,
      headers: {
        authorization: basicAuthorization(endpoint.password),
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? SERVICE_REQUEST_TIMEOUT_MS),
    })
    const text = await readLimitedText(response, this.options.maxResponseBytes ?? ((operation === 'session.message.list' || operation === 'session.prompt') ? 32 * 1024 * 1024 : SERVICE_MAX_RESPONSE_BYTES))
    if (!response.ok) {
      const { message, tag } = errorMessage(text, response.status)
      throw new OpenCodeServiceError(message, response.status, tag)
    }
    if (!text.trim()) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error('The OpenCode service sent an invalid answer.')
    }
  }

  /** Opens the service's event stream; the caller reads and cancels the body. */
  async openEvents(
    target: OpenCodePluginTarget,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    for (let attempt = 0; ; attempt += 1) {
      const pending = this.endpoint(target)
      const endpoint = await pending
      let response: Response
      try {
        response = await this.fetch(`${endpoint.url}/api/event`, {
          headers: { authorization: basicAuthorization(endpoint.password), accept: 'text/event-stream' },
          redirect: 'error',
          signal,
        })
      } catch (error) {
        if (attempt === 0 && isConnectionFailure(error)) {
          this.forget(target, pending)
          continue
        }
        throw isConnectionFailure(error) ? new Error(SERVICE_UNREACHABLE) : error
      }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel().catch(() => {})
        this.forget(target, pending)
        continue
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw new OpenCodeServiceError(`OpenCode answered with status ${response.status}.`, response.status)
      }
      return response.body
    }
  }
}
