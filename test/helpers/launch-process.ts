import { spawn } from 'node:child_process'

interface LaunchProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeout?: number
}

/** Keep interactive test shells off the caller's terminal and bound their lifetime. */
export function runLaunchProcess(
  file: string,
  args: readonly string[],
  { input = '', timeout = 3_000, ...options }: LaunchProcessOptions = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      ...options,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    // An early shell exit can close stdin before the fixture input is written.
    child.stdin.on('error', () => {})
    child.stdin.end(input)

    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          reject(error)
          return
        }
      }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      reject(new Error(`Launch test process exceeded ${timeout} ms: ${file}`))
    }, timeout)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}
