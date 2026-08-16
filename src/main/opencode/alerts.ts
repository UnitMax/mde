import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { OpenCodeAlertEvent, OpenCodeAlertSettings } from '@shared/types'

const SETTINGS_FILE = 'opencode-notifications.json'

export interface OpenCodeAlertWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  flashFrame(flag: boolean): void
}

export interface OpenCodeAlertDependencies {
  getWindow(): OpenCodeAlertWindow | null
  beep(): void
}

function settingsFile(directory: string): string {
  return join(directory, SETTINGS_FILE)
}

export class OpenCodeAlertManager {
  private enabled = true
  private settingsDirectory: string | null = null
  private flashing = false

  constructor(private readonly dependencies: OpenCodeAlertDependencies) {}

  async configure(settingsDirectory: string): Promise<void> {
    this.settingsDirectory = settingsDirectory
    try {
      const source = await fs.readFile(settingsFile(settingsDirectory), 'utf8')
      const parsed: unknown = JSON.parse(source)
      this.enabled =
        typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).enabled !== false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[opencode-alerts] could not read settings; defaulting to enabled:', error)
      }
      this.enabled = true
    }
  }

  settings(): OpenCodeAlertSettings {
    return { enabled: this.enabled }
  }

  async setEnabled(enabled: boolean): Promise<OpenCodeAlertSettings> {
    const previous = this.enabled
    this.enabled = enabled
    try {
      await this.persistSettings()
    } catch (error) {
      this.enabled = previous
      throw error
    }
    if (!enabled) this.clearFlashing()
    return this.settings()
  }

  alert(_event: OpenCodeAlertEvent): void {
    if (!this.enabled) return
    const window = this.dependencies.getWindow()
    if (!window || window.isDestroyed() || window.isFocused()) return

    window.flashFrame(true)
    this.flashing = true
    try {
      this.dependencies.beep()
    } catch (error) {
      console.warn('[opencode-alerts] could not play sound:', error)
    }
  }

  clearFlashing(): void {
    const window = this.dependencies.getWindow()
    if (this.flashing && window && !window.isDestroyed()) window.flashFrame(false)
    this.flashing = false
  }

  dispose(): void {
    this.clearFlashing()
  }

  private async persistSettings(): Promise<void> {
    if (!this.settingsDirectory) return
    await fs.mkdir(this.settingsDirectory, { recursive: true })
    const target = settingsFile(this.settingsDirectory)
    const temporary = `${target}.tmp-${randomUUID()}`
    await fs.writeFile(temporary, `${JSON.stringify({ enabled: this.enabled })}\n`, 'utf8')
    await fs.rename(temporary, target)
  }
}
