import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/wsl/distros', async () => ({
  ...(await vi.importActual<typeof import('../src/main/wsl/distros')>('../src/main/wsl/distros')),
  runWsl: vi.fn()
}))

import { spawnSync } from 'node:child_process'

import { decodeWslOutput, parseDistroList, runWsl } from '../src/main/wsl/distros'
import {
  assertWslLinuxPath,
  extractWslShellValue,
  readWslShellValue,
  wslShellValueScript,
  WSL_VALUE_BEGIN,
  WSL_VALUE_END
} from '../src/main/wsl/shell-value'
import {
  canonicalizeWslPath,
  isWindowsDrivePath,
  isWslMountedWindowsPath,
  parseWslUncPath,
  resolveForTarget,
  toWindows,
  toWsl,
  uncPathFor
} from '../src/main/wsl/paths'

// Exactly the shape wsl.exe --list --verbose emits with WSL_UTF8=1 set.
const LIST_OUTPUT = [
  '  NAME              STATE           VERSION',
  '* Ubuntu-24.04      Running         2',
  '  docker-desktop    Stopped         2',
  '  Legacy-Distro     Stopped         1',
  ''
].join('\r\n')

describe('parseDistroList', () => {
  it('parses names, states, versions and the default marker', () => {
    expect(parseDistroList(LIST_OUTPUT)).toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true },
      { name: 'docker-desktop', state: 'Stopped', version: 2, isDefault: false },
      { name: 'Legacy-Distro', state: 'Stopped', version: 1, isDefault: false }
    ])
  })

  it('drops the header row', () => {
    expect(parseDistroList(LIST_OUTPUT).map((d) => d.name)).not.toContain('NAME')
  })

  it('returns nothing when no distros are installed', () => {
    expect(
      parseDistroList('Windows Subsystem for Linux has no installed distributions.')
    ).toEqual([])
  })

  it('handles distro names containing spaces', () => {
    const output = '  NAME            STATE     VERSION\r\n  Ubuntu 22.04    Running   2\r\n'
    expect(parseDistroList(output)).toEqual([
      { name: 'Ubuntu 22.04', state: 'Running', version: 2, isDefault: false }
    ])
  })
})

/**
 * Byte-for-byte capture of `wsl.exe --list --verbose` from a real Windows 11
 * host (WSL_UTF8 unset, so UTF-16LE). Pins both the decoder and the column
 * widths the parser has to cope with.
 */
const REAL_UTF16LE_LIST = Buffer.from(
  'IAAgAE4AQQBNAEUAIAAgACAAIAAgACAAIAAgACAAIAAgACAAUwBUAEEAVABFACAAIAAgACAAIAAgACAAIAAgACAAIABWAEUAUgBTAEkATwBOAA0ACgAqACAAVQBiAHUAbgB0AHUALQAyADQALgAwADQAIAAgACAAIABSAHUAbgBuAGkAbgBnACAAIAAgACAAIAAgACAAIAAgADIADQAKAA==',
  'base64'
)

describe('real wsl.exe output', () => {
  it('decodes and parses a capture from an actual Windows host', () => {
    const decoded = decodeWslOutput(REAL_UTF16LE_LIST)
    expect(decoded).toContain('Ubuntu-24.04')
    expect(parseDistroList(decoded)).toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }
    ])
  })

  it('would silently produce garbage if the UTF-16 bytes were read as UTF-8', () => {
    // The failure mode the WSL_UTF8 env var exists to prevent.
    const naive = REAL_UTF16LE_LIST.toString('utf8')
    expect(naive.includes(String.fromCharCode(0))).toBe(true)
    expect(parseDistroList(naive)).not.toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }
    ])
  })
})

describe('decodeWslOutput', () => {
  it('decodes UTF-8 output as-is', () => {
    expect(decodeWslOutput(Buffer.from('Ubuntu-24.04\n', 'utf8'))).toBe('Ubuntu-24.04\n')
  })

  it('preserves UTF-8 output containing NUL delimiters', () => {
    const gitOutput = '0123456789abcdef\u0000Commit message\u00002026-08-19T10:00:00+02:00\u0000'
    expect(decodeWslOutput(Buffer.from(gitOutput, 'utf8'))).toBe(gitOutput)
  })

  it('recovers rather than yielding NUL-riddled text when WSL_UTF8 is ignored', () => {
    const utf16 = Buffer.from('Ubuntu-24.04\n', 'utf16le')
    const decoded = decodeWslOutput(utf16)
    expect(decoded).toBe('Ubuntu-24.04\n')
    expect(decoded).not.toContain('\u0000')
  })
})

