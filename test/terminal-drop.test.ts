import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DropPtyFile } from '../src/shared/ipc'
import type { Session } from '../src/shared/types'

const wslMock = vi.hoisted(() => ({
  runWsl: vi.fn(),
  toWsl: vi.fn()
}))

vi.mock('../src/main/wsl/distros', async () => {
  const actual = await vi.importActual<typeof import('../src/main/wsl/distros')>(
    '../src/main/wsl/distros'
  )
  return { ...actual, runWsl: wslMock.runWsl }
})

vi.mock('../src/main/wsl/paths', async () => {
  const actual = await vi.importActual<typeof import('../src/main/wsl/paths')>(
    '../src/main/wsl/paths'
  )
  return { ...actual, toWsl: wslMock.toWsl }
})

import {
  fileUriToNativePath,
  formatAgentDrop,
  formatTerminalDrop,
  isSafeDroppedPath,
  resolveTerminalDrop,
  terminalDropShell
} from '../src/main/pty/drop'
import { fileDropUris, isFileDrop, terminalDropMode, terminalDropNotice } from '../src/renderer/terminal/drop'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'App',
    kind: 'native',
    path: '/tmp',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function droppedFile(nativePath?: string, name = 'image.png'): DropPtyFile {
  return { name, ...(nativePath ? { nativePath } : {}) }
}

