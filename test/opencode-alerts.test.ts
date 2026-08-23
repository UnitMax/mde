import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OpenCodeAlertDependencies, OpenCodeAlertWindow } from '../src/main/opencode/alerts'
import { OpenCodeAlertManager } from '../src/main/opencode/alerts'

function dependencies(window: OpenCodeAlertWindow): OpenCodeAlertDependencies {
  return {
    getWindow: () => window,
    beep: vi.fn()
  }
}

describe('OpenCode alerts', () => {
  it('defaults to enabled and persists the toggle', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-opencode-alerts-'))
    try {
      const window = {} as OpenCodeAlertWindow
      const first = new OpenCodeAlertManager(dependencies(window))
      await first.configure(directory)
      expect(first.settings()).toEqual({ enabled: true })

      await first.setEnabled(false)
      const second = new OpenCodeAlertManager(dependencies(window))
      await second.configure(directory)
      expect(second.settings()).toEqual({ enabled: false })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('flashes the taskbar and plays a sound while unfocused', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-opencode-alerts-'))
    const window = {
      isDestroyed: () => false,
      isFocused: () => false,
      flashFrame: vi.fn()
    }
    const deps = dependencies(window)
    const manager = new OpenCodeAlertManager(deps)
    try {
      await manager.configure(directory)

      manager.alert()

      expect(window.flashFrame).toHaveBeenCalledWith(true)
      expect(deps.beep).toHaveBeenCalledOnce()
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('suppresses alerts while focused and when disabled', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-opencode-alerts-'))
    let focused = true
    const window = {
      isDestroyed: () => false,
      isFocused: () => focused,
      flashFrame: vi.fn()
    }
    const deps = dependencies(window)
    const manager = new OpenCodeAlertManager(deps)
    try {
      await manager.configure(directory)

      manager.alert()
      expect(deps.beep).not.toHaveBeenCalled()
      expect(window.flashFrame).not.toHaveBeenCalled()

      focused = false
      await manager.setEnabled(false)
      manager.alert()
      expect(deps.beep).not.toHaveBeenCalled()
      expect(window.flashFrame).not.toHaveBeenCalled()
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('clears the taskbar flash when asked', () => {
    const window = {
      isDestroyed: () => false,
      isFocused: () => false,
      flashFrame: vi.fn()
    }
    const manager = new OpenCodeAlertManager(dependencies(window))

    manager.alert()
    manager.clearFlashing()

    expect(window.flashFrame).toHaveBeenLastCalledWith(false)
  })
})
