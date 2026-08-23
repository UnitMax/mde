import { describe, expect, it } from 'vitest'
import { buildVsCodeRemoteUri } from '../src/main/vscode'
import type { Session } from '@shared/types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'app',
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    path: '/home/me/src/app',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('buildVsCodeRemoteUri', () => {
  it('opens a WSL folder through the registered Windows VS Code protocol', () => {
    expect(buildVsCodeRemoteUri(session(), 'win32')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu-24.04/home/me/src/app/'
    )
  })

  it('preserves spaces and forces dotted paths to be folders', () => {
    expect(buildVsCodeRemoteUri(
      session({ distro: 'My Distro', path: '/home/me/my.project with spaces' }),
      'win32'
    )).toBe('vscode://vscode-remote/wsl+My%20Distro/home/me/my.project%20with%20spaces/')
  })

  it('does not add a second slash to a root path', () => {
    expect(buildVsCodeRemoteUri(session({ path: '/' }), 'win32')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu-24.04/'
    )
  })

  it('encodes authority and path characters without changing path separators', () => {
    expect(buildVsCodeRemoteUri(
      session({ distro: 'Ubuntu+Dev', path: '/home/me/project#1?draft' }),
      'win32'
    )).toBe('vscode://vscode-remote/wsl+Ubuntu%2BDev/home/me/project%231%3Fdraft/')
  })

  it('opens an explicitly reported terminal directory', () => {
    expect(buildVsCodeRemoteUri(
      session({ path: '/home/me/src/app' }),
      'win32',
      '/home/me/src/app/packages/client.project'
    )).toBe('vscode://vscode-remote/wsl+Ubuntu-24.04/home/me/src/app/packages/client.project/')
  })

  it('rejects an empty explicitly reported directory', () => {
    expect(() => buildVsCodeRemoteUri(session(), 'win32', '  ')).toThrow(/no project path/)
  })

  it('rejects unsupported hosts and session kinds', () => {
    expect(() => buildVsCodeRemoteUri(session(), 'linux')).toThrow(/only supported on Windows/)
    expect(() => buildVsCodeRemoteUri(session({ kind: 'native' }), 'win32')).toThrow(
      /Only WSL sessions/
    )
    expect(() => buildVsCodeRemoteUri(session({ distro: undefined }), 'win32')).toThrow(/no distro/)
    expect(() => buildVsCodeRemoteUri(session({ path: '  ' }), 'win32')).toThrow(/no project path/)
  })
})