describe('terminal file drops', () => {
  beforeEach(() => {
    wslMock.runWsl.mockReset()
    wslMock.toWsl.mockReset()
  })

  it('formats POSIX paths with safe single-quote escaping', () => {
    expect(
      formatTerminalDrop(['/tmp/My Screenshot.png', "/tmp/it's.png"], 'posix')
    ).toBe("'/tmp/My Screenshot.png' '/tmp/it'\\''s.png' ")
  })

  it('formats PowerShell and cmd paths', () => {
    expect(formatTerminalDrop([String.raw`C:\Users\O'Brien\image.png`], 'powershell')).toBe(
      "'C:\\Users\\O''Brien\\image.png' "
    )
    expect(formatTerminalDrop([String.raw`C:\Users\Me\image.png`], 'cmd')).toBe(
      '"C:\\Users\\Me\\image.png" '
    )
  })

  it('keeps agent-TUI paths separate', () => {
    expect(formatAgentDrop(['/mnt/c/Users/TestUser/My Image.png', '/tmp/other.png'])).toEqual([
      '/mnt/c/Users/TestUser/My Image.png ',
      '/tmp/other.png '
    ])
  })

  it('selects shell rules for native and WSL terminals', () => {
    expect(terminalDropShell(session(), 'darwin')).toBe('posix')
    expect(terminalDropShell(session({ shell: 'cmd.exe' }), 'win32')).toBe('cmd')
    expect(terminalDropShell(session({ shell: 'powershell.exe' }), 'win32')).toBe('powershell')
    expect(
      terminalDropShell(session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me' }), 'win32')
    ).toBe('posix')
  })

  it('rejects control characters before they reach a shell', () => {
    expect(isSafeDroppedPath('/tmp/normal.png')).toBe(true)
    expect(isSafeDroppedPath('/tmp/line\nfeed.png')).toBe(false)
    expect(isSafeDroppedPath('/tmp/escape\u001b.png')).toBe(false)
  })

  it('identifies file drags without claiming other drag payloads', () => {
    const makeTransfer = (types: string[], kinds: string[] = []): Pick<DataTransfer, 'types' | 'items'> => ({
      types,
      items: {
        length: kinds.length,
        ...Object.fromEntries(kinds.map((kind, index) => [index, { kind }]))
      } as unknown as DataTransferItemList
    })

    expect(isFileDrop(makeTransfer(['text/plain']))).toBe(false)
    expect(isFileDrop(makeTransfer(['Files']))).toBe(true)
    expect(isFileDrop(makeTransfer(['text/plain'], ['file']))).toBe(true)
  })

  it('extracts only file URLs from a URI-list payload', () => {
    expect(fileDropUris('# comment\nfile:///tmp/My%20Image.png\nhttps://example.com')).toEqual([
      'file:///tmp/My%20Image.png'
    ])
  })

  it('maps agent buffer state to the drop mode', () => {
    expect(terminalDropMode('alternate')).toBe('tui')
    expect(terminalDropMode('normal')).toBe('shell')
  })

  it('explains drop rejection causes without exposing paths', () => {
    expect(
      terminalDropNotice([
        { name: 'screenshot.png', code: 'translation-failed', distro: 'Ubuntu-24.04' }
      ])
    ).toContain('could not translate')
    expect(
      terminalDropNotice([
        { name: 'screenshot.png', code: 'inaccessible', distro: 'Ubuntu-24.04' }
      ])
    ).not.toContain('/mnt/')
  })

  it('converts file URLs for Windows and POSIX hosts', () => {
    expect(fileUriToNativePath('file:///C:/Users/TestUser/My%20Image.png', 'win32')).toBe(
      'C:\\Users\\TestUser\\My Image.png'
    )
    expect(fileUriToNativePath('file:///Users/test-user/My%20Image.png', 'darwin')).toBe(
      '/Users/test-user/My Image.png'
    )
    expect(fileUriToNativePath('https://example.com/image.png', 'win32')).toBeNull()
  })

  it('resolves a file URL when Electron did not expose a native path', async () => {
    await expect(
      resolveTerminalDrop(
        session(),
        'linux',
        [{ name: 'tmp', fileUri: 'file:///tmp' }],
        'shell'
      )
    ).resolves.toEqual({
      insertions: ["'/tmp' "],
      acceptedCount: 1,
      rejections: []
    })
  })

  it('translates an accessible Windows drop into the active WSL distro', async () => {
    wslMock.toWsl.mockResolvedValue('/mnt/c/Users/me/image.png')
    wslMock.runWsl.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const result = await resolveTerminalDrop(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me' }),
      'win32',
      [droppedFile(String.raw`C:\Users\me\image.png`)],
      'tui'
    )

    expect(result).toEqual({
      insertions: ['/mnt/c/Users/me/image.png '],
      acceptedCount: 1,
      rejections: []
    })
    expect(wslMock.runWsl).toHaveBeenCalledWith([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'test',
      '-e',
      '/mnt/c/Users/me/image.png'
    ])
  })

  it('rejects drops from a different WSL distro', async () => {
    const result = await resolveTerminalDrop(
      session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me' }),
      'win32',
      [droppedFile('\\\\wsl.localhost\\Debian\\home\\me\\image.png')],
      'tui'
    )

    expect(result).toEqual({
      insertions: [],
      acceptedCount: 0,
      rejections: [{ name: 'image.png', code: 'wrong-distro', distro: 'Ubuntu-24.04' }]
    })
    expect(wslMock.runWsl).not.toHaveBeenCalled()
  })

  it('reports a WSL translation failure separately from an inaccessible file', async () => {
    wslMock.toWsl.mockResolvedValue(null)

    await expect(
      resolveTerminalDrop(
        session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me' }),
        'win32',
        [droppedFile(String.raw`C:\Users\me\image.png`)],
        'tui'
      )
    ).resolves.toEqual({
      insertions: [],
      acceptedCount: 0,
      rejections: [{ name: 'image.png', code: 'translation-failed', distro: 'Ubuntu-24.04' }]
    })
    expect(wslMock.runWsl).not.toHaveBeenCalled()
  })

  it('reports a file that WSL cannot see as inaccessible', async () => {
    wslMock.toWsl.mockResolvedValue('/mnt/c/Users/me/missing.png')
    wslMock.runWsl.mockResolvedValue({ stdout: '', stderr: '', code: 1 })

    await expect(
      resolveTerminalDrop(
        session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me' }),
        'win32',
        [droppedFile(String.raw`C:\Users\me\missing.png`)],
        'tui'
      )
    ).resolves.toEqual({
      insertions: [],
      acceptedCount: 0,
      rejections: [{ name: 'image.png', code: 'inaccessible', distro: 'Ubuntu-24.04' }]
    })
  })

  it('reports an unresolved native path', async () => {
    await expect(
      resolveTerminalDrop(session(), 'linux', [droppedFile()], 'shell')
    ).resolves.toEqual({
      insertions: [],
      acceptedCount: 0,
      rejections: [{ name: 'image.png', code: 'path-unresolved' }]
    })
  })
})
