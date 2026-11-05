import { userInfo } from 'node:os'

export function nativeLoginShell(): string {
  return process.env.SHELL || userInfo().shell || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}
