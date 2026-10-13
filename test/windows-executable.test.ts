import { describe, expect, it, vi } from 'vitest'
import { assertWindowsExecutablePath, createWindowsExecutableResolver } from '../src/main/windows-executable'

const systemRoot = 'D:\\Windows installation'
const wsl = `${systemRoot}\\System32\\wsl.exe`
const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

function dependencies() {
  return {
    environment: { sYsTeMrOoT: systemRoot, PATH: 'C:\\Projects\\Hostile' },
    canonicalize: vi.fn((path: string) => path),
    readStats: vi.fn((_path: string): { isFile(): boolean } => ({ isFile: () => true })),
  }
}

describe('Windows executable resolution', () => {
  it('pins WSL and built-in shells to an unusual Windows installation without PATH lookup', () => {
    const deps = dependencies()
    const resolver = createWindowsExecutableResolver(deps)

    expect(resolver.wsl()).toEqual({ file: wsl, cwd: `${systemRoot}\\System32` })
    expect(resolver.shell()).toBe(powershell)
    expect(resolver.shell('PowerShell')).toBe(powershell)
    expect(resolver.shell('POWERSHELL.EXE')).toBe(powershell)
    expect(resolver.shell('cmd')).toBe(`${systemRoot}\\System32\\cmd.exe`)
    expect(resolver.shell('CMD.EXE')).toBe(`${systemRoot}\\System32\\cmd.exe`)
    expect(deps.readStats.mock.calls.flat()).not.toContain('C:\\Projects\\Hostile\\wsl.exe')
  })

  it('only checks requested executables and caches successful resolutions', () => {
    const deps = dependencies()
    const resolver = createWindowsExecutableResolver(deps)
    expect(deps.canonicalize).not.toHaveBeenCalled()
    resolver.shell()
    resolver.shell()
    resolver.shell('powershell')
    expect(deps.readStats).toHaveBeenCalledExactlyOnceWith(powershell)
    expect(deps.readStats).not.toHaveBeenCalledWith(wsl)
  })

  it('a missing WSL does not disable native PowerShell and is never replaced through PATH', () => {
    const deps = dependencies()
    deps.readStats.mockImplementation((path?: string) => {
      if (path === wsl) throw new Error('ENOENT')
      return { isFile: () => true }
    })
    const resolver = createWindowsExecutableResolver(deps)
    expect(() => resolver.wsl()).toThrow('Windows WSL executable is unavailable')
    expect(resolver.shell()).toBe(powershell)
    expect(deps.readStats.mock.calls.flat()).not.toContain('C:\\Projects\\Hostile\\wsl.exe')
  })

  it.each([undefined, '', 'Windows', 'D:Windows', '\\Windows', '\\\\server\\Windows', 'D:\\Windows\\..\\Hostile', 'D:\\Windows:stream', 'D:\\Windows\n'])('rejects unsafe SystemRoot %j before filesystem access', (value) => {
    const deps = { ...dependencies(), environment: { SystemRoot: value } }
    const resolver = createWindowsExecutableResolver(deps)
    expect(() => resolver.wsl()).toThrow()
    expect(deps.canonicalize).not.toHaveBeenCalled()
    expect(deps.readStats).not.toHaveBeenCalled()
  })

  it('rejects a system executable redirected outside the Windows tree', () => {
    const deps = dependencies()
    deps.canonicalize.mockImplementation((path) => path === wsl ? 'C:\\Projects\\Hostile\\wsl.exe' : path)
    expect(() => createWindowsExecutableResolver(deps).wsl()).toThrow('outside the Windows installation')
  })

  it('does not let a cached custom-shell resolution bypass system-program containment', () => {
    const deps = dependencies()
    const redirected = 'C:\\Tools\\custom-shell.exe'
    deps.canonicalize.mockImplementation((path) => path === wsl ? redirected : path)
    const resolver = createWindowsExecutableResolver(deps)
    expect(resolver.shell(wsl)).toBe(redirected)
    expect(() => resolver.wsl()).toThrow('outside the Windows installation')
  })

  it('rejects a directory or missing executable without falling back', () => {
    const deps = dependencies()
    deps.readStats.mockReturnValue({ isFile: () => false })
    expect(() => createWindowsExecutableResolver(deps).shell()).toThrow('Windows PowerShell is unavailable')
    deps.readStats.mockImplementation(() => { throw new Error('ENOENT') })
    expect(() => createWindowsExecutableResolver(deps).shell()).toThrow('Windows PowerShell is unavailable')
  })

  it('accepts a full custom shell path without requiring WSL or SystemRoot', () => {
    const deps = { ...dependencies(), environment: {} }
    expect(createWindowsExecutableResolver(deps).shell('E:/Tools/PowerShell 7/pwsh.exe'))
      .toBe('E:\\Tools\\PowerShell 7\\pwsh.exe')
  })

  it.each(['pwsh', 'pwsh.exe', 'zsh.exe', '.\\shell.exe', 'E:shell.exe', '\\shell.exe', 'E:\\Tools\\..\\shell.exe', 'E:\\Tools\\shell.exe:stream', '\\\\server\\share\\shell.exe', 'E:\\Tools\\shell.exe\u0000'])('refuses ambiguous or unsafe custom shell %j', (shell) => {
    const deps = dependencies()
    expect(() => createWindowsExecutableResolver(deps).shell(shell)).toThrow()
    expect(deps.readStats).not.toHaveBeenCalled()
  })

  it('does not accept command scripts as native shell executables', () => {
    expect(() => createWindowsExecutableResolver(dependencies()).shell('E:\\Tools\\shell.cmd'))
      .toThrow('must be an .exe or .com')
  })

  it('rejects root-relative paths even though win32.isAbsolute accepts them', () => {
    expect(() => assertWindowsExecutablePath('\\System32\\wsl.exe')).toThrow('full Windows drive path')
  })
})
