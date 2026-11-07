import {
  CONFIG_SCHEMA_URL,
  OPENAI_COMPATIBLE_PACKAGE,
  PROVIDER_USE_ACTION,
  customProviderProblem,
  isPermissionEffect,
  permissionRuleProblem,
  type CustomModel,
  type CustomProvider,
  type OpenCodeConfigDraft,
  type OpenCodeConfigLegacy,
  type PermissionRule,
} from '@shared/opencode-config'
import { parse, parseTree, printParseErrorCode, type JSONPath, type ParseError } from 'jsonc-parser'
import { appendElement, removeIfEmpty, removeValue, setValue } from './jsonc-edit'

/**
 * Reads and edits the text of an `opencode.jsonc` without rewriting it. Reading turns the V2 keys the editor
 * manages into a draft; applying a draft changes only the keys that differ from what the text already says
 * (found by comparing the draft of the current text with the new one), so comments, unknown fields, other
 * policies and the old-style keys all stay exactly as they were.
 *
 * OpenCode ignores a config file it cannot parse, without saying so, so nothing here may produce one: every
 * result is parsed again before it is returned.
 */

/** A new file starts as just the schema reference. */
export const NEW_CONFIG_TEXT = `{\n  "$schema": "${CONFIG_SCHEMA_URL}"\n}\n`

/** The old top-level keys the editor reports but never touches. */
const LEGACY_KEYS = ['permission', 'provider', 'disabled_providers', 'enabled_providers'] as const

export interface ConfigRead {
  draft: OpenCodeConfigDraft
  foreignProviders: { id: string; name: string }[]
  legacy: OpenCodeConfigLegacy
  warnings: string[]
  /** Set when the text is not valid JSONC; everything else is then empty. */
  parseError: string | null
}

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function lineAndColumn(text: string, offset: number): string {
  const before = text.slice(0, offset)
  const line = before.split(/\r\n|\r|\n/).length
  const column = offset - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
  return `line ${line}, column ${column}`
}

function parseConfig(text: string): { root: Json; error: string | null } {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true })
  const first = errors.at(0)
  if (first) return { root: {}, error: `${printParseErrorCode(first.error)} at ${lineAndColumn(text, first.offset)}` }
  if (value === undefined) return { root: {}, error: null }
  if (!isRecord(value)) return { root: {}, error: 'The file does not hold a JSON object.' }
  return { root: value, error: null }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function readRules(value: unknown): { rules: PermissionRule[]; skipped: number } {
  const rules: PermissionRule[] = []
  let skipped = 0
  for (const entry of Array.isArray(value) ? value : []) {
    if (isRecord(entry) && typeof entry.action === 'string' && typeof entry.resource === 'string' &&
      isPermissionEffect(entry.effect) && permissionRuleProblem(entry) === null) {
      rules.push({ action: entry.action, resource: entry.resource, effect: entry.effect })
    } else {
      skipped += 1
    }
  }
  return { rules, skipped }
}

function readModel(id: string, value: unknown): CustomModel {
  const model = isRecord(value) ? value : {}
  const limit = isRecord(model.limit) ? model.limit : {}
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {}
  const whole = (entry: unknown): number | null =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 ? entry : null
  return {
    id,
    name: typeof model.name === 'string' ? model.name : '',
    context: whole(limit.context),
    output: whole(limit.output),
    tools: capabilities.tools !== false,
    imageInput: strings(capabilities.input).includes('image'),
  }
}

function readProvider(id: string, value: unknown): CustomProvider {
  const provider = isRecord(value) ? value : {}
  const settings = isRecord(provider.settings) ? provider.settings : {}
  const models = isRecord(provider.models) ? provider.models : {}
  return {
    id,
    name: typeof provider.name === 'string' ? provider.name : '',
    baseUrl: typeof settings.baseURL === 'string' ? settings.baseURL : '',
    apiKeyEnv: strings(provider.env)[0] ?? '',
    models: Object.entries(models).map(([modelId, model]) => readModel(modelId, model)),
  }
}

