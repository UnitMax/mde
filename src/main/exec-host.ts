import { Worker } from 'node:worker_threads'

/**
 * `execFile` that creates the child process on a worker thread instead of the main thread.
 *
 * Starting a process is a blocking call, and on Windows it occasionally takes over 100 ms: about
 * one launch in eight on a developer machine, with or without a console, whichever executable and
 * options, which points at the operating system (real-time scanning) rather than anything MDE
 * asks for. The main thread is also the thread that drags the window and relays terminal input
 * and output, so every slow launch froze them. Here the blocking call happens on the worker; the
 * main thread only sends a message and receives the result.
 *
 * The worker is created from an inline script, so there is no extra file to load from the app
 * archive. It is not a security boundary, only a thread.
 */

export type ExecEncoding = 'buffer' | BufferEncoding

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  encoding: ExecEncoding
  timeout?: number
  maxBuffer?: number
  windowsHide?: boolean
}

export type ExecError = Error & { code?: number | string; killed?: boolean; signal?: string | null }

export function execFile(
  file: string,
  args: readonly string[],
  options: ExecOptions & { encoding: 'buffer' },
  callback: (error: ExecError | null, stdout: Buffer, stderr: Buffer) => void
): void
export function execFile(
  file: string,
  args: readonly string[],
  options: ExecOptions & { encoding: BufferEncoding },
  callback: (error: ExecError | null, stdout: string, stderr: string) => void
): void
export function execFile(
  file: string,
  args: readonly string[],
  options: ExecOptions,
  callback: (error: ExecError | null, stdout: never, stderr: never) => void
): void {
  const id = nextId++
  const request: Pending = {
    encoding: options.encoding,
    callback: callback as unknown as Pending['callback']
  }
  pending.set(id, request)

  // If the worker never answers, fail the call rather than leaving it, and its caller, waiting.
  if (options.timeout && options.timeout > 0) {
    request.watchdog = setTimeout(() => {
      settle(id, errorOf({ message: 'The process launcher did not respond.', code: 'ETIMEDOUT' }), '', '')
    }, options.timeout + WATCHDOG_GRACE_MS)
  }

  try {
    launcher().postMessage({ id, file, args: [...args], options })
  } catch (error) {
    settle(id, errorOf({ message: error instanceof Error ? error.message : String(error), code: 'EWORKER' }), '', '')
  }
}

const WATCHDOG_GRACE_MS = 5_000

const WORKER_SOURCE = `
  const { parentPort } = require('node:worker_threads')
  const { execFile } = require('node:child_process')
  parentPort.on('message', ({ id, file, args, options }) => {
    const reply = (error, stdout, stderr) => parentPort.postMessage({
      id,
      error: error ? { message: String(error.message), code: error.code, killed: error.killed, signal: error.signal } : null,
      stdout,
      stderr
    })
    try {
      execFile(file, args, options, reply)
    } catch (error) {
      reply(error, '', '')
    }
  })
`

interface Pending {
  encoding: ExecEncoding
  callback: (error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void
  watchdog?: NodeJS.Timeout
}

interface SerializedError {
  message: string
  code?: number | string
  killed?: boolean
  signal?: string | null
}

interface WorkerReply {
  id: number
  error: SerializedError | null
  stdout: string | Uint8Array
  stderr: string | Uint8Array
}

const pending = new Map<number, Pending>()
let nextId = 0
let worker: Worker | null = null

function launcher(): Worker {
  if (worker) return worker
  const created = new Worker(WORKER_SOURCE, { eval: true })
  // The launcher must never be what keeps the application alive.
  created.unref()
  created.on('message', (reply: WorkerReply) => {
    settle(reply.id, reply.error ? errorOf(reply.error) : null, reply.stdout, reply.stderr)
  })
  const lost = (error: Error): void => {
    if (worker === created) worker = null
    for (const id of [...pending.keys()]) {
      settle(id, errorOf({ message: error.message, code: 'EWORKER' }), '', '')
    }
  }
  created.on('error', lost)
  created.on('exit', () => lost(new Error('The process launcher stopped.')))
  worker = created
  return created
}

function errorOf(serialized: SerializedError): ExecError {
  return Object.assign(new Error(serialized.message), {
    ...(serialized.code === undefined ? {} : { code: serialized.code }),
    ...(serialized.killed === undefined ? {} : { killed: serialized.killed }),
    ...(serialized.signal === undefined ? {} : { signal: serialized.signal })
  })
}

function convert(value: string | Uint8Array, encoding: ExecEncoding): string | Buffer {
  if (encoding === 'buffer') {
    if (typeof value === 'string') return Buffer.from(value)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') return value
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(encoding)
}

function settle(
  id: number,
  error: ExecError | null,
  stdout: string | Uint8Array,
  stderr: string | Uint8Array
): void {
  const request = pending.get(id)
  if (!request) return
  pending.delete(id)
  clearTimeout(request.watchdog)
  request.callback(error, convert(stdout, request.encoding), convert(stderr, request.encoding))
}
