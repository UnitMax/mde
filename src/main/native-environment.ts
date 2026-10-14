import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

export function nativeLoginShell(): string {
  return process.env.SHELL || userInfo().shell || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

/** Read only integration-related values, framed past any shell startup banners. */
export async function nativeLoginEnvironment(
  shell = nativeLoginShell(),
  environment = process.env,
): Promise<NodeJS.ProcessEnv> {
  const marker = `MDE_ENV_${randomUUID()}`
  const script = 'printf "\\000%s\\000%s\\000%s\\000%s\\000" "$1" "$PATH" "${OPENCODE_CONFIG_DIR:-}" "${XDG_CONFIG_HOME:-}"'
  const fish = shell.split('/').at(-1) === 'fish'
  const args = fish
    ? ['-lic', 'exec /bin/sh -c "$argv[1]" mde-env "$argv[2]"', script, marker]
    : ['-lic', script, 'mde-env', marker]
  return new Promise((resolve, reject) => {
    execFile(shell, args, { env: environment, timeout: 5_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) return reject(new Error('Could not read the native login environment. Check your shell configuration.'))
      const prefix = `\0${marker}\0`
      const start = stdout.indexOf(prefix)
      const values = stdout.slice(start + prefix.length).split('\0')
      if (start < 0 || values.length < 4) return reject(new Error('The native login shell returned an invalid environment.'))
      resolve({ ...environment, PATH: values[0], OPENCODE_CONFIG_DIR: values[1], XDG_CONFIG_HOME: values[2] })
    })
  })
}

export async function nativeOpenCodeConfigDirectory(): Promise<string> {
  const environment = process.platform === 'darwin' ? await nativeLoginEnvironment() : process.env
  return openCodeConfigDirectory(environment, homedir())
}

export function openCodeConfigDirectory(environment: NodeJS.ProcessEnv, homeDirectory: string): string {
  const configured = environment.OPENCODE_CONFIG_DIR?.trim()
  if (configured) {
    if (!configured.startsWith('/')) throw new Error('OPENCODE_CONFIG_DIR must be an absolute POSIX path.')
    return configured.replace(/\/+$/, '') || '/'
  }
  const xdg = environment.XDG_CONFIG_HOME?.trim()
  return join(xdg?.startsWith('/') ? xdg : join(homeDirectory, '.config'), 'opencode')
}
