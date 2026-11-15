import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import {
  OPENCODE_CONFIG_CHANGED,
  OPENCODE_CONFIG_LIMITS,
  validateDraft,
  type OpenCodeConfigDraft,
  type OpenCodeConfigPreview,
  type OpenCodeConfigSnapshot,
  type OpenCodeConfigTarget,
} from '@shared/opencode-config'
import type { MdeMcpStatus } from '@shared/mde-mcp'
import { applyDraft, readConfig, redactSecrets } from './edit'
import { installMdeMcp, readMdeMcpState, removeMdeMcp } from './mde-mcp'
import type { ConfigFileSystem } from './files'

/** The file OpenCode 2 prefers when both exist, and the one a new configuration is created as. */
const PREFERRED_NAME = 'opencode.jsonc'
const PLAIN_NAME = 'opencode.json'
/** Asking the running service for its providers must not hold up showing the file. */
const KNOWN_PROVIDERS_TIMEOUT_MS = 3000
/** A new file may hold API keys the person adds by hand later, so it starts private. */
const NEW_FILE_MODE = 0o600

export interface OpenCodeConfigDependencies {
  fileSystem(target: OpenCodeConfigTarget): ConfigFileSystem
  /** The providers the running OpenCode lists; may fail or be slow, in which case there are none to show. */
  knownProviders(target: OpenCodeConfigTarget): Promise<{ id: string; name: string }[]>
  /** Called after the file was written, so what MDE cached from OpenCode (models) is fetched again. */
  onSaved(target: OpenCodeConfigTarget): void
}

interface LoadedFile {
  path: string
  exists: boolean
  /** Without a byte order mark, which is put back when the file is written. */
  text: string
  bom: boolean
  mode: number
  revision: string
  bothNames: boolean
}

/** Reads, previews and writes OpenCode's global configuration for the editor. */
export class OpenCodeConfigService {
  /** One save at a time, so two rapid ones cannot interleave their read and write. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dependencies: OpenCodeConfigDependencies) {}

  read(target: OpenCodeConfigTarget): Promise<OpenCodeConfigSnapshot> {
    return this.snapshot(target, this.dependencies.fileSystem(target))
  }

  async preview(target: OpenCodeConfigTarget, draft: OpenCodeConfigDraft): Promise<OpenCodeConfigPreview> {
    const problem = validateDraft(draft)
    if (problem) throw new Error(problem)
    const loaded = await this.load(this.dependencies.fileSystem(target))
    return { text: redactSecrets(applyDraft(loaded.text, draft)) }
  }

  save(target: OpenCodeConfigTarget, draft: OpenCodeConfigDraft, revision: string): Promise<OpenCodeConfigSnapshot> {
    const run = this.queue.then(() => this.write(target, draft, revision))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Whether the MDE MCP is in this target's configuration, and whether it starts `command` (this copy of MDE). */
  async mdeMcpStatus(target: OpenCodeConfigTarget, command: string[]): Promise<MdeMcpStatus> {
    const files = this.dependencies.fileSystem(target)
    const [loaded, home] = await Promise.all([this.load(files), files.home().catch(() => null)])
    return { ...readMdeMcpState(loaded.text, command), file: displayPath(loaded.path, home) }
  }

  /** Adds the MDE MCP to the configuration, or points an existing entry at `command`; nothing else changes. */
  installMdeMcp(target: OpenCodeConfigTarget, command: string[]): Promise<MdeMcpStatus> {
    return this.edit(target, command, (text) => installMdeMcp(text, command))
  }

  removeMdeMcp(target: OpenCodeConfigTarget, command: string[]): Promise<MdeMcpStatus> {
    return this.edit(target, command, removeMdeMcp)
  }