describe('parseWslUncPath', () => {
  it('parses \\\\wsl$ paths', () => {
    expect(parseWslUncPath('\\\\wsl$\\Ubuntu-24.04\\home\\me\\src\\app')).toEqual({
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app'
    })
  })

  it('parses \\\\wsl.localhost paths', () => {
    expect(parseWslUncPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\src')).toEqual({
      distro: 'Ubuntu-24.04',
      path: '/home/me/src'
    })
  })

  it('treats the distro root as /', () => {
    expect(parseWslUncPath('\\\\wsl.localhost\\Ubuntu-24.04')).toEqual({
      distro: 'Ubuntu-24.04',
      path: '/'
    })
  })

  it('ignores ordinary Windows and Linux paths', () => {
    expect(parseWslUncPath('C:\\src\\app')).toBeNull()
    expect(parseWslUncPath('/home/me/src')).toBeNull()
    expect(parseWslUncPath('\\\\server\\share\\dir')).toBeNull()
  })
})

describe('path classification', () => {
  it('recognises Windows drive paths', () => {
    expect(isWindowsDrivePath('C:\\src\\app')).toBe(true)
    expect(isWindowsDrivePath('d:/src/app')).toBe(true)
    expect(isWindowsDrivePath('/home/me')).toBe(false)
  })

  it('recognises slow /mnt crossings', () => {
    expect(isWslMountedWindowsPath('/mnt/c/src/app')).toBe(true)
    expect(isWslMountedWindowsPath('/mnt/c')).toBe(true)
    expect(isWslMountedWindowsPath('/home/me/mnt/c')).toBe(false)
    expect(isWslMountedWindowsPath('/mnternal/thing')).toBe(false)
  })

  it('builds a UNC fallback path', () => {
    expect(uncPathFor('Ubuntu-24.04', '/home/me/src')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\src'
    )
  })
})

beforeEach(() => {
  vi.mocked(runWsl).mockReset()
})

describe('WSL path resolution', () => {
  it('expands home shorthand and stores the canonical directory', async () => {
    vi.mocked(runWsl).mockResolvedValue({
      stdout: '/home/me/dev/testmde\n',
      stderr: '',
      code: 0
    })

    await expect(canonicalizeWslPath('Ubuntu-24.04', '~/dev/testmde')).resolves.toBe(
      '/home/me/dev/testmde'
    )
    await expect(resolveForTarget('wsl', 'Ubuntu-24.04', '~/dev/testmde')).resolves.toEqual({
      path: '/home/me/dev/testmde'
    })
  })

  it('executes home shorthand expansion without retaining a literal tilde', async () => {
    vi.mocked(runWsl).mockImplementation(async (args) => {
      const result = spawnSync('bash', ['-lc', args[5] ?? '', 'mde-path', '~/dev/testmde'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: '/home/tester' }
      })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.status ?? 1
      }
    })

    await expect(canonicalizeWslPath('Ubuntu-24.04', '~/dev/testmde')).resolves.toBe(
      '/home/tester/dev/testmde'
    )
  })

  it('execs the script instead of letting the default shell re-parse it', async () => {
    vi.mocked(runWsl).mockResolvedValue({ stdout: '/home/me\n', stderr: '', code: 0 })

    await canonicalizeWslPath('Ubuntu-24.04', '~')

    expect(vi.mocked(runWsl).mock.calls[0]?.[0]?.slice(0, 4)).toEqual([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'bash'
    ])
  })

  it('executes wslpath directly so Windows backslashes survive zsh', async () => {
    vi.mocked(runWsl).mockResolvedValue({ stdout: '/mnt/c/Users/TestUser/My Image.png\n', stderr: '', code: 0 })

    await expect(
      toWsl('Ubuntu-24.04', String.raw`C:\Users\TestUser\My Image.png`)
    ).resolves.toBe('/mnt/c/Users/TestUser/My Image.png')
    expect(vi.mocked(runWsl).mock.calls[0]?.[0]).toEqual([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'wslpath',
      '-u',
      String.raw`C:\Users\TestUser\My Image.png`
    ])
  })

  it('executes reverse wslpath conversion directly too', async () => {
    vi.mocked(runWsl).mockResolvedValue({ stdout: 'C:\\Users\\TestUser\\My Image.png\n', stderr: '', code: 0 })

    await expect(toWindows('Ubuntu-24.04', '/mnt/c/Users/TestUser/My Image.png')).resolves.toBe(
      'C:\\Users\\TestUser\\My Image.png'
    )
    expect(vi.mocked(runWsl).mock.calls[0]?.[0]).toEqual([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'wslpath',
      '-w',
      '/mnt/c/Users/TestUser/My Image.png'
    ])
  })
})

