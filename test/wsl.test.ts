import { describe, expect, it } from 'vitest'
import { decodeWslOutput, parseDistroList } from '../src/main/wsl/distros'
import {
  isWindowsDrivePath,
  isWslMountedWindowsPath,
  parseWslUncPath,
  uncPathFor
} from '../src/main/wsl/paths'
import { validateProject, validateProjectList } from '../src/main/store/projects'

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

describe('decodeWslOutput', () => {
  it('decodes UTF-8 output as-is', () => {
    expect(decodeWslOutput(Buffer.from('Ubuntu-24.04\n', 'utf8'))).toBe('Ubuntu-24.04\n')
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

describe('project validation', () => {
  const valid = {
    id: 'abc',
    name: 'app',
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    path: '/home/me/src/app',
    createdAt: '2026-01-01T00:00:00.000Z'
  }

  it('accepts a well-formed project', () => {
    expect(validateProject(valid)).toEqual(valid)
  })

  it('rejects a WSL project with no distro', () => {
    expect(validateProject({ ...valid, distro: undefined })).toBeNull()
  })

  it('rejects unknown kinds and missing fields', () => {
    expect(validateProject({ ...valid, kind: 'ssh' })).toBeNull()
    expect(validateProject({ ...valid, path: '' })).toBeNull()
    expect(validateProject(null)).toBeNull()
    expect(validateProject('nope')).toBeNull()
  })

  it('drops malformed and duplicate entries instead of throwing', () => {
    const list = validateProjectList([valid, { junk: true }, valid, null])
    expect(list).toHaveLength(1)
  })

  it('returns an empty list when the file is not an array', () => {
    expect(validateProjectList({ projects: [] })).toEqual([])
  })
})
