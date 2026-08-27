import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    ...overrides
  }
}

async function waitFor(condition: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
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
    expect(spec.args.slice(0, 9)).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/me/src/app',
      '-e',
      'env',
      'TERM=xterm-256color',
      'COLORTERM=truecolor',
      '/bin/sh'
    ])
    expect(spec.args[9]).toBe('-c')
    expect(spec.args[10]).toContain('getent passwd "$(id -u)"')
    expect(spec.args[10]).toContain('exec "$shell" -lic')
    expect(spec.args[11]).toBe('mde-shell')
    // --cd sets the directory inside the distro; a Windows-side cwd would be wrong.
    expect(spec.cwd).toBeUndefined()
  })

  it('starts the configured WSL login shell as login and interactive', () => {
    const spec = buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    expect(spec.args[10]).toContain('exec "$shell" -lic')
    expect(spec.args[10]).toContain('"$shell" -l -i')
  })

  it('builds a syntactically valid WSL shell bootstrap', () => {
    const spec = buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    const command = spec.args[10]
    expect(command).toBeDefined()

    const result = spawnSync('bash', ['-n', '-c', command ?? ''], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('cleans up temporary WSL Zsh configuration on shell signals', () => {
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: '/usr/bin/zsh' }),
      { platform: 'win32' }
    )
    const command = spec.args[10] ?? ''

    expect(command).toContain('trap mde_cleanup_zdotdir 0')
    expect(command).toContain("trap 'exit 129' HUP")
    expect(command).toContain('rm -rf -- "$mde_zdotdir"')
  })

  it('honours a shell override for WSL projects', () => {
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: 'zsh' }),
      { platform: 'win32' }
    )
    expect(spec.args.slice(-2)).toEqual(['mde-shell', 'zsh'])
    expect(spec.args[10]).toContain('add-zsh-hook precmd __mde_report_cwd')
  })

  it('passes shell overrides as an argument instead of shell source', () => {
    const override = "zsh; printf 'unexpected'"
    const spec = buildLaunchSpec(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: override }),
      { platform: 'win32' }
    )

    expect(spec.args.at(-1)).toBe(override)
    expect(spec.args[10]).not.toContain(override)
  })

  it('installs process-local directory reporters for common WSL shells', () => {
    const spec = buildLaunchSpec(session({ kind: 'wsl', distro: 'Ubuntu-24.04' }), {
      platform: 'win32'
    })
    const command = spec.args[10] ?? ''

    expect(command).toContain('PROMPT_COMMAND=')
    expect(command).toContain('add-zsh-hook precmd __mde_report_cwd')
    expect(command).toContain('functions --copy fish_prompt __mde_original_fish_prompt')
  })

  it.skipIf(spawnSync('zsh', ['--version']).status !== 0)(
    'loads the user Zsh configuration and reports the current directory',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'mde-zsh-home-'))
      try {
        const spec = buildLaunchSpec(
          session({ kind: 'wsl', distro: 'Ubuntu-24.04', shell: '/usr/bin/zsh' }),
          { platform: 'win32' }
        )
        const result = spawnSync('/bin/sh', ['-c', spec.args[10] ?? '', 'mde-shell', '/usr/bin/zsh'], {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, ZDOTDIR: home, EDITOR: 'emacs' },
          input: "bindkey -M main $'\\e[1;5C'\nbindkey -M main $'\\e[1;5D'\nexit\n",
          timeout: 5_000
        })

        expect(result.status).toBe(0)
        expect(result.stdout).toContain('\u001b]7;file://localhost')
        expect(result.stdout).toContain('forward-word')
        expect(result.stdout).toContain('backward-word')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'removes native Zsh configuration when the wrapper receives SIGHUP',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'mde-zsh-cleanup-'))
      const home = join(root, 'home')
      const bin = join(root, 'bin')
      const fakeZsh = join(bin, 'zsh')
      mkdirSync(home)
      mkdirSync(bin)
      writeFileSync(fakeZsh, '#!/bin/sh\n: > "$TMPDIR/fake-zsh-started"\nsleep 1\n')
      chmodSync(fakeZsh, 0o755)

      try {
        const spec = buildLaunchSpec(
          session({ shell: fakeZsh, path: home }),
          { platform: process.platform }
        )
        const child = spawn(spec.file, spec.args, {
          cwd: spec.cwd,
          env: { ...process.env, HOME: home, TMPDIR: root },
          stdio: 'ignore'
        })

        await waitFor(() => readdirSync(root).includes('fake-zsh-started'))
        expect(readdirSync(root).some((entry) => entry.startsWith('mde-zsh.'))).toBe(true)
        const exited = new Promise<void>((resolve, reject) => {
          child.once('exit', () => resolve())
          child.once('error', reject)
        })
        child.kill('SIGHUP')
        await exited

        expect(readdirSync(root).filter((entry) => entry.startsWith('mde-zsh.'))).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

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

    expect(spec.args.slice(0, 13)).toEqual([
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
      '/bin/sh',
      '-c',
      expect.any(String)
    ])
    expect(spec.args[12]).toContain('MDE_CWD_PROMPT_COMMAND=')
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
    expect(spec.file).toBe('/bin/sh')
    expect(spec.args[0]).toBe('-c')
    expect(spec.args.at(-2)).toBe('mde-shell')
    expect(spec.args.at(-1)).toBe('/bin/zsh')
    expect(spec.args[1]).toContain('bindkey -M main')
    expect(spec.args[1]).not.toContain('__mde_report_cwd')
    expect(spec.cwd).toBe('/home/me/src/app')
  })

  it.skipIf(spawnSync('zsh', ['--version']).status !== 0)(
    'loads native Zsh configuration and preserves existing bindings',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'mde-native-zsh-home-'))
      try {
        writeFileSync(
          join(home, '.zshrc'),
          [
            'bindkey -e',
            "bindkey -M main $'\\e[1;5C' self-insert",
            "print -r -- 'user-zshrc-loaded'"
          ].join('\n')
        )
        const spec = buildLaunchSpec(
          session({ shell: '/usr/bin/zsh', path: home }),
          { platform: 'linux', defaultShell: '/bin/bash' }
        )
        const result = spawnSync(spec.file, spec.args, {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, ZDOTDIR: home, EDITOR: 'emacs' },
          input: "bindkey -M main $'\\e[1;5C'\nbindkey -M main $'\\e[1;5D'\nexit\n",
          timeout: 5_000
        })

        expect(result.status).toBe(0)
        expect(result.stdout).toContain('user-zshrc-loaded')
        expect(result.stdout).toContain('self-insert')
        expect(result.stdout).toContain('backward-word')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(spawnSync('zsh', ['--version']).status !== 0)(
    'binds the active Zsh insert map without changing vi command mode',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'mde-vi-zsh-home-'))
      try {
        writeFileSync(join(home, '.zshrc'), 'bindkey -v\n')
        const spec = buildLaunchSpec(
          session({ shell: '/usr/bin/zsh', path: home }),
          { platform: 'linux' }
        )
        const result = spawnSync(spec.file, spec.args, {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, ZDOTDIR: home },
          input: "bindkey -M main $'\\e[1;5C'\nbindkey -M main $'\\e[1;5D'\nbindkey -M vicmd $'\\e[1;5C'\nexit\n",
          timeout: 5_000
        })

        expect(result.status).toBe(0)
        expect(result.stdout).toContain('forward-word')
        expect(result.stdout).toContain('backward-word')
        expect(result.stdout).toContain('undefined-key')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  )

  it('leaves native Windows shell launch behavior unchanged', () => {
    const spec = buildLaunchSpec(session({ shell: 'zsh.exe', path: 'C:\\src\\app' }), {
      platform: 'win32'
    })
    expect(spec).toEqual({ file: 'zsh.exe', args: [], cwd: 'C:\\src\\app' })
  })
})
