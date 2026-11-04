import { describe, expect, it, vi } from 'vitest'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession } from '../src/shared/inbox-terminal'
import { terminalSessionResolver } from '../src/main/inbox/terminal'
import type { Distro, Session } from '../src/shared/types'

const distro = (name: string, isDefault = false): Distro => ({ name, state: 'Running', version: 2, isDefault })
const stored: Session = { id: 'ses-1', projectId: 'p', name: 'App', kind: 'native', path: '/home/me/app', createdAt: '' }

describe('the Inbox terminal session', () => {
  it('starts a native shell in the home directory off Windows', () => {
    expect(inboxTerminalSession('darwin', [], '/Users/me')).toEqual({
      id: INBOX_TERMINAL_SESSION_ID, projectId: '', name: 'Terminal', createdAt: '', kind: 'native', path: '/Users/me',
    })
    expect(inboxTerminalSession('linux', [], '/home/me')?.kind).toBe('native')
  })

  it('starts in the home directory of the default WSL distro on Windows, `~` to wsl.exe', () => {
    const session = inboxTerminalSession('win32', [distro('Debian'), distro('Ubuntu', true)], 'C:\\Users\\Me')
    expect(session).toMatchObject({ kind: 'wsl', distro: 'Ubuntu', path: '~' })
    expect(inboxTerminalSession('win32', [distro('Debian'), distro('Ubuntu')], 'C:\\Users\\Me')).toMatchObject({ distro: 'Debian' })
  })

  it('has no session on Windows without a distro, and never uses the Windows home directory there', () => {
    expect(inboxTerminalSession('win32', [], 'C:\\Users\\Me')).toBeNull()
  })
})

describe('the terminal session lookup', () => {
  const resolver = (overrides: Partial<Parameters<typeof terminalSessionResolver>[0]> = {}) => {
    const dependencies = {
      getSession: vi.fn(async (id: string) => id === stored.id ? stored : null),
      listDistros: vi.fn(async () => [distro('Ubuntu', true)]),
      platform: 'darwin',
      home: () => '/Users/me',
      ...overrides,
    }
    return { dependencies, resolve: terminalSessionResolver(dependencies) }
  }

  it('hands workspace sessions through and builds the Inbox terminal for its reserved ID', async () => {
    const { resolve, dependencies } = resolver()
    expect(await resolve('ses-1')).toBe(stored)
    expect(await resolve('missing')).toBeNull()
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ kind: 'native', path: '/Users/me' })
    expect(dependencies.getSession).not.toHaveBeenCalledWith(INBOX_TERMINAL_SESSION_ID)
  })

  it('does not ask WSL for distros off Windows, and asks once on Windows however often it is used', async () => {
    const mac = resolver()
    await mac.resolve(INBOX_TERMINAL_SESSION_ID)
    expect(mac.dependencies.listDistros).not.toHaveBeenCalled()

    const windows = resolver({ platform: 'win32' })
    const [first, second] = await Promise.all([windows.resolve(INBOX_TERMINAL_SESSION_ID), windows.resolve(INBOX_TERMINAL_SESSION_ID)])
    await windows.resolve(INBOX_TERMINAL_SESSION_ID)
    expect(first).toMatchObject({ kind: 'wsl', distro: 'Ubuntu', path: '~' })
    expect(second).toBe(first)
    expect(windows.dependencies.listDistros).toHaveBeenCalledTimes(1)
  })

  it('tries again after a lookup that found no distro or failed', async () => {
    const listDistros = vi.fn<() => Promise<Distro[]>>().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('wsl.exe failed')).mockResolvedValue([distro('Ubuntu', true)])
    const { resolve } = resolver({ platform: 'win32', listDistros })
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toBeNull()
    await expect(resolve(INBOX_TERMINAL_SESSION_ID)).rejects.toThrow('wsl.exe failed')
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ distro: 'Ubuntu' })
    expect(listDistros).toHaveBeenCalledTimes(3)
  })
})