/** The provider id a `provider.use` deny policy switches off, or null for any other policy. */
function disabledProviderOf(policy: unknown): string | null {
  if (!isRecord(policy) || policy.action !== PROVIDER_USE_ACTION || policy.effect !== 'deny') return null
  const resource = policy.resource
  return typeof resource === 'string' && /^[A-Za-z0-9*?][A-Za-z0-9._*?-]{0,199}$/.test(resource) ? resource : null
}

function managedProvider(id: string, value: unknown): CustomProvider | null {
  if (!isRecord(value) || value.package !== OPENAI_COMPATIBLE_PACKAGE) return null
  const provider = readProvider(id, value)
  return customProviderProblem(provider) === null ? provider : null
}

export function readConfig(text: string): ConfigRead {
  const { root, error } = parseConfig(text)
  const empty: ConfigRead = {
    draft: { permissions: [], customProviders: [], disabledProviders: [] },
    foreignProviders: [],
    legacy: { keys: [], providers: [], disabledProviders: [], enabledProviders: [] },
    warnings: [],
    parseError: error,
  }
  if (error) return empty

  const warnings: string[] = []
  const { rules, skipped } = readRules(root.permissions)
  if (skipped > 0) {
    warnings.push(`${skipped} ${skipped === 1 ? 'entry' : 'entries'} of "permissions" ${skipped === 1 ? 'is' : 'are'} not a valid rule and will be replaced when you save.`)
  }

  const customProviders: CustomProvider[] = []
  const foreignProviders: { id: string; name: string }[] = []
  for (const [id, value] of Object.entries(isRecord(root.providers) ? root.providers : {})) {
    const provider = managedProvider(id, value)
    if (provider) customProviders.push(provider)
    else foreignProviders.push({ id, name: isRecord(value) && typeof value.name === 'string' ? value.name : id })
  }

  const disabledProviders: string[] = []
  for (const policy of Array.isArray(root.policies) ? root.policies : []) {
    const id = disabledProviderOf(policy)
    if (id !== null && !disabledProviders.includes(id)) disabledProviders.push(id)
  }

  const legacy: OpenCodeConfigLegacy = {
    keys: LEGACY_KEYS.filter((key) => Object.hasOwn(root, key)),
    providers: isRecord(root.provider) ? Object.keys(root.provider) : [],
    disabledProviders: strings(root.disabled_providers),
    enabledProviders: strings(root.enabled_providers),
  }
  if (legacy.enabledProviders.length > 0) {
    warnings.push(`The old "enabled_providers" key limits OpenCode to ${legacy.enabledProviders.join(', ')}. Other providers stay unavailable until it is removed from the file.`)
  }
  return { draft: { permissions: rules, customProviders, disabledProviders }, foreignProviders, legacy, warnings, parseError: null }
}

// ---------------------------------------------------------------------------------------------------------------------
// Editing

const set = setValue
const remove = removeValue

function valueAt(text: string, path: JSONPath): unknown {
  let value: unknown = parseConfig(text).root
  for (const segment of path) {
    if (Array.isArray(value) && typeof segment === 'number') value = value[segment]
    else if (isRecord(value) && typeof segment === 'string' && Object.hasOwn(value, segment)) value = value[segment]
    else return undefined
  }
  return value
}


function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function expectArray(root: Json, key: string): unknown[] | null {
  const value = root[key]
  if (value === undefined) return null
  if (!Array.isArray(value)) throw new Error(`"${key}" in the file is not a list. Fix it in the file before using this editor.`)
  return value
}

