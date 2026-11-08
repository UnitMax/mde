/**
 * The part of OpenCode's global configuration (`opencode.jsonc`) that MDE edits: permission rules, custom
 * OpenAI-compatible providers, and which providers are switched off. Everything is OpenCode 2's own format
 * (`permissions`, `providers`, `policies`); the older keys (`permission`, `provider`, `disabled_providers`) are
 * only reported, never read into a draft or rewritten. Types and rules here are shared by the main process,
 * which edits the file, and the renderer, which edits a draft of it, so neither side has its own idea of "valid".
 */

/** How OpenCode 2 names its OpenAI-compatible provider package. */
export const OPENAI_COMPATIBLE_PACKAGE = '@opencode/ai/providers/openai-compatible'
export const CONFIG_SCHEMA_URL = 'https://opencode.ai/config.json'
/** A policy with this action and a `deny` effect switches the provider named by its resource off. */
export const PROVIDER_USE_ACTION = 'provider.use'

/** Shown when the file changed between loading it and saving; the person reloads and applies the edits again. */
export const OPENCODE_CONFIG_CHANGED =
  'The OpenCode configuration changed on disk since it was loaded. Reload it, then make your changes again.'

export const PERMISSION_EFFECTS = ['allow', 'ask', 'deny'] as const
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number]

/** What OpenCode 2 asks about. An MCP tool is `<server>_<tool>`, and plugins may add more, so any text is allowed. */
export const PERMISSION_ACTIONS = [
  '*',
  'read',
  'edit',
  'glob',
  'grep',
  'shell',
  'subagent',
  'skill',
  'question',
  'webfetch',
  'websearch',
  'external_directory',
  'execute',
] as const

/** V1 names that OpenCode 2 no longer matches against, with what to use instead. */
export const LEGACY_PERMISSION_ACTIONS: Readonly<Record<string, string>> = { bash: 'shell', task: 'subagent' }

export const OPENCODE_CONFIG_LIMITS = {
  rules: 500,
  providers: 50,
  models: 200,
  disabledProviders: 200,
  action: 200,
  resource: 2000,
  name: 200,
  url: 2048,
  tokens: 100_000_000,
  /** The editor refuses a file this large rather than load it. */
  fileBytes: 1024 * 1024,
} as const

export interface PermissionRule {
  action: string
  resource: string
  effect: PermissionEffect
}

export interface CustomModel {
  id: string
  /** Empty means "not set": the file then has no `name` for the model. */
  name: string
  context: number | null
  output: number | null
  tools: boolean
  imageInput: boolean
}

export interface CustomProvider {
  /** Fixed once the provider exists; renaming means removing it and adding another. */
  id: string
  name: string
  baseUrl: string
  /** Name of the environment variable that holds the key; empty for none. The key itself is never handled here. */
  apiKeyEnv: string
  models: CustomModel[]
}

/** The editable part of the file. */
export interface OpenCodeConfigDraft {
  permissions: PermissionRule[]
  customProviders: CustomProvider[]
  /** Provider ids (or globs such as `ac*`) with a `provider.use` deny policy. */
  disabledProviders: string[]
}

/** Which file to edit: OpenCode runs natively (macOS) or inside a WSL distro (Windows). */
export interface OpenCodeConfigTarget {
  kind: 'native' | 'wsl'
  distro?: string
}

export interface OpenCodeConfigRequest extends OpenCodeConfigTarget {}

export interface OpenCodeConfigPreviewRequest extends OpenCodeConfigTarget {
  draft: OpenCodeConfigDraft
}

export interface OpenCodeConfigSaveRequest extends OpenCodeConfigTarget {
  draft: OpenCodeConfigDraft
  /** The `revision` of the snapshot the draft was made from. */
  revision: string
}

export interface OpenCodeConfigPreview {
  /** The file as it would be written, with the values of secret-looking settings hidden. */
  text: string
}

export interface OpenCodeConfigLegacy {
  /** Old top-level keys present in the file (`permission`, `provider`, `disabled_providers`, `enabled_providers`). */
  keys: string[]
  /** Ids under the old `provider` key. OpenCode still loads them. */
  providers: string[]
  /** Ids under the old `disabled_providers` key. OpenCode still applies them. */
  disabledProviders: string[]
  /** Ids under the old `enabled_providers` key; when there are any, only these providers are enabled. */
  enabledProviders: string[]
}

export interface OpenCodeConfigSnapshot {
  target: OpenCodeConfigTarget
  file: {
    /** Shown to the person, with the home directory written as `~`. Never sent back by the renderer. */
    displayPath: string
    exists: boolean
  }
  /** Identifies the file text this snapshot was read from; saving is refused when the file no longer matches. */
  revision: string
  draft: OpenCodeConfigDraft
  /** Providers in `providers` that are not OpenAI-compatible ones this editor manages; kept as they are. */
  foreignProviders: { id: string; name: string }[]
  legacy: OpenCodeConfigLegacy
  /** Providers the running service lists, for the on/off switches. Empty when the service could not be asked. */
  knownProviders: { id: string; name: string }[]
  warnings: string[]
  /** Set when the file is not valid JSONC. The draft is then empty and saving is refused. */
  parseError: string | null
}

export function emptyDraft(): OpenCodeConfigDraft {
  return { permissions: [], customProviders: [], disabledProviders: [] }
}

export function newCustomModel(): CustomModel {
  return { id: '', name: '', context: null, output: null, tools: true, imageInput: false }
}

export function newCustomProvider(): CustomProvider {
  return { id: '', name: '', baseUrl: '', apiKeyEnv: '', models: [newCustomModel()] }
}

