import {
  emptyDraft,
  newCustomModel,
  validateDraft,
  type CustomProvider,
  type OpenCodeConfigDraft,
  type PermissionRule,
} from '@shared/opencode-config'
import { parse, type ParseError } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { applyDraft, readConfig } from '../src/main/opencode/config/edit'
import { appendElement, removeIfEmpty, removeValue, setValue } from '../src/main/opencode/config/jsonc-edit'

function valid(text: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true })
  expect(errors, text).toEqual([])
  return value
}

describe('adding entries', () => {
  it('adds a property on its own line with the indentation of its siblings and the file’s comma style', () => {
    expect(setValue('{\n  "a": 1\n}\n', ['b'], 2)).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
    expect(setValue('{\n  "a": 1,\n}\n', ['b'], 2)).toBe('{\n  "a": 1,\n  "b": 2,\n}\n')
    expect(setValue('{\n\t"a": 1\n}\n', ['b'], 2)).toBe('{\n\t"a": 1,\n\t"b": 2\n}\n')
    expect(setValue('{\r\n    "a": 1\r\n}\r\n', ['b'], 2)).toBe('{\r\n    "a": 1,\r\n    "b": 2\r\n}\r\n')
  })

  it('leaves a neighbour that holds inline structure exactly as it is', () => {
    expect(setValue('{\n  "a": { "x": [1, 2] }\n}\n', ['b'], 2)).toBe('{\n  "a": { "x": [1, 2] },\n  "b": 2\n}\n')
  })

  it('keeps a comment on the same line with the entry it follows', () => {
    expect(setValue('{\n  "a": 1 // about a\n}\n', ['b'], 2)).toBe('{\n  "a": 1, // about a\n  "b": 2\n}\n')
    expect(setValue('{\n  "a": 1, /* about a */\n}\n', ['b'], 2)).toBe('{\n  "a": 1, /* about a */\n  "b": 2,\n}\n')
  })

  it('keeps entries that share a line on that line', () => {
    expect(setValue('{ "a": 1 }', ['b'], 2)).toBe('{ "a": 1, "b": 2 }')
    expect(appendElement('[1, 2]', [], 3)).toBe('[1, 2, 3]')
    expect(appendElement('{ "x": [1, 2] }', ['x'], 3)).toBe('{ "x": [1, 2, 3] }')
  })

  it('fills an empty object or array, leaving comments inside it alone', () => {
    expect(setValue('{}', ['a'], 1)).toBe('{\n  "a": 1\n}')
    expect(setValue('{\n  "o": {}\n}\n', ['o', 'a'], 1)).toBe('{\n  "o": {\n    "a": 1\n  }\n}\n')
    expect(appendElement('{\n  "l": []\n}\n', ['l'], 1)).toBe('{\n  "l": [\n    1\n  ]\n}\n')
    expect(setValue('{\n  // nothing yet\n}\n', ['a'], 1)).toBe('{\n  "a": 1\n  // nothing yet\n}\n')
  })

  it('creates the objects above a new value', () => {
    expect(setValue('{\n  "a": 1\n}\n', ['p', 'q', 'r'], true)).toBe('{\n  "a": 1,\n  "p": {\n    "q": { "r": true }\n  }\n}\n')
    expect(() => setValue('{ "a": 1 }', ['a', 'b'], 1)).toThrow(/something else/)
    expect(() => appendElement('{ "a": 1 }', ['a'], 1)).toThrow(/not a list/)
  })

  it('writes short flat values on one line and longer or nested ones over several', () => {
    const rule = { action: 'shell', resource: 'git push *', effect: 'deny' }
    expect(appendElement('{\n  "l": [\n    1\n  ]\n}\n', ['l'], rule)).toBe(
      '{\n  "l": [\n    1,\n    { "action": "shell", "resource": "git push *", "effect": "deny" }\n  ]\n}\n',
    )
    const nested = setValue('{}', ['p'], { a: { b: 1 }, list: [{ c: 1 }] })
    expect(nested).toBe('{\n  "p": {\n    "a": { "b": 1 },\n    "list": [\n      { "c": 1 }\n    ]\n  }\n}')
    expect(valid(nested)).toEqual({ p: { a: { b: 1 }, list: [{ c: 1 }] } })
  })

  it('replaces a value in place', () => {
    expect(setValue('{\n  "a": 1, // keep\n  "b": [1, 2]\n}\n', ['b', 1], 9)).toBe('{\n  "a": 1, // keep\n  "b": [1, 9]\n}\n')
    expect(setValue('{ "a": { "b": 1 } }', ['a'], 'x')).toBe('{ "a": "x" }')
  })
})