function modelObject(model: CustomModel): Json {
  const limit: Json = {}
  if (model.context !== null) limit.context = model.context
  if (model.output !== null) limit.output = model.output
  return {
    ...(model.name ? { name: model.name } : {}),
    ...(Object.keys(limit).length > 0 ? { limit } : {}),
    capabilities: {
      tools: model.tools,
      input: model.imageInput ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
  }
}

function providerObject(provider: CustomProvider): Json {
  return {
    ...(provider.name ? { name: provider.name } : {}),
    package: OPENAI_COMPATIBLE_PACKAGE,
    ...(provider.apiKeyEnv ? { env: [provider.apiKeyEnv] } : {}),
    settings: { baseURL: provider.baseUrl },
    models: Object.fromEntries(provider.models.map((model) => [model.id, modelObject(model)])),
  }
}

/** Replaces, appends or drops list entries by position, so comments around entries that stay are kept. */
function applyList(text: string, key: string, wanted: unknown[]): string {
  const current = expectArray(parseConfig(text).root, key)
  if (wanted.length === 0) {
    if (current === null) return text
    // Entry by entry, so a comment inside the list stays; the key goes only if nothing at all is left in it.
    let emptied = text
    for (let index = current.length - 1; index >= 0; index -= 1) emptied = remove(emptied, [key, index])
    return removeIfEmpty(emptied, [key])
  }
  if (current === null) return set(text, [key], wanted)
  let next = text
  for (let index = 0; index < Math.min(current.length, wanted.length); index += 1) {
    if (!sameJson(current[index], wanted[index])) next = set(next, [key, index], wanted[index])
  }
  for (let index = current.length - 1; index >= wanted.length; index -= 1) next = remove(next, [key, index])
  for (let index = current.length; index < wanted.length; index += 1) next = appendElement(next, [key], wanted[index])
  return next
}

function applyPermissions(text: string, prev: PermissionRule[], next: PermissionRule[]): string {
  if (sameJson(prev, next)) return text
  return applyList(text, 'permissions', next.map(({ action, resource, effect }) => ({ action, resource, effect })))
}

function applyDisabledProviders(text: string, prev: string[], next: string[]): string {
  if (sameJson(prev, next)) return text
  const current = expectArray(parseConfig(text).root, 'policies')
  const wanted = new Set(next)
  const kept = new Set<string>()
  const drop: number[] = []
  current?.forEach((policy, index) => {
    const id = disabledProviderOf(policy)
    if (id === null) return
    if (wanted.has(id) && !kept.has(id)) kept.add(id)
    else drop.push(index)
  })
  let result = text
  for (const index of drop.sort((a, b) => b - a)) result = remove(result, ['policies', index])
  const additions = next.filter((id) => !kept.has(id)).map((id) => ({ action: PROVIDER_USE_ACTION, resource: id, effect: 'deny' }))
  if (current === null && additions.length > 0) return set(result, ['policies'], additions)
  for (const policy of additions) result = appendElement(result, ['policies'], policy)
  // A list this edit emptied is not left behind as `"policies": []`.
  return drop.length > 0 ? removeIfEmpty(result, ['policies']) : result
}

function applyModel(text: string, base: JSONPath, prev: CustomModel, next: CustomModel): string {
  let result = text
  if (prev.name !== next.name) result = next.name ? set(result, [...base, 'name'], next.name) : remove(result, [...base, 'name'])
  for (const key of ['context', 'output'] as const) {
    if (prev[key] === next[key]) continue
    const path = [...base, 'limit', key]
    result = next[key] === null ? removeIfEmpty(remove(result, path), [...base, 'limit']) : set(result, path, next[key])
  }
  if (prev.tools !== next.tools) result = set(result, [...base, 'capabilities', 'tools'], next.tools)
  if (prev.imageInput !== next.imageInput) {
    const current = strings(valueAt(result, [...base, 'capabilities', 'input'])).filter((entry) => entry !== 'image')
    if (next.imageInput && current.length === 0) current.push('text')
    result = set(result, [...base, 'capabilities', 'input'], next.imageInput ? [...current, 'image'] : current)
  }
  return result
}

function applyProvider(text: string, prev: CustomProvider, next: CustomProvider): string {
  const base: JSONPath = ['providers', next.id]
  let result = text
  if (prev.name !== next.name) result = next.name ? set(result, [...base, 'name'], next.name) : remove(result, [...base, 'name'])
  if (prev.baseUrl !== next.baseUrl) result = set(result, [...base, 'settings', 'baseURL'], next.baseUrl)
  if (prev.apiKeyEnv !== next.apiKeyEnv) {
    result = next.apiKeyEnv ? set(result, [...base, 'env'], [next.apiKeyEnv]) : remove(result, [...base, 'env'])
  }
  const previous = new Map(prev.models.map((model) => [model.id, model]))
  const wanted = new Set(next.models.map((model) => model.id))
  for (const model of prev.models) {
    if (!wanted.has(model.id)) result = remove(result, [...base, 'models', model.id])
  }
  for (const model of next.models) {
    const before = previous.get(model.id)
    if (!before) result = set(result, [...base, 'models', model.id], modelObject(model))
    else if (!sameJson(before, model)) result = applyModel(result, [...base, 'models', model.id], before, model)
  }
  return result
}

function applyProviders(text: string, prev: CustomProvider[], next: CustomProvider[]): string {
  if (sameJson(prev, next)) return text
  const existing = parseConfig(text).root.providers
  if (existing !== undefined && !isRecord(existing)) {
    throw new Error('"providers" in the file is not an object. Fix it in the file before using this editor.')
  }
  const previous = new Map(prev.map((provider) => [provider.id, provider]))
  const wanted = new Set(next.map((provider) => provider.id))
  let result = text
  let removed = false
  for (const provider of prev) {
    if (wanted.has(provider.id)) continue
    result = remove(result, ['providers', provider.id])
    removed = true
  }
  for (const provider of next) {
    const before = previous.get(provider.id)
    if (before) {
      result = applyProvider(result, before, provider)
    } else {
      if (isRecord(existing) && Object.hasOwn(existing, provider.id)) {
        throw new Error(`The file already has a provider called ${provider.id}, which this editor does not manage.`)
      }
      result = set(result, ['providers', provider.id], providerObject(provider))
    }
  }
  return removed ? removeIfEmpty(result, ['providers']) : result
}

/** A file with no object in it yet (empty, or only comments) gets the starting object after whatever it holds. */
function withRoot(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const kept = text.trimEnd()
  return kept === '' ? NEW_CONFIG_TEXT : `${kept}${eol}${NEW_CONFIG_TEXT}`
}

/**
 * The text with the draft's changes applied. Throws, with a message fit to show, when the text cannot be
 * parsed, when it holds something the editor cannot change safely, or when the result would not parse.
 */
export function applyDraft(text: string, next: OpenCodeConfigDraft): string {
  const source = parseTree(text, [], { allowTrailingComma: true }) ? text : withRoot(text)
  const current = readConfig(source)
  if (current.parseError) throw new Error(`The file is not valid JSON (${current.parseError}). Fix it before using this editor.`)
  const prev = current.draft
  let result = applyPermissions(source, prev.permissions, next.permissions)
  result = applyProviders(result, prev.customProviders, next.customProviders)
  result = applyDisabledProviders(result, prev.disabledProviders, next.disabledProviders)
  const check = parseConfig(result).error
  if (check) throw new Error(`The edit would leave the file invalid (${check}), so nothing was changed.`)
  return result === source ? text : result
}

// ---------------------------------------------------------------------------------------------------------------------
// Preview

const SECRET_KEY = /api[-_]?key|token|secret|password|passwd|authorization|credential/i
/** `{env:NAME}` and `{file:path}` name where a value lives; they are not the value. */
const REFERENCE = /^\{(?:env|file):[^}]*\}$/

/** Hides the values of settings that look like secrets, so the preview can be shown without leaking a key. */
export function redactSecrets(text: string): string {
  return text.replace(/("(?:[^"\\\n]|\\.)*"\s*:\s*)"((?:[^"\\\n]|\\.)*)"/g, (whole, head: string, value: string) => {
    const key = head.slice(0, head.lastIndexOf('"') + 1)
    if (!SECRET_KEY.test(key) || REFERENCE.test(value) || value === '') return whole
    return `${head}"(hidden)"`
  })
}
