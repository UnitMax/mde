import { describe, expect, it } from 'vitest'
import { execFile, type ExecError } from '../src/main/exec-host'

interface Outcome<T> {
  error: ExecError | null
  stdout: T
  stderr: T
}

/** Runs the current Node binary on a script, so the tests need no other executable. */
function runUtf8(script: string, options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; maxBuffer?: number } = {}) {
  return new Promise<Outcome<string>>((resolve) => {
    execFile(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true, ...options }, (error, stdout, stderr) =>
      resolve({ error, stdout, stderr })
    )
  })
}

function runBuffer(script: string) {
  return new Promise<Outcome<Buffer>>((resolve) => {
    execFile(process.execPath, ['-e', script], { encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) =>
      resolve({ error, stdout, stderr })
    )
  })
}

describe('execFile on a worker thread', () => {
  it('returns text output and no error for a successful command', async () => {
    const result = await runUtf8("process.stdout.write('out'); process.stderr.write('err')")

    expect(result.error).toBeNull()
    expect(result.stdout).toBe('out')
    expect(result.stderr).toBe('err')
  })

  it('returns real Buffers, byte for byte, when asked for buffer output', async () => {
    // ASCII with interleaved NULs is what a UTF-16 reader would be fooled by, so it must arrive untouched.
    const result = await runBuffer("process.stdout.write(Buffer.from([97, 0, 98, 0, 255, 0])); process.stderr.write('warn')")

    expect(Buffer.isBuffer(result.stdout)).toBe(true)
    expect(Buffer.isBuffer(result.stderr)).toBe(true)
    expect([...result.stdout]).toEqual([97, 0, 98, 0, 255, 0])
    expect(result.stderr.toString()).toBe('warn')
  })

  it('reports a failing exit as a numeric code and still delivers the output', async () => {
    const result = await runUtf8("process.stdout.write('partial'); process.exit(3)")

    expect(result.error?.code).toBe(3)
    expect(result.stdout).toBe('partial')
  })

  it('reports an executable that cannot be started with a string code', async () => {
    const result = await new Promise<Outcome<string>>((resolve) => {
      execFile('mde-definitely-not-an-executable', [], { encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) =>
        resolve({ error, stdout, stderr })
      )
    })

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.code).toBe('ENOENT')
  })

  it('passes the working directory and environment through', async () => {
    const cwd = process.cwd()
    const result = await runUtf8("process.stdout.write(process.cwd() + '|' + process.env.MDE_TEST_VALUE)", {
      cwd,
      env: { ...process.env, MDE_TEST_VALUE: 'from-the-caller' }
    })

    expect(result.stdout).toBe(`${cwd}|from-the-caller`)
  })

  it('kills a command that outlives its timeout and still answers', async () => {
    const started = Date.now()
    const result = await runUtf8('setTimeout(() => {}, 30000)', { timeout: 300 })

    expect(result.error).not.toBeNull()
    expect(result.error?.killed || result.error?.signal).toBeTruthy()
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('fails a command whose output exceeds the buffer limit', async () => {
    const result = await runUtf8("process.stdout.write('x'.repeat(5000))", { maxBuffer: 100 })

    expect(result.error?.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  })

  it('keeps simultaneous calls separate', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => runUtf8(`process.stdout.write('call-${index}')`))
    )

    expect(results.map((result) => result.stdout)).toEqual(Array.from({ length: 12 }, (_, index) => `call-${index}`))
    expect(results.every((result) => result.error === null)).toBe(true)
  })

  it('runs the launch off the calling thread, leaving it free', async () => {
    // Launch many processes and watch the calling thread's own timer: if the launches happened here,
    // each would hold the thread for its whole spawn call.
    const gaps: number[] = []
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }, 2)

    await Promise.all(Array.from({ length: 20 }, () => runUtf8('0')))
    clearInterval(timer)

    expect(gaps.length).toBeGreaterThan(5)
    expect(Math.max(...gaps)).toBeLessThan(500)
  })
})
