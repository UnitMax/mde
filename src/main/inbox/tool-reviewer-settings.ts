import { promises as fs } from 'node:fs'
import {
  TOOL_REVIEWER_LIMITS,
  toolReviewerModelError,
  toolReviewerUrlError,
  type ToolReviewerSettings,
  type ToolReviewerSettingsUpdate,
} from '@shared/tool-reviewer'
import { writeTextAtomic } from '../store/atomic-json'
import type { ReviewEndpoint } from './tool-reviewer'

/** How the API key is kept: encrypted by the operating system's keychain, through Electron's safeStorage. */
export interface KeyCipher {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

interface Stored {
  baseUrl: string
  model: string
  askMediumRisk: boolean
  /** The encrypted key, base64. */
  key?: string
}

const EMPTY: Stored = { baseUrl: '', model: '', askMediumRisk: true }

/**
 * The tool reviewer's settings, in `tool-reviewer.json` in MDE's data folder. The API key is stored only encrypted,
 * and only read back here, when a review needs it: the renderer learns whether one is saved, never what it is.
 * Where the system offers no encryption a key is refused rather than written in the clear.
 */
export class ToolReviewerSettingsStore {
  private cached: Stored | null = null

  constructor(private readonly file: string, private readonly cipher: KeyCipher) {}

  async get(): Promise<ToolReviewerSettings> {
    const stored = await this.read()
    return { baseUrl: stored.baseUrl, model: stored.model, askMediumRisk: stored.askMediumRisk, hasKey: Boolean(stored.key) }
  }

  async save(update: ToolReviewerSettingsUpdate): Promise<ToolReviewerSettings> {
    const baseUrl = update.baseUrl.trim()
    const model = update.model.trim()
    // An empty URL and model turn the reviewer off; anything else must be usable.
    if (baseUrl || model) {
      const problem = toolReviewerUrlError(baseUrl) ?? toolReviewerModelError(model)
      if (problem) throw new Error(problem)
    }
    const current = await this.read()
    let key = current.key
    if (update.key === null) key = undefined
    else if (typeof update.key === 'string' && update.key.trim()) {
      const text = update.key.trim()
      if (text.length > TOOL_REVIEWER_LIMITS.key || /[\s\u0000-\u001f\u007f]/.test(text)) throw new Error('That does not look like an API key.')
      if (!this.cipher.available()) throw new Error('This system offers MDE no way to store the key encrypted, so it is not saved.')
      key = this.cipher.encrypt(text).toString('base64')
    }
    const next: Stored = { baseUrl, model, askMediumRisk: update.askMediumRisk, ...(key ? { key } : {}) }
    await writeTextAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`, 0o600)
    this.cached = next
    return this.get()
  }

  /** What a review needs to call the model, key included; null while the reviewer is not set up. */
  async endpoint(): Promise<ReviewEndpoint | null> {
    const stored = await this.read()
    if (!stored.baseUrl || !stored.model || toolReviewerUrlError(stored.baseUrl) || toolReviewerModelError(stored.model)) return null
    let key: string | undefined
    if (stored.key) {
      try {
        key = this.cipher.decrypt(Buffer.from(stored.key, 'base64'))
      } catch {
        // A key encrypted by another user or machine cannot be read; the reviewer then counts as not set up.
        return null
      }
    }
    return { baseUrl: stored.baseUrl, model: stored.model, askMediumRisk: stored.askMediumRisk, ...(key ? { key } : {}) }
  }

  private async read(): Promise<Stored> {
    if (this.cached) return this.cached
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch {
      parsed = null
    }
    const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const text = (entry: unknown, limit: number) => typeof entry === 'string' && entry.length <= limit ? entry : ''
    this.cached = {
      baseUrl: text(value.baseUrl, TOOL_REVIEWER_LIMITS.baseUrl),
      model: text(value.model, TOOL_REVIEWER_LIMITS.model),
      askMediumRisk: value.askMediumRisk !== false,
      ...(typeof value.key === 'string' && value.key && value.key.length <= 16_384 ? { key: value.key } : {}),
    }
    return this.cached ?? EMPTY
  }
}