export function draftsEqual(a: OpenCodeConfigDraft, b: OpenCodeConfigDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** A provider id, or a glob over ids, in a `provider.use` policy. */
const DISABLED_PROVIDER = /^[A-Za-z0-9*?][A-Za-z0-9._*?-]{0,199}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

/** True for a provider id or a glob over ids (`ac*`), as a `provider.use` deny policy takes. */
export function isProviderPattern(value: unknown): value is string {
  return typeof value === 'string' && DISABLED_PROVIDER.test(value)
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !CONTROLS.test(value)
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= OPENCODE_CONFIG_LIMITS.tokens
}

export function isPermissionEffect(value: unknown): value is PermissionEffect {
  return typeof value === 'string' && (PERMISSION_EFFECTS as readonly string[]).includes(value)
}

/** True for an `http:` or `https:` address with a host and no user name or password in it. */
export function isEndpointUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > OPENCODE_CONFIG_LIMITS.url || CONTROLS.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Why a permission rule cannot be saved, or null. */
export function permissionRuleProblem(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object') return 'A permission rule is malformed.'
  const { action, resource, effect } = rule as Record<string, unknown>
  if (!text(action, OPENCODE_CONFIG_LIMITS.action) || action.trim() === '') return 'Every permission rule needs an action.'
  if (action !== action.trim()) return `The action "${action}" has spaces around it.`
  if (!text(resource, OPENCODE_CONFIG_LIMITS.resource) || resource.trim() === '') {
    return `The ${action} rule needs a resource; use * to match everything.`
  }
  if (!isPermissionEffect(effect)) return `The ${action} rule needs an effect: allow, ask or deny.`
  return null
}

export function customModelProblem(model: unknown, providerId: string): string | null {
  if (!model || typeof model !== 'object') return `A model of ${providerId} is malformed.`
  const { id, name, context, output, tools, imageInput } = model as Record<string, unknown>
  if (!text(id, OPENCODE_CONFIG_LIMITS.name) || id.trim() === '') return `Every model of ${providerId} needs an id.`
  if (id !== id.trim()) return `The model id "${id}" of ${providerId} has spaces around it.`
  // It is a key in the file, and a parsed object treats this one key as its prototype.
  if (id === '__proto__') return `"${id}" cannot be used as a model id.`
  if (!text(name, OPENCODE_CONFIG_LIMITS.name)) return `The name of model ${id} is too long.`
  if (context !== null && !count(context)) return `The context size of ${id} must be a whole number above zero.`
  if (output !== null && !count(output)) return `The output limit of ${id} must be a whole number above zero.`
  if (typeof tools !== 'boolean' || typeof imageInput !== 'boolean') return `The settings of model ${id} are malformed.`
  return null
}

export function customProviderProblem(provider: unknown): string | null {
  if (!provider || typeof provider !== 'object') return 'A provider is malformed.'
  const { id, name, baseUrl, apiKeyEnv, models } = provider as Record<string, unknown>
  if (typeof id !== 'string' || !PROVIDER_ID.test(id)) {
    return 'A provider id starts with a letter or digit and holds only letters, digits, dots, dashes and underscores.'
  }
  if (!text(name, OPENCODE_CONFIG_LIMITS.name)) return `The name of provider ${id} is too long.`
  if (!isEndpointUrl(baseUrl)) return `Provider ${id} needs a base URL that starts with http:// or https:// and holds no password.`
  if (typeof apiKeyEnv !== 'string' || (apiKeyEnv !== '' && !ENV_NAME.test(apiKeyEnv))) {
    return `The key variable of ${id} must be an environment variable name such as ACME_API_KEY.`
  }
  if (!Array.isArray(models) || models.length === 0) return `Add at least one model to provider ${id}.`
  if (models.length > OPENCODE_CONFIG_LIMITS.models) return `Provider ${id} has too many models.`
  const seen = new Set<string>()
  for (const model of models) {
    const problem = customModelProblem(model, id)
    if (problem) return problem
    const modelId = (model as CustomModel).id
    if (seen.has(modelId)) return `Provider ${id} lists the model ${modelId} twice.`
    seen.add(modelId)
  }
  return null
}

/**
 * Why a draft cannot be saved, or null. The IPC validator, the main process and the form all call this, so
 * what the form accepts is what gets written.
 */
export function validateDraft(draft: unknown): string | null {
  if (!draft || typeof draft !== 'object') return 'The configuration is malformed.'
  const { permissions, customProviders, disabledProviders } = draft as Record<string, unknown>
  if (!Array.isArray(permissions) || permissions.length > OPENCODE_CONFIG_LIMITS.rules) {
    return `There can be at most ${OPENCODE_CONFIG_LIMITS.rules} permission rules.`
  }
  for (const rule of permissions) {
    const problem = permissionRuleProblem(rule)
    if (problem) return problem
  }
  if (!Array.isArray(customProviders) || customProviders.length > OPENCODE_CONFIG_LIMITS.providers) {
    return `There can be at most ${OPENCODE_CONFIG_LIMITS.providers} custom providers.`
  }
  const ids = new Set<string>()
  for (const provider of customProviders) {
    const problem = customProviderProblem(provider)
    if (problem) return problem
    const id = (provider as CustomProvider).id
    if (ids.has(id)) return `The provider id ${id} is used twice.`
    ids.add(id)
  }
  if (!Array.isArray(disabledProviders) || disabledProviders.length > OPENCODE_CONFIG_LIMITS.disabledProviders) {
    return 'Too many disabled providers.'
  }
  const disabled = new Set<string>()
  for (const entry of disabledProviders) {
    if (!isProviderPattern(entry)) {
      return 'A disabled provider is a provider id; * and ? match several.'
    }
    if (disabled.has(entry)) return `${entry} is listed twice as disabled.`
    disabled.add(entry)
  }
  return null
}
