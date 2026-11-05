import { describe, expect, it } from 'vitest'
import { directoryLeafName } from '../src/renderer/lib/terminal-title'

describe('directoryLeafName', () => {
  it('returns the last folder of a POSIX path, ignoring trailing and repeated separators', () => {
    expect(directoryLeafName('/home/me/app')).toBe('app')
    expect(directoryLeafName('/home/me/app/')).toBe('app')
    expect(directoryLeafName('/home//me///app//')).toBe('app')
    expect(directoryLeafName('relative/dir')).toBe('dir')
  })

  it('understands Windows separators and drive roots', () => {
    expect(directoryLeafName('C:\\Users\\Me\\app')).toBe('app')
    expect(directoryLeafName('C:\\Users\\Me\\app\\')).toBe('app')
    expect(directoryLeafName('\\\\wsl.localhost\\Debian\\home\\me')).toBe('me')
    expect(directoryLeafName('C:\\')).toBe('C:')
  })

  it('names the filesystem root and gives up on an unknown directory', () => {
    expect(directoryLeafName('/')).toBe('/')
    expect(directoryLeafName('//')).toBe('/')
    expect(directoryLeafName('')).toBeNull()
    expect(directoryLeafName('   ')).toBeNull()
    expect(directoryLeafName(null)).toBeNull()
    expect(directoryLeafName(undefined)).toBeNull()
  })
})