describe('removing entries', () => {
  it('removes a whole line and the comma that would be left over', () => {
    expect(removeValue('{\n  "a": 1,\n  "b": 2\n}\n', ['b'])).toBe('{\n  "a": 1\n}\n')
    expect(removeValue('{\n  "a": 1,\n  "b": 2\n}\n', ['a'])).toBe('{\n  "b": 2\n}\n')
    expect(removeValue('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n', ['b'])).toBe('{\n  "a": 1,\n  "c": 3\n}\n')
    expect(removeValue('{\n  "a": 1,\n  "b": 2,\n}\n', ['b'])).toBe('{\n  "a": 1,\n}\n')
    expect(removeValue('{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n', ['b'])).toBe('{\r\n  "a": 1\r\n}\r\n')
  })

  it('keeps comments on lines of their own, and takes a trailing comment along with its entry', () => {
    const text = '{\n  "a": 1, // about a\n  // about b\n  "b": 2, // b too\n  "c": 3\n}\n'
    expect(removeValue(text, ['b'])).toBe('{\n  "a": 1, // about a\n  // about b\n  "c": 3\n}\n')
    expect(removeValue('{\n  "a": 1, // about a\n  "b": 2 // about b\n}\n', ['b'])).toBe('{\n  "a": 1 // about a\n}\n')
  })

  it('removes entries that share a line', () => {
    expect(removeValue('{ "a": 1, "b": 2 }', ['b'])).toBe('{ "a": 1 }')
    expect(removeValue('{ "a": 1, "b": 2 }', ['a'])).toBe('{ "b": 2 }')
    expect(removeValue('[1, 2, 3]', [1])).toBe('[1, 3]')
  })

  it('leaves an empty pair of brackets when the last entry goes, unless a comment is inside', () => {
    expect(removeValue('{\n  "a": {\n    "x": 1\n  }\n}\n', ['a', 'x'])).toBe('{\n  "a": {}\n}\n')
    expect(removeValue('{\n  "l": [\n    1\n  ]\n}\n', ['l', 0])).toBe('{\n  "l": []\n}\n')
    expect(removeValue('{\n  "l": [\n    // note\n    1\n  ]\n}\n', ['l', 0])).toBe('{\n  "l": [\n    // note\n  ]\n}\n')
  })

  it('removes an emptied container only when nothing, not even a comment, is inside', () => {
    expect(removeIfEmpty('{\n  "a": [],\n  "b": 1\n}\n', ['a'])).toBe('{\n  "b": 1\n}\n')
    expect(removeIfEmpty('{\n  "a": {\n    // note\n  },\n  "b": 1\n}\n', ['a'])).toBe('{\n  "a": {\n    // note\n  },\n  "b": 1\n}\n')
    expect(removeIfEmpty('{ "a": [1] }', ['a'])).toBe('{ "a": [1] }')
    expect(removeIfEmpty('{ "a": 1 }', ['a'])).toBe('{ "a": 1 }')
  })

  it('does nothing for a path that is not there', () => {
    expect(removeValue('{ "a": 1 }', ['b'])).toBe('{ "a": 1 }')
    expect(removeValue('{ "a": [1] }', ['a', 4])).toBe('{ "a": [1] }')
  })
})

