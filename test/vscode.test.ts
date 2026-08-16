import { describe, expect, it } from 'vitest'
import { buildVsCodeLaunchSpec } from '../src/main/vscode'
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
    ...overrides,
    mode: overrides.mode ?? 'terminal'
  }
}

describe('buildVsCodeLaunchSpec', () => {
  it('opens a WSL folder through Windows VS Code Remote - WSL', () => {
    expect(buildVsCodeLaunchSpec(session(), 'win32')).toEqual({
      file: 'code',
      args: ['--remote', 'wsl+Ubuntu-24.04', '/home/me/src/app/']
    })
  })

  it('preserves spaces and forces dotted paths to be folders', () => {
    expect(
      buildVsCodeLaunchSpec(
        session({ distro: 'My Distro', path: '/home/me/my.project with spaces' }),
        'win32'
      )
    ).toEqual({
      file: 'code',
      args: ['--remote', 'wsl+My Distro', '/home/me/my.project with spaces/']
    })
  })

  it('does not add a second slash to a root path', () => {
    expect(buildVsCodeLaunchSpec(session({ path: '/' }), 'win32').args).toEqual([
      '--remote',
      'wsl+Ubuntu-24.04',
      '/'
    ])
  })

  it('rejects unsupported hosts and session kinds', () => {
    expect(() => buildVsCodeLaunchSpec(session(), 'linux')).toThrow(/only supported on Windows/)
    expect(() => buildVsCodeLaunchSpec(session({ kind: 'native' }), 'win32')).toThrow(
      /Only WSL sessions/
    )
    expect(() => buildVsCodeLaunchSpec(session({ distro: undefined }), 'win32')).toThrow(/no distro/)
  })
})