  /** Changes the file text in place, in the save queue; a file that cannot be parsed is left alone. */
  private edit(target: OpenCodeConfigTarget, command: string[], change: (text: string) => string): Promise<MdeMcpStatus> {
    const run = this.queue.then(async () => {
      const files = this.dependencies.fileSystem(target)
      const loaded = await this.load(files)
      const { parseError } = readMdeMcpState(loaded.text, command)
      if (parseError) throw new Error(`OpenCode’s configuration cannot be read (${parseError}). Fix it by hand first.`)
      const next = change(loaded.text)
      if (next !== loaded.text) {
        const destination = await files.realpath(loaded.path)
        await files.writeText(destination, (loaded.bom ? '\ufeff' : '') + next, loaded.exists ? loaded.mode : NEW_FILE_MODE)
        this.dependencies.onSaved(target)
      }
      return this.mdeMcpStatus(target, command)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async write(target: OpenCodeConfigTarget, draft: OpenCodeConfigDraft, revision: string): Promise<OpenCodeConfigSnapshot> {
    const problem = validateDraft(draft)
    if (problem) throw new Error(problem)
    const files = this.dependencies.fileSystem(target)
    const loaded = await this.load(files)
    if (loaded.revision !== revision) throw new Error(OPENCODE_CONFIG_CHANGED)
    const next = applyDraft(loaded.text, draft)
    if (next !== loaded.text) {
      const destination = await files.realpath(loaded.path)
      await files.writeText(destination, (loaded.bom ? '﻿' : '') + next, loaded.exists ? loaded.mode : NEW_FILE_MODE)
      this.dependencies.onSaved(target)
    }
    return this.snapshot(target, files)
  }

  private async load(files: ConfigFileSystem): Promise<LoadedFile> {
    const directory = await files.directory()
    const preferred = posix.join(directory, PREFERRED_NAME)
    const plain = posix.join(directory, PLAIN_NAME)
    const [preferredStat, plainStat] = await Promise.all([files.stat(preferred), files.stat(plain)])
    const path = preferredStat ? preferred : plainStat ? plain : null
    const stat = preferredStat ?? plainStat
    if (!path || !stat) {
      return { path: preferred, exists: false, text: '', bom: false, mode: NEW_FILE_MODE, revision: 'absent', bothNames: false }
    }
    if (stat.size > OPENCODE_CONFIG_LIMITS.fileBytes) {
      throw new Error(`${posix.basename(path)} is larger than 1 MiB. Edit it by hand.`)
    }
    const raw = await files.readText(path)
    const bom = raw.charCodeAt(0) === 0xfeff
    return {
      path,
      exists: true,
      text: bom ? raw.slice(1) : raw,
      bom,
      mode: stat.mode,
      revision: createHash('sha256').update(raw).digest('hex'),
      bothNames: Boolean(preferredStat && plainStat),
    }
  }

  private async snapshot(target: OpenCodeConfigTarget, files: ConfigFileSystem): Promise<OpenCodeConfigSnapshot> {
    const [loaded, home, knownProviders] = await Promise.all([
      this.load(files),
      files.home().catch(() => null),
      this.knownProviders(target),
    ])
    const info = readConfig(loaded.text)
    const warnings = [...info.warnings]
    if (loaded.bothNames) warnings.push(`Both ${PREFERRED_NAME} and ${PLAIN_NAME} exist. This editor uses ${PREFERRED_NAME}.`)
    return {
      target,
      file: { displayPath: displayPath(loaded.path, home), exists: loaded.exists },
      revision: loaded.revision,
      draft: info.draft,
      foreignProviders: info.foreignProviders,
      legacy: info.legacy,
      knownProviders,
      warnings,
      parseError: info.parseError,
    }
  }

  private async knownProviders(target: OpenCodeConfigTarget): Promise<{ id: string; name: string }[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never[]>((resolve) => {
        timer = setTimeout(() => resolve([]), KNOWN_PROVIDERS_TIMEOUT_MS)
      })
      return await Promise.race([this.dependencies.knownProviders(target).catch(() => []), timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}

function displayPath(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}
