import type { Session } from './types'

export function supportsAgentIntegration(platform: string | undefined, session: Pick<Session, 'kind' | 'distro'>): boolean {
  return (platform === 'darwin' && session.kind === 'native') ||
    (platform === 'win32' && session.kind === 'wsl' && Boolean(session.distro))
}
