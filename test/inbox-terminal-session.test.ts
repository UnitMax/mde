import { describe, expect, it, vi } from 'vitest'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession } from '../src/shared/inbox-terminal'
import { terminalSessionResolver } from '../src/main/inbox/terminal'
import type { Distro, Session } from '../src/shared/types'

const distro = (name: string, isDefault = false): Distro => ({ name, state: 'Running', version: 2, isDefault })
const stored: Session = { id: 'ses-1', name: 'App', kind: 'native', createdAt: '' }

describe('the Inbox terminal session', () => {
  it('uses a native shell environment off Windows', () => {
    expect(inboxTerminalSession('darwin', [])).toEqual({
      id: INBOX_TERMINAL_SESSION_ID, name: 'Terminal', createdAt: '', kind: 'native',
    })
    expect(inboxTerminalSession('linux', [])?.kind).toBe('native')
  })

  it('uses the default WSL distro on Windows', () => {
    const session = inboxTerminalSession('win32', [distro('Debian'), distro('Ubuntu', true)])
    expect(session).toMatchObject({ kind: 'wsl', distro: 'Ubuntu' })
    expect(inboxTerminalSession('win32', [distro('Debian'), distro('Ubuntu')])).toMatchObject({ distro: 'Debian' })
  })

  it('has no session on Windows without a distro', () => {
    expect(inboxTerminalSession('win32', [])).toBeNull()
  })

  it('uses the chosen distro, and never silently substitutes another when it is missing', () => {
    const distros = [distro('Debian'), distro('Ubuntu', true)]
    expect(inboxTerminalSession('win32', distros, 'Debian')).toMatchObject({ distro: 'Debian' })
    expect(inboxTerminalSession('win32', distros, 'Missing')).toBeNull()
  })
})

describe('the terminal session lookup', () => {
  const resolver = (overrides: Partial<Parameters<typeof terminalSessionResolver>[0]> = {}) => {
    const dependencies = {
      getSession: vi.fn(async (id: string) => id === stored.id ? stored : null),
      listDistros: vi.fn(async () => [distro('Ubuntu', true)]),
      platform: 'darwin',
      ...overrides,
    }
    return { dependencies, resolve: terminalSessionResolver(dependencies) }
  }

  it('hands workspace sessions through and builds the Inbox terminal for its reserved ID', async () => {
    const { resolve, dependencies } = resolver()
    expect(await resolve('ses-1')).toBe(stored)
    expect(await resolve('missing')).toBeNull()
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ kind: 'native' })
    expect(dependencies.getSession).not.toHaveBeenCalledWith(INBOX_TERMINAL_SESSION_ID)
  })

  it('does not ask WSL for distros off Windows, and asks once on Windows however often it is used', async () => {
    const mac = resolver()
    await mac.resolve(INBOX_TERMINAL_SESSION_ID)
    expect(mac.dependencies.listDistros).not.toHaveBeenCalled()

    const windows = resolver({ platform: 'win32' })
    const [first, second] = await Promise.all([windows.resolve(INBOX_TERMINAL_SESSION_ID), windows.resolve(INBOX_TERMINAL_SESSION_ID)])
    await windows.resolve(INBOX_TERMINAL_SESSION_ID)
    expect(first).toMatchObject({ kind: 'wsl', distro: 'Ubuntu' })
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

  it('uses the updated preference for subsequent terminal and filesystem requests', async () => {
    const distros = [distro('Ubuntu', true), distro('Debian')]
    const { resolve } = resolver({
      platform: 'win32',
      listDistros: vi.fn(async () => distros),
    })
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ distro: 'Ubuntu' })
    resolve.setInboxSession(inboxTerminalSession('win32', distros, 'Debian'))
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ distro: 'Debian' })
    resolve.setInboxSession(inboxTerminalSession('win32', distros))
    expect(await resolve(INBOX_TERMINAL_SESSION_ID)).toMatchObject({ distro: 'Ubuntu' })
  })
})
