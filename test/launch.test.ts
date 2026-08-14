import { describe, expect, it } from 'vitest'
import { buildLaunchSpec } from '../src/main/pty/launch'
import type { Project } from '@shared/types'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'app',
    kind: 'native',
    path: '/home/me/src/app',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('buildLaunchSpec', () => {
  it('launches a WSL project inside the distro with a login+interactive shell', () => {
    const spec = buildLaunchSpec(
      project({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/src/app' }),
      { platform: 'win32' }
    )

    expect(spec.file).toBe('wsl.exe')
    expect(spec.args).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/me/src/app',
      '--',
      'bash',
      '-lic',
      'exec bash -i'
    ])
    // --cd sets the directory inside the distro; a Windows-side cwd would be wrong.
    expect(spec.cwd).toBeUndefined()
  })

  it('keeps -lic so nvm/mise/bun shims land on PATH', () => {
    const spec = buildLaunchSpec(project({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    expect(spec.args).toContain('-lic')
  })

  it('honours a shell override for WSL projects', () => {
    const spec = buildLaunchSpec(
      project({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: 'zsh' }),
      { platform: 'win32' }
    )
    expect(spec.args.slice(-3)).toEqual(['zsh', '-lic', 'exec zsh -i'])
  })

  it('refuses to launch a WSL project off Windows', () => {
    expect(() =>
      buildLaunchSpec(project({ kind: 'wsl', distro: 'Ubuntu-24.04' }), { platform: 'linux' })
    ).toThrow(/only be launched on Windows/)
  })

  it('refuses a WSL project with no distro', () => {
    expect(() => buildLaunchSpec(project({ kind: 'wsl' }), { platform: 'win32' })).toThrow(
      /no distro/
    )
  })

  it('spawns powershell in the project directory for native Windows projects', () => {
    const spec = buildLaunchSpec(project({ kind: 'native', path: 'C:\\src\\app' }), {
      platform: 'win32'
    })
    expect(spec).toEqual({ file: 'powershell.exe', args: [], cwd: 'C:\\src\\app' })
  })

  it('spawns a login shell in the project directory on Linux', () => {
    const spec = buildLaunchSpec(project(), { platform: 'linux', defaultShell: '/usr/bin/fish' })
    expect(spec).toEqual({ file: '/usr/bin/fish', args: ['-l'], cwd: '/home/me/src/app' })
  })

  it('falls back to /bin/bash when SHELL is unset', () => {
    const spec = buildLaunchSpec(project(), { platform: 'linux' })
    expect(spec.file).toBe('/bin/bash')
  })

  it('prefers the project shell override over SHELL on Linux', () => {
    const spec = buildLaunchSpec(project({ shell: '/bin/zsh' }), {
      platform: 'linux',
      defaultShell: '/bin/bash'
    })
    expect(spec.file).toBe('/bin/zsh')
  })
})
