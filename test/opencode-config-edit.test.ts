import {
  OPENAI_COMPATIBLE_PACKAGE,
  emptyDraft,
  newCustomModel,
  newCustomProvider,
  validateDraft,
  type CustomProvider,
  type OpenCodeConfigDraft,
} from '@shared/opencode-config'
import { parse, type ParseError } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { NEW_CONFIG_TEXT, applyDraft, readConfig, redactSecrets } from '../src/main/opencode/config/edit'

const TEXT = `{
  // my configuration
  "$schema": "https://opencode.ai/config.json",
  "model": "acme/tiny",
  "provider": { "legacy": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://127.0.0.1:9/v1" }, "models": { "m1": {} } } },
  "disabled_providers": ["old"],
  "providers": {
    // a local server
    "acme": {
      "name": "Acme",
      "package": "${OPENAI_COMPATIBLE_PACKAGE}",
      "env": ["ACME_API_KEY"],
      "settings": { "baseURL": "http://127.0.0.1:9/v1", "timeout": 1000 },
      "models": {
        "tiny": {
          "name": "Tiny",
          "limit": { "context": 8000, "output": 1000 },
          "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] }
        }
      }
    },
    "other": { "package": "aisdk:@ai-sdk/anthropic" }
  },
  "permissions": [
    // shell is risky
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "git push *", "effect": "deny" },
  ],
  "policies": [
    { "action": "shell", "resource": "rm -rf *", "effect": "deny" },
    // hide this
    { "action": "provider.use", "resource": "opencode", "effect": "deny" }
  ],
}
`

function expectValid(text: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  expect(errors).toEqual([])
  return value
}

function draftOf(text: string): OpenCodeConfigDraft {
  return structuredClone(readConfig(text).draft)
}

/** Applies a change to the draft and checks the file round-trips to exactly that draft. */
function edited(text: string, change: (draft: OpenCodeConfigDraft) => void): { text: string; draft: OpenCodeConfigDraft } {
  const draft = draftOf(text)
  change(draft)
  expect(validateDraft(draft)).toBeNull()
  const result = applyDraft(text, draft)
  expectValid(result)
  expect(readConfig(result).draft).toEqual(draft)
  return { text: result, draft }
}

const provider = (patch: Partial<CustomProvider> = {}): CustomProvider => ({
  ...newCustomProvider(),
  id: 'local',
  name: 'Local',
  baseUrl: 'http://localhost:8080/v1',
  models: [{ ...newCustomModel(), id: 'qwen', name: 'Qwen', context: 32000, output: 4096 }],
  ...patch,
})

