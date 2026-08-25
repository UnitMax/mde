import { describe, expect, it, vi } from 'vitest'
import { installNodePty } from '../scripts/install-node-pty.mjs'

describe('node-pty installation', () => {
  it('uses shipped prebuilt binaries on Windows', () => {
    const spawn = vi.fn()

    expect(installNodePty({ platform: 'win32', spawn })).toBe(0)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rebuilds node-pty for Electron on platforms without a Windows prebuild', () => {
    const spawn = vi.fn(() => ({ status: 0 }))

    expect(installNodePty({
      platform: 'linux',
      rootDirectory: '/project',
      spawn,
    })).toBe(0)
    expect(spawn).toHaveBeenCalledWith(
      '/project/node_modules/.bin/electron-rebuild',
      ['--force', '--only', 'node-pty'],
      { cwd: '/project', stdio: 'inherit' },
    )
  })

  it('fails when the Electron rebuild fails', () => {
    const spawn = vi.fn(() => ({ status: 1 }))

    expect(() => installNodePty({
      platform: 'linux',
      rootDirectory: '/project',
      spawn,
    })).toThrow(/exit code 1/)
  })
})
