import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/wsl/distros', async () => ({
  ...(await vi.importActual<typeof import('../src/main/wsl/distros')>('../src/main/wsl/distros')),
  runWsl: vi.fn()
}))

import { decodeWslOutput, parseDistroList, parseWslHostAddress, runWsl } from '../src/main/wsl/distros'
import {
  canonicalizeWslPath,
  isWindowsDrivePath,
  isWslMountedWindowsPath,
  parseWslUncPath,
  resolveForTarget,
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

describe('parseWslHostAddress', () => {
  it('returns the first IPv4 address from hostname -I output', () => {
    expect(parseWslHostAddress('172.29.246.101 192.168.1.25\n')).toBe('172.29.246.101')
  })

  it('ignores invalid and IPv6-only output', () => {
    expect(parseWslHostAddress('fe80::1 999.1.1.1 not-an-address\n')).toBeNull()
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

describe('WSL path resolution', () => {
  it('expands home shorthand and stores the canonical directory', async () => {
    vi.mocked(runWsl).mockResolvedValue({
      stdout: '/home/max/dev/testmde\n',
      stderr: '',
      code: 0
    })

    await expect(canonicalizeWslPath('Ubuntu-24.04', '~/dev/testmde')).resolves.toBe(
      '/home/max/dev/testmde'
    )
    await expect(resolveForTarget('wsl', 'Ubuntu-24.04', '~/dev/testmde')).resolves.toEqual({
      path: '/home/max/dev/testmde'
    })
  })
})