describe('reading the configuration', () => {
  it('turns the V2 keys the editor manages into a draft', () => {
    const read = readConfig(TEXT)
    expect(read.parseError).toBeNull()
    expect(read.draft.permissions).toEqual([
      { action: 'shell', resource: '*', effect: 'ask' },
      { action: 'shell', resource: 'git push *', effect: 'deny' },
    ])
    expect(read.draft.disabledProviders).toEqual(['opencode'])
    expect(read.draft.customProviders).toEqual([{
      id: 'acme',
      name: 'Acme',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKeyEnv: 'ACME_API_KEY',
      models: [{ id: 'tiny', name: 'Tiny', context: 8000, output: 1000, tools: true, imageInput: true }],
    }])
  })

  it('lists providers it does not manage, and reports the old keys without reading them', () => {
    const read = readConfig(TEXT)
    expect(read.foreignProviders).toEqual([{ id: 'other', name: 'other' }])
    expect(read.legacy).toEqual({
      keys: ['provider', 'disabled_providers'],
      providers: ['legacy'],
      disabledProviders: ['old'],
      enabledProviders: [],
    })
    // The old disabled_providers entry is not part of the draft: it is reported and left alone.
    expect(read.draft.disabledProviders).not.toContain('old')
  })

  it('warns when the old enabled_providers key limits OpenCode', () => {
    const read = readConfig('{ "enabled_providers": ["a", "b"] }')
    expect(read.warnings.join(' ')).toContain('enabled_providers')
    expect(read.legacy.enabledProviders).toEqual(['a', 'b'])
  })

  it('treats an empty file as an empty configuration', () => {
    expect(readConfig('')).toMatchObject({ parseError: null, draft: emptyDraft() })
    expect(readConfig('  \n').parseError).toBeNull()
  })

  it('reports where a file stops being valid and offers no draft', () => {
    const read = readConfig('{\n  "permissions": [\n')
    expect(read.parseError).toMatch(/line \d+, column \d+/)
    expect(read.draft).toEqual(emptyDraft())
    expect(readConfig('[1, 2]').parseError).toContain('JSON object')
  })

  it('skips permission entries that are not rules and says so', () => {
    const read = readConfig('{ "permissions": [{ "action": "shell" }, { "action": "edit", "resource": "*", "effect": "ask" }] }')
    expect(read.draft.permissions).toHaveLength(1)
    expect(read.warnings.join(' ')).toContain('1 entry')
  })

  it('leaves a provider with an unusable shape to the file instead of failing the whole draft', () => {
    const text = `{ "providers": { "odd": { "package": "${OPENAI_COMPATIBLE_PACKAGE}", "settings": { "baseURL": "{env:BASE}" }, "models": { "m": {} } } } }`
    const read = readConfig(text)
    expect(read.draft.customProviders).toEqual([])
    expect(read.foreignProviders.map((entry) => entry.id)).toEqual(['odd'])
  })
})

