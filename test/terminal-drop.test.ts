import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DropPtyFile } from '../src/shared/ipc'
import type { Session } from '../src/shared/types'

const wslMock = vi.hoisted(() => ({
  runWslCommand: vi.fn(),
  toWsl: vi.fn()
}))

vi.mock('../src/main/wsl/distros', async () => {
  const actual = await vi.importActual<typeof import('../src/main/wsl/distros')>(
    '../src/main/wsl/distros'
  )
  return { ...actual, runWslCommand: wslMock.runWslCommand }
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
  isShellInertPath,
  resolveTerminalDrop,
  terminalDropShell
} from '../src/main/pty/drop'
import {
  fileDropUris,
  isFileDrop,
  terminalDropMode,
  terminalDropNotice,
  terminalDropQuotingNotice
} from '../src/renderer/terminal/drop'

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
    wslMock.runWslCommand.mockReset()
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
    expect(
      formatAgentDrop(['/mnt/c/Users/TestUser/My Image.png', '/tmp/other.png'], 'posix')
    ).toEqual({
      insertions: ['/mnt/c/Users/TestUser/My Image.png ', '/tmp/other.png '],
      quotedForSafety: 0
    })
  })

  it('classifies which paths a shell would act on', () => {
    expect(isShellInertPath('/tmp/My Screenshot.png', 'posix')).toBe(true)
    // Ordinary non-ASCII names must not be dragged into the quoted path.
    expect(isShellInertPath('/tmp/Berichte/Übersicht 2026.pdf', 'posix')).toBe(true)
    expect(isShellInertPath('/tmp/写真.png', 'posix')).toBe(true)

    for (const hostile of [
      '/tmp/a$(touch sentinel).png',
      '/tmp/a`touch sentinel`.png',
      '/tmp/a;touch sentinel.png',
      '/tmp/a|touch sentinel.png',
      '/tmp/a&touch sentinel.png',
      '/tmp/a>sentinel.png',
      "/tmp/it's.png",
      '/tmp/a\\b.png'
    ]) {
      expect(isShellInertPath(hostile, 'posix')).toBe(false)
    }

    // Shell-specific expansions.
    expect(isShellInertPath('C:\\Users\\Me\\%PATH%.png', 'cmd')).toBe(false)
    expect(isShellInertPath('C:\\Users\\Me\\a^b.png', 'cmd')).toBe(false)
    expect(isShellInertPath('C:\\Users\\Me\\a@b.png', 'powershell')).toBe(false)
    expect(isShellInertPath('C:\\Users\\Me\\a,b.png', 'powershell')).toBe(false)
    // A backslash is a path separator on Windows, not an escape.
    expect(isShellInertPath('C:\\Users\\Me\\image.png', 'powershell')).toBe(true)
    expect(isShellInertPath('C:\\Users\\Me\\image.png', 'cmd')).toBe(true)
  })

  it('quotes an agent-TUI drop the shell would act on, and only that one', () => {
    // The pane says TUI, but terminal output controls that state, so the
    // hostile name still has to land inert.
    expect(
      formatAgentDrop(['/tmp/plain.png', '/tmp/a$(touch sentinel).png'], 'posix')
    ).toEqual({
      insertions: ["/tmp/plain.png ", "'/tmp/a$(touch sentinel).png' "],
      quotedForSafety: 1
    })
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

  it('explains why a path was quoted in an agent pane', () => {
    expect(terminalDropQuotingNotice(1)).toContain('One path was quoted')
    expect(terminalDropQuotingNotice(3)).toContain('3 paths were quoted')
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

  it('does not paste a live command when a spoofed pane claims to be a TUI', async () => {
    // Terminal output can enter the alternate screen and never leave it, so a
    // real shell prompt can be drawing in a pane mde classifies as a TUI. A
    // dropped filename from a cloned repository must stay inert there.
    const directory = await mkdtemp(join(tmpdir(), 'mde-drop-'))
    const hostile = join(directory, 'a$(touch sentinel).png')
    const plain = join(directory, 'plain.png')
    await writeFile(hostile, '')
    await writeFile(plain, '')

    try {
      await expect(
        resolveTerminalDrop(
          session({ path: directory }),
          'linux',
          [droppedFile(plain, 'plain.png'), droppedFile(hostile, 'a$(touch sentinel).png')],
          'tui'
        )
      ).resolves.toEqual({
        insertions: [`${plain} `, `'${hostile}' `],
        acceptedCount: 2,
        rejections: [],
        quotedForSafety: 1
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves an ordinary agent-TUI drop unquoted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mde-drop-'))
    const plain = join(directory, 'My Screenshot.png')
    await writeFile(plain, '')

    try {
      await expect(
        resolveTerminalDrop(
          session({ path: directory }),
          'linux',
          [droppedFile(plain, 'My Screenshot.png')],
          'tui'
        )
      ).resolves.toEqual({
        insertions: [`${plain} `],
        acceptedCount: 1,
        rejections: []
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('translates an accessible Windows drop into the active WSL distro', async () => {
    wslMock.toWsl.mockResolvedValue('/mnt/c/Users/me/image.png')
    wslMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

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
    expect(wslMock.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      ['test', '-e', '/mnt/c/Users/me/image.png']
    )
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
    expect(wslMock.runWslCommand).not.toHaveBeenCalled()
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
    expect(wslMock.runWslCommand).not.toHaveBeenCalled()
  })

  it('reports a file that WSL cannot see as inaccessible', async () => {
    wslMock.toWsl.mockResolvedValue('/mnt/c/Users/me/missing.png')
    wslMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })

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