describe('what the editor does to a whole file', () => {
  it('keeps the lines around an appended permission rule exactly as they were', () => {
    const text = '{\n  "permissions": [\n    // first\n    { "action": "shell", "resource": "*", "effect": "ask" }, // all shell\n    { "action": "edit", "resource": "*", "effect": "ask" }\n  ]\n}\n'
    const draft = readConfig(text).draft
    draft.permissions.push({ action: 'shell', resource: 'git push *', effect: 'deny' })
    expect(applyDraft(text, draft)).toBe(
      '{\n  "permissions": [\n    // first\n    { "action": "shell", "resource": "*", "effect": "ask" }, // all shell\n    { "action": "edit", "resource": "*", "effect": "ask" },\n    { "action": "shell", "resource": "git push *", "effect": "deny" }\n  ]\n}\n',
    )
  })

  it('writes the first permission rule of a file that has only comments', () => {
    const draft = emptyDraft()
    draft.permissions.push({ action: 'shell', resource: '*', effect: 'ask' })
    const result = applyDraft('// nothing here yet\n', draft)
    expect(result.startsWith('// nothing here yet\n{')).toBe(true)
    expect(valid(result)).toMatchObject({ permissions: [{ action: 'shell' }] })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Randomized check: whatever sequence of edits is made, the file stays valid, says what the draft says, keeps
// every comment, and applying the same draft twice changes nothing more.

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PACKAGE = '@opencode/ai/providers/openai-compatible'

const BASES: string[] = [
  '',
  '{}',
  '{ "model": "a/b" }',
  '{\n  // keep1\n  "$schema": "https://opencode.ai/config.json",\n  "model": "a/b" // keep2\n}\n',
  '{\n\t// keep1\n\t"model": "a/b",\n}\n',
  '{\r\n  "model": "a/b", // keep1\r\n  "provider": { "old": { "npm": "x", "models": { "m": {} } } },\r\n  "disabled_providers": ["old"]\r\n}\r\n',
  `{\n  // keep1\n  "permissions": [\n    // keep2\n    { "action": "shell", "resource": "*", "effect": "ask" }, // gone3\n    { "action": "edit", "resource": "*", "effect": "deny" },\n  ],\n  "policies": [\n    { "action": "provider.use", "resource": "old", "effect": "deny" }, // gone4\n    { "action": "shell", "resource": "rm *", "effect": "deny" }\n  ],\n  "providers": {\n    "acme": { "package": "${PACKAGE}", "settings": { "baseURL": "http://h/v1", "timeout": 5 }, "models": { "m": { "name": "M" } } }, // gone5\n    "other": { "package": "aisdk:@ai-sdk/anthropic" }\n  }\n}\n`,
  `{"permissions":[],"providers":{"p":{"package":"${PACKAGE}","settings":{"baseURL":"http://h/v1"},"models":{"a":{},"b":{"limit":{"context":10}}}}},"policies":[]}`,
]

/**
 * Providers and models are keyed objects in the file, and an edit leaves each entry where it was; removing one
 * and adding another with the same id in one go therefore keeps the old position. The order of those, and of
 * the providers switched off, means nothing (a permission rule's does, and stays compared as it is).
 */
function unordered(draft: OpenCodeConfigDraft): OpenCodeConfigDraft {
  const byId = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id.localeCompare(b.id))
  return {
    ...draft,
    customProviders: byId(draft.customProviders).map((provider) => ({ ...provider, models: byId(provider.models) })),
    disabledProviders: [...draft.disabledProviders].sort(),
  }
}

function mutate(draft: OpenCodeConfigDraft, next: () => number): void {
  const pick = <T>(items: T[]): T | undefined => items[Math.floor(next() * items.length)]
  const word = (): string => `${pick(['alpha', 'beta', 'gamma', 'delta', 'omega'])}${Math.floor(next() * 4)}`
  const rule = (): PermissionRule => ({
    action: pick(['shell', 'edit', 'read', 'webfetch', 'external_directory'])!,
    resource: pick(['*', 'git push *', '*.env', 'rm -rf *', `${word()}/*`])!,
    effect: pick(['allow', 'ask', 'deny'] as const)!,
  })
  const model = (): ReturnType<typeof newCustomModel> => ({
    ...newCustomModel(),
    id: word(),
    name: next() < 0.5 ? word() : '',
    context: next() < 0.5 ? 1000 + Math.floor(next() * 9000) : null,
    output: next() < 0.5 ? 100 + Math.floor(next() * 900) : null,
    tools: next() < 0.5,
    imageInput: next() < 0.5,
  })
  switch (Math.floor(next() * 12)) {
    case 0: draft.permissions.push(rule()); break
    case 1: if (draft.permissions.length) draft.permissions.splice(Math.floor(next() * draft.permissions.length), 1); break
    case 2: if (draft.permissions.length) draft.permissions[Math.floor(next() * draft.permissions.length)] = rule(); break
    case 3: draft.permissions.reverse(); break
    case 4: {
      const id = `p_${word()}`
      if (!draft.customProviders.some((entry) => entry.id === id)) {
        draft.customProviders.push({
          id, name: next() < 0.5 ? word() : '', baseUrl: `http://${word()}.test/v1`, apiKeyEnv: next() < 0.5 ? 'SOME_KEY' : '',
          models: [model()],
        })
      }
      break
    }
    case 5: if (draft.customProviders.length) draft.customProviders.splice(Math.floor(next() * draft.customProviders.length), 1); break
    case 6: {
      const provider = pick(draft.customProviders)
      if (provider) { provider.baseUrl = `http://${word()}.test/v2`; provider.name = next() < 0.5 ? word() : ''; provider.apiKeyEnv = next() < 0.5 ? 'OTHER_KEY' : '' }
      break
    }
    case 7: {
      const provider = pick(draft.customProviders)
      const added = model()
      if (provider && !provider.models.some((entry) => entry.id === added.id)) provider.models.push(added)
      break
    }
    case 8: {
      const provider = pick(draft.customProviders)
      if (provider && provider.models.length > 1) provider.models.splice(Math.floor(next() * provider.models.length), 1)
      break
    }
    case 9: {
      const target = pick(draft.customProviders.flatMap((provider) => provider.models))
      if (target) Object.assign(target, { ...model(), id: target.id })
      break
    }
    case 10: {
      const id = pick(['opencode', 'anthropic', 'ac*', word()])!
      if (!draft.disabledProviders.includes(id)) draft.disabledProviders.push(id)
      break
    }
    default:
      if (draft.disabledProviders.length) draft.disabledProviders.splice(Math.floor(next() * draft.disabledProviders.length), 1)
  }
}

describe('randomized edits', () => {
  it.each(BASES.map((base, index) => [index, base] as const))('base %i stays valid and faithful through many edits', (index, base) => {
    for (let run = 0; run < 25; run += 1) {
      const next = random(index * 1000 + run)
      let text = base
      // Comments on their own line (or after an entry the editor does not manage) must always survive; one that
      // trails a managed entry goes with that entry when it is removed.
      const comments = [...base.matchAll(/\/\/ keep\d/g)].map((match) => match[0])
      const legacy = readConfig(base).legacy
      for (let step = 0; step < 14; step += 1) {
        const draft: OpenCodeConfigDraft = structuredClone(readConfig(text).draft)
        for (let count = 1 + Math.floor(next() * 3); count > 0; count -= 1) mutate(draft, next)
        if (validateDraft(draft) !== null) continue
        const result = applyDraft(text, draft)
        valid(result)
        expect(unordered(readConfig(result).draft), `base ${index} run ${run} step ${step}`).toEqual(unordered(draft))
        expect(applyDraft(result, structuredClone(draft))).toBe(result)
        for (const comment of comments) expect(result).toContain(comment)
        expect(readConfig(result).legacy).toEqual(legacy)
        text = result
      }
    }
  })

  it('never turns a provider the editor does not manage into something else', () => {
    const base = BASES[6]!
    const before = (valid(base) as { providers: { other: unknown } }).providers.other
    const next = random(7)
    let text = base
    for (let step = 0; step < 40; step += 1) {
      const draft = structuredClone(readConfig(text).draft)
      mutate(draft, next)
      if (validateDraft(draft) !== null) continue
      text = applyDraft(text, draft)
    }
    expect((valid(text) as { providers: { other: unknown } }).providers.other).toEqual(before)
  })
})

// Keep the unused-import check honest: these are the shapes the generator above builds.
export type _Shapes = [CustomProvider, PermissionRule]