describe('applying a draft', () => {
  it('changes nothing when the draft is what the file already says', () => {
    expect(applyDraft(TEXT, readConfig(TEXT).draft)).toBe(TEXT)
  })

  it('keeps comments, unknown fields, other policies, foreign providers and the old keys when permissions change', () => {
    const { text } = edited(TEXT, (draft) => {
      draft.permissions.push({ action: 'webfetch', resource: '*', effect: 'ask' })
    })
    expect(text).toContain('// my configuration')
    expect(text).toContain('// a local server')
    expect(text).toContain('// shell is risky')
    expect(text).toContain('"timeout": 1000')
    expect(text).toContain('"disabled_providers": ["old"]')
    expect(text).toContain('"other": { "package": "aisdk:@ai-sdk/anthropic" }')
    expect(text).toContain('"resource": "rm -rf *"')
    expect(text).toContain('"model": "acme/tiny"')
    const value = expectValid(text) as { permissions: unknown[] }
    expect(value.permissions).toHaveLength(3)
  })

  it('edits, reorders and removes permission rules by position', () => {
    const first = edited(TEXT, (draft) => draft.permissions.reverse())
    expect(first.text).toContain('// shell is risky')
    const second = edited(first.text, (draft) => {
      draft.permissions = [{ action: 'read', resource: '*.env', effect: 'deny' }]
    })
    expect((expectValid(second.text) as { permissions: unknown[] }).permissions).toHaveLength(1)
    // Emptied, the list keeps the comment that was written inside it.
    const third = edited(second.text, (draft) => {
      draft.permissions = []
    })
    expect(third.text).toContain('// shell is risky')
    expect((expectValid(third.text) as { permissions: unknown[] }).permissions).toEqual([])
    // With no comment to keep, the key goes.
    const plain = '{ "permissions": [{ "action": "shell", "resource": "*", "effect": "ask" }] }'
    expect(edited(plain, (draft) => {
      draft.permissions = []
    }).text).not.toContain('permissions')
  })

  it('adds a provider as an OpenAI-compatible V2 entry', () => {
    const { text } = edited(TEXT, (draft) => draft.customProviders.push(provider({ apiKeyEnv: 'LOCAL_KEY' })))
    const value = expectValid(text) as { providers: Record<string, Record<string, unknown>> }
    expect(value.providers.local).toEqual({
      name: 'Local',
      package: OPENAI_COMPATIBLE_PACKAGE,
      env: ['LOCAL_KEY'],
      settings: { baseURL: 'http://localhost:8080/v1' },
      models: {
        qwen: {
          name: 'Qwen',
          limit: { context: 32000, output: 4096 },
          capabilities: { tools: true, input: ['text'], output: ['text'] },
        },
      },
    })
    expect(text).toContain('// a local server')
  })

  it('edits only the fields that changed in an existing provider and model', () => {
    const { text } = edited(TEXT, (draft) => {
      const acme = draft.customProviders[0]!
      acme.baseUrl = 'http://127.0.0.1:8081/v1'
      acme.apiKeyEnv = ''
      acme.models[0]!.context = 16000
      acme.models[0]!.output = null
      acme.models[0]!.imageInput = false
      acme.models[0]!.tools = false
    })
    const acme = (expectValid(text) as { providers: Record<string, any> }).providers.acme
    expect(acme.env).toBeUndefined()
    expect(acme.settings).toEqual({ baseURL: 'http://127.0.0.1:8081/v1', timeout: 1000 })
    expect(acme.models.tiny.limit).toEqual({ context: 16000 })
    expect(acme.models.tiny.capabilities).toEqual({ tools: false, input: ['text'], output: ['text'] })
  })

  it('renames a provider and a model, and drops a name that was cleared', () => {
    const renamed = edited(TEXT, (draft) => {
      draft.customProviders[0]!.name = 'Acme Two'
      draft.customProviders[0]!.models[0]!.name = 'Tiny Two'
    })
    const acme = (expectValid(renamed.text) as { providers: Record<string, any> }).providers.acme
    expect(acme.name).toBe('Acme Two')
    expect(acme.models.tiny.name).toBe('Tiny Two')

    const cleared = edited(renamed.text, (draft) => {
      draft.customProviders[0]!.name = ''
      draft.customProviders[0]!.models[0]!.name = ''
    })
    const bare = (expectValid(cleared.text) as { providers: Record<string, any> }).providers.acme
    expect(bare.name).toBeUndefined()
    expect(bare.models.tiny.name).toBeUndefined()
    expect(bare.settings.timeout).toBe(1000)
  })

  it('removes an emptied limit and keeps input kinds the editor does not know', () => {
    const text = `{ "providers": { "p": { "package": "${OPENAI_COMPATIBLE_PACKAGE}", "settings": { "baseURL": "http://h/v1" },
      "models": { "m": { "limit": { "context": 1000 }, "capabilities": { "input": ["text", "image", "pdf"] } } } } } }`
    const { text: result } = edited(text, (draft) => {
      draft.customProviders[0]!.models[0]!.context = null
      draft.customProviders[0]!.models[0]!.imageInput = false
    })
    const model = (expectValid(result) as { providers: { p: { models: { m: any } } } }).providers.p.models.m
    expect(model.limit).toBeUndefined()
    expect(model.capabilities.input).toEqual(['text', 'pdf'])
  })

  it('adds and removes models and providers, tidying up what it empties', () => {
    const added = edited(TEXT, (draft) => draft.customProviders[0]!.models.push({ ...newCustomModel(), id: 'big', name: 'Big' }))
    const removedModel = edited(added.text, (draft) => draft.customProviders[0]!.models.shift())
    expect(Object.keys((expectValid(removedModel.text) as any).providers.acme.models)).toEqual(['big'])
    const removedProvider = edited(TEXT, (draft) => draft.customProviders.pop())
    expect((expectValid(removedProvider.text) as any).providers.acme).toBeUndefined()
    expect((expectValid(removedProvider.text) as any).providers.other).toBeDefined()

    const only = `{ "providers": { "p": { "package": "${OPENAI_COMPATIBLE_PACKAGE}", "settings": { "baseURL": "http://h/v1" }, "models": { "m": {} } } } }`
    expect(edited(only, (draft) => draft.customProviders.pop()).text).not.toContain('"providers"')
  })

  it('refuses to take over a provider id the file already uses for something else', () => {
    const draft = draftOf(TEXT)
    draft.customProviders.push(provider({ id: 'other' }))
    expect(() => applyDraft(TEXT, draft)).toThrow(/already has a provider called other/)
  })

  it('switches providers off with provider.use deny policies and keeps every other policy', () => {
    const { text } = edited(TEXT, (draft) => {
      draft.disabledProviders = ['opencode', 'ac*']
    })
    const policies = (expectValid(text) as { policies: unknown[] }).policies
    expect(policies).toEqual([
      { action: 'shell', resource: 'rm -rf *', effect: 'deny' },
      { action: 'provider.use', resource: 'opencode', effect: 'deny' },
      { action: 'provider.use', resource: 'ac*', effect: 'deny' },
    ])
    expect(text).toContain('// hide this')
    expect(text).not.toContain('disabled_providers": ["opencode"')
  })

  it('switches a provider back on and drops a policy list it leaves empty', () => {
    const { text } = edited(TEXT, (draft) => {
      draft.disabledProviders = []
    })
    expect(expectValid(text)).toMatchObject({ policies: [{ action: 'shell' }] })
    expect(text).not.toContain('"resource": "opencode"')

    const only = '{ "policies": [{ "action": "provider.use", "resource": "x", "effect": "deny" }] }'
    expect(edited(only, (draft) => {
      draft.disabledProviders = []
    }).text).not.toContain('policies')
  })

  it('creates the policy list when there is none, and writes into an empty list', () => {
    expect((expectValid(edited('{}', (draft) => draft.disabledProviders.push('a')).text) as any).policies).toHaveLength(1)
    expect((expectValid(edited('{ "policies": [] }', (draft) => draft.disabledProviders.push('a')).text) as any).policies).toHaveLength(1)
  })

  it('never writes the old keys, and leaves them in effect and untouched', () => {
    const { text } = edited('{ "disabled_providers": ["old"], "permission": { "bash": "ask" } }', (draft) => {
      draft.disabledProviders.push('new')
      draft.permissions.push({ action: 'edit', resource: '*', effect: 'ask' })
    })
    const value = expectValid(text) as Record<string, unknown>
    expect(value.disabled_providers).toEqual(['old'])
    expect(value.permission).toEqual({ bash: 'ask' })
    expect(value.policies).toEqual([{ action: 'provider.use', resource: 'new', effect: 'deny' }])
  })

  it('builds a new file from just the schema reference', () => {
    const { text } = edited('', (draft) => draft.permissions.push({ action: 'shell', resource: '*', effect: 'ask' }))
    expect(text.startsWith('{\n  "$schema": "https://opencode.ai/config.json"')).toBe(true)
    expect(applyDraft('', emptyDraft())).toBe('')
    expect(NEW_CONFIG_TEXT).toContain('$schema')
  })

  it('keeps tab indentation and Windows line endings', () => {
    const tabs = '{\n\t"model": "a/b"\n}\n'
    const tabbed = edited(tabs, (draft) => draft.permissions.push({ action: 'shell', resource: '*', effect: 'ask' })).text
    expect(tabbed).toContain('\n\t"permissions"')
    expect(tabbed).not.toMatch(/\n {2}"/)

    const crlf = '{\r\n  "model": "a/b"\r\n}\r\n'
    const windows = edited(crlf, (draft) => draft.permissions.push({ action: 'shell', resource: '*', effect: 'ask' })).text
    expect(windows).not.toMatch(/[^\r]\n/)
  })

  it('refuses a file that is not valid and one with keys it cannot edit safely', () => {
    expect(() => applyDraft('{ "model": ', emptyDraft())).toThrow(/not valid JSON/)
    const draft = emptyDraft()
    draft.permissions.push({ action: 'shell', resource: '*', effect: 'ask' })
    expect(() => applyDraft('{ "permissions": "ask" }', draft)).toThrow(/not a list/)
    draft.customProviders.push(provider())
    expect(() => applyDraft('{ "providers": [] }', draft)).toThrow(/not an object/)
  })

  it('replaces entries of permissions that were not rules when the list changes', () => {
    const text = '{ "permissions": [{ "action": "shell" }, { "action": "edit", "resource": "*", "effect": "ask" }] }'
    const { text: result } = edited(text, (draft) => draft.permissions.push({ action: 'read', resource: '*', effect: 'allow' }))
    expect((expectValid(result) as { permissions: unknown[] }).permissions).toEqual([
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'read', resource: '*', effect: 'allow' },
    ])
  })
})