describe('WSL shell value probes', () => {
  const wrap = (value: string): string => `${WSL_VALUE_BEGIN}${value}${WSL_VALUE_END}`

  it('generates a syntactically valid script', () => {
    const script = wslShellValueScript('"$HOME"')
    const check = spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' })
    expect(check.status, check.stderr).toBe(0)
  })

  it('ignores whatever the login shell printed around the value', () => {
    const noisy = [
      '  /\\_/\\  fastfetch says hello',
      'nvm: using v22.11.0',
      wrap('/home/me'),
      'direnv: unloading'
    ].join('\n')

    expect(extractWslShellValue(noisy)).toBe('/home/me')
  })

  it('survives CRLF endings and a UTF-8 BOM', () => {
    expect(extractWslShellValue(`﻿banner\r\n${wrap('/home/me')}\r\n`)).toBe('/home/me')
  })

  it('takes the last marker pair so an echoed command line cannot win', () => {
    const echoed = [wrap('$mde_value'), wrap('/home/me')].join('\n')
    expect(extractWslShellValue(echoed)).toBe('/home/me')
  })

  it('reports nothing when the markers never arrived', () => {
    expect(extractWslShellValue('')).toBeNull()
    expect(extractWslShellValue('command not found: bash')).toBeNull()
    expect(extractWslShellValue(WSL_VALUE_BEGIN + '/home/me')).toBeNull()
  })

  it('retries non-interactively when the interactive shell yields nothing', async () => {
    vi.mocked(runWsl)
      .mockResolvedValueOnce({ stdout: 'rc file exploded', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: wrap('/home/me'), stderr: '', code: 0 })

    await expect(readWslShellValue('Ubuntu-24.04', '"$HOME"')).resolves.toMatchObject({
      value: '/home/me'
    })
    expect(vi.mocked(runWsl).mock.calls[0]?.[0]?.[3]).toBe('bash')
    expect(vi.mocked(runWsl).mock.calls[0]?.[0]?.[4]).toBe('-lic')
    expect(vi.mocked(runWsl).mock.calls[1]?.[0]?.[4]).toBe('-lc')
  })

  it('summarises the output when both attempts fail', async () => {
    vi.mocked(runWsl).mockResolvedValue({ stdout: '', stderr: 'no distro\n', code: 1 })

    await expect(readWslShellValue('Ubuntu-24.04', '"$HOME"')).resolves.toEqual({
      value: null,
      detail: 'no distro'
    })
  })
})

describe('assertWslLinuxPath', () => {
  it('accepts absolute paths that ordinary regexes reject', () => {
    expect(assertWslLinuxPath('/home/me', 'home directory')).toBe('/home/me')
    expect(assertWslLinuxPath('  /home/my user/.config  ', 'home directory')).toBe(
      '/home/my user/.config'
    )
    expect(assertWslLinuxPath('/home/私/.config', 'home directory')).toBe('/home/私/.config')
    expect(assertWslLinuxPath('/home/me/', 'home directory')).toBe('/home/me')
    expect(assertWslLinuxPath('/', 'home directory')).toBe('/')
  })

  it('rejects values that mean the probe failed', () => {
    expect(() => assertWslLinuxPath('', 'home directory')).toThrow(/invalid home directory/)
    expect(() => assertWslLinuxPath('home/me', 'home directory')).toThrow(/invalid home directory/)
    expect(() => assertWslLinuxPath('/home/me\nbanner', 'home directory')).toThrow(
      /invalid home directory/
    )
  })
})
