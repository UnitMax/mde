import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildLaunchSpec } from '../src/main/pty/launch'
import type { Session } from '@shared/types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'p1',
    projectId: 'project-1',
    name: 'app',
    kind: 'native',
    path: '/home/me/src/app',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    mode: overrides.mode ?? 'terminal'
  }
}

describe('buildLaunchSpec', () => {
  it('launches a WSL project inside the distro with a login+interactive shell', () => {
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/src/app' }),
      { platform: 'win32' }
    )

    expect(spec.file).toBe('wsl.exe')
    // -e, not --: `--` hands the rest of the line to the distro's default
    // shell, which re-parses the OSC 7 setup into separate commands.
    expect(spec.args.slice(0, -1)).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/me/src/app',
      '-e',
      'env',
      'TERM=xterm-256color',
      'COLORTERM=truecolor',
      'bash',
      '-lic'
    ])
    expect(spec.args.at(-1)).toMatch(
      /^MDE_CWD_PROMPT_COMMAND=.*file:\/\/localhost.*exec bash --rcfile <\(printf .*\.bashrc.*PROMPT_COMMAND=.*\) -i$/
    )
    // --cd sets the directory inside the distro; a Windows-side cwd would be wrong.
    expect(spec.cwd).toBeUndefined()
  })

  it('keeps -lic so nvm/mise/bun shims land on PATH', () => {
    const spec = buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    expect(spec.args).toContain('-lic')
  })

  it('builds syntactically valid Bash cwd-reporting setup', () => {
    const spec = buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    const command = spec.args.at(-1)
    expect(command).toBeDefined()

    const result = spawnSync('bash', ['-n', '-c', command ?? ''], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('honours a shell override for WSL projects', () => {
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: 'zsh' }),
      { platform: 'win32' }
    )
    expect(spec.args.slice(-3)).toEqual(['zsh', '-lic', 'exec zsh -i'])
  })

  it('passes MDE status variables into the WSL login shell', () => {
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/src/app' }),
      {
        platform: 'win32',
        wslEnvironment: {
          MDE_OPENCODE_STATUS_FILE: "/tmp/mde-opencode/status's file.json",
          MDE_OPENCODE_STATUS_PROTOCOL: '1'
        }
      }
    )

    expect(spec.args.slice(0, -1)).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/me/src/app',
      '-e',
      'env',
      "MDE_OPENCODE_STATUS_FILE=/tmp/mde-opencode/status's file.json",
      'MDE_OPENCODE_STATUS_PROTOCOL=1',
      'TERM=xterm-256color',
      'COLORTERM=truecolor',
      'bash',
      '-lic'
    ])
    expect(spec.args.at(-1)).toContain('MDE_CWD_PROMPT_COMMAND=')
  })

  it('refuses to launch a WSL project off Windows', () => {
    expect(() =>
      buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), { platform: 'linux' })
    ).toThrow(/only be launched on Windows/)
  })

  it('refuses a WSL project with no distro', () => {
    expect(() => buildLaunchSpec(session({ kind: 'wsl' }), { platform: 'win32' })).toThrow(
      /no distro/
    )
  })

  it('spawns powershell in the project directory for native Windows projects', () => {
    const spec = buildLaunchSpec(session({ kind: 'native', path: 'C:\\src\\app' }), {
      platform: 'win32'
    })
    expect(spec).toEqual({ file: 'powershell.exe', args: [], cwd: 'C:\\src\\app' })
  })

  it('spawns a login shell in the project directory on Linux', () => {
    const spec = buildLaunchSpec(session(), { platform: 'linux', defaultShell: '/usr/bin/fish' })
    expect(spec).toEqual({ file: '/usr/bin/fish', args: ['-l'], cwd: '/home/me/src/app' })
  })

  it('falls back to /bin/bash when SHELL is unset', () => {
    const spec = buildLaunchSpec(session(), { platform: 'linux' })
    expect(spec.file).toBe('/bin/bash')
  })

  it('prefers the project shell override over SHELL on Linux', () => {
    const spec = buildLaunchSpec(session({ shell: '/bin/zsh' }), {
      platform: 'linux',
      defaultShell: '/bin/bash'
    })
    expect(spec.file).toBe('/bin/zsh')
  })
})