describe('the preview', () => {
  it('hides secret-looking values but not references to where they live', () => {
    const text = `{
  "providers": { "p": { "settings": { "apiKey": "sk-live-123", "baseURL": "http://h" }, "headers": { "Authorization": "Bearer abc", "X-Api-Key": "k", "Accept": "json" } } },
  "mcp": { "s": { "environment": { "TOKEN": "{env:TOKEN}", "GITHUB_TOKEN": "ghp_abc", "OTHER": "fine" } } }
}`
    const redacted = redactSecrets(text)
    expect(redacted).not.toContain('sk-live-123')
    expect(redacted).not.toContain('Bearer abc')
    expect(redacted).not.toContain('ghp_abc')
    expect(redacted).not.toContain('"k"')
    expect(redacted).toContain('"TOKEN": "{env:TOKEN}"')
    expect(redacted).toContain('"Accept": "json"')
    expect(redacted).toContain('"baseURL": "http://h"')
    expect(redacted).toContain('"OTHER": "fine"')
    expectValid(redacted)
  })
})

describe('draft validation', () => {
  const problem = (change: (draft: OpenCodeConfigDraft) => void): string | null => {
    const draft = emptyDraft()
    draft.customProviders.push(provider())
    change(draft)
    return validateDraft(draft)
  }

  it('accepts a well-formed draft', () => {
    expect(problem(() => undefined)).toBeNull()
  })

  it('rejects malformed permission rules', () => {
    expect(problem((d) => d.permissions.push({ action: '', resource: '*', effect: 'ask' }))).toMatch(/needs an action/)
    expect(problem((d) => d.permissions.push({ action: 'shell', resource: '', effect: 'ask' }))).toMatch(/needs a resource/)
    expect(problem((d) => d.permissions.push({ action: 'shell', resource: '*', effect: 'maybe' as never }))).toMatch(/effect/)
    expect(problem((d) => d.permissions.push({ action: ' shell', resource: '*', effect: 'ask' }))).toMatch(/spaces/)
  })

  it('rejects unusable providers', () => {
    expect(problem((d) => { d.customProviders[0]!.id = '../x' })).toMatch(/provider id/)
    expect(problem((d) => { d.customProviders[0]!.baseUrl = 'ftp://host' })).toMatch(/base URL/)
    expect(problem((d) => { d.customProviders[0]!.baseUrl = 'http://user:pass@host/v1' })).toMatch(/base URL/)
    expect(problem((d) => { d.customProviders[0]!.apiKeyEnv = 'sk-not-a-name!' })).toMatch(/environment variable name/)
    expect(problem((d) => { d.customProviders[0]!.models = [] })).toMatch(/at least one model/)
    expect(problem((d) => { d.customProviders[0]!.models.push({ ...newCustomModel(), id: 'qwen' }) })).toMatch(/twice/)
    expect(problem((d) => { d.customProviders[0]!.models[0]!.context = 0 })).toMatch(/context size/)
    expect(problem((d) => { d.customProviders[0]!.models[0]!.id = '__proto__' })).toMatch(/cannot be used/)
    expect(problem((d) => d.customProviders.push(provider()))).toMatch(/used twice/)
  })

  it('rejects malformed disabled-provider entries', () => {
    expect(problem((d) => d.disabledProviders.push('has space'))).toMatch(/provider id/)
    expect(problem((d) => d.disabledProviders.push('a', 'a'))).toMatch(/twice/)
    expect(problem((d) => d.disabledProviders.push('ac*'))).toBeNull()
  })
})
