import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillMentions, skillTriggerAt } from '../src/shared/skills'
import type { ChatPart, ChatSkill } from '../src/shared/types'
import { applySkill, filterSkills, SKILL_MATCH_LIMIT } from '../src/renderer/lib/skills'
import { skillCall, toolSummary } from '../src/renderer/lib/chat'
import { ServiceShapeError, parseMessagesPage, parseSkills } from '../src/main/opencode/service/parse'

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/opencode-chat', name), 'utf8'))

describe('skillTriggerAt', () => {
  it('finds the $word that ends at the caret', () => {
    expect(skillTriggerAt('$', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(skillTriggerAt('use $de', 7)).toEqual({ start: 4, end: 7, query: 'de' })
    expect(skillTriggerAt('first\n$de', 9)).toEqual({ start: 6, end: 9, query: 'de' })
  })

  it('takes the rest of the word the caret is inside, but only searches what is before it', () => {
    expect(skillTriggerAt('use $demo now', 7)).toEqual({ start: 4, end: 9, query: 'de' })
  })

  it('ignores a $ that does not start a word', () => {
    expect(skillTriggerAt('cost$5', 6)).toBeNull()
    expect(skillTriggerAt('`$de', 4)).toBeNull()
    expect(skillTriggerAt('a $$', 4)).toBeNull()
  })

  it('is closed once the caret is past the word', () => {
    expect(skillTriggerAt('a $x b', 6)).toBeNull()
    expect(skillTriggerAt('a $x b', 4)).toEqual({ start: 2, end: 4, query: 'x' })
  })

  it('refuses carets that are not in the text', () => {
    expect(skillTriggerAt('$de', -1)).toBeNull()
    expect(skillTriggerAt('$de', 4)).toBeNull()
    expect(skillTriggerAt('$de', 1.5)).toBeNull()
  })
})

describe('skillMentions', () => {
  it('finds a skill by its exact id, with offsets into the text', () => {
    expect(skillMentions('$demo run', ['demo'])).toEqual([{ id: 'demo', start: 0, end: 5, text: '$demo' }])
    expect(skillMentions('héllo $demo please', ['demo'])).toEqual([{ id: 'demo', start: 6, end: 11, text: '$demo' }])
  })

  it('counts UTF-16 units, so slicing the text with the offsets gives the mention back', () => {
    const text = '😀 $demo x'
    const [mention] = skillMentions(text, ['demo'])
    expect(mention).toMatchObject({ start: 3, end: 8 })
    expect(text.slice(mention!.start, mention!.end)).toBe('$demo')
  })

  it('leaves text that only looks like a skill alone', () => {
    expect(skillMentions('echo $HOME and $5', ['demo'])).toEqual([])
    expect(skillMentions('$Demo', ['demo'])).toEqual([])
    expect(skillMentions('a$demo', ['demo'])).toEqual([])
    expect(skillMentions('`$demo`', ['demo'])).toEqual([])
    expect(skillMentions('$demos', ['demo'])).toEqual([])
    expect(skillMentions('$demo.md', ['demo'])).toEqual([])
  })

  it('accepts punctuation that ends a sentence or a bracket', () => {
    expect(skillMentions('use $demo.', ['demo'])).toHaveLength(1)
    expect(skillMentions('use $demo, then more', ['demo'])).toHaveLength(1)
    expect(skillMentions('(try $demo)', ['demo'])).toHaveLength(1)
  })

  it('prefers the longest name and reports each skill once, in the order written', () => {
    expect(skillMentions('$deploy-prod now', ['deploy', 'deploy-prod']).map((m) => m.id)).toEqual(['deploy-prod'])
    expect(skillMentions('$deploy now', ['deploy', 'deploy-prod']).map((m) => m.id)).toEqual(['deploy'])
    expect(skillMentions('$b then $a then $b', ['a', 'b']).map((m) => m.id)).toEqual(['b', 'a'])
  })
})

const skills: ChatSkill[] = [
  { id: 'code-review', name: 'Code Review' },
  { id: 'demo', name: 'demo' },
  { id: 'deploy', name: 'Deploy' },
  { id: 'notes', name: 'Notes', description: 'Keeps a demo log' },
  { id: 'doc', name: 'Demo Docs' },
]

describe('filterSkills', () => {
  it('lists everything, in OpenCode order, while nothing is typed', () => {
    expect(filterSkills(skills, '').map((skill) => skill.id)).toEqual(['code-review', 'demo', 'deploy', 'notes', 'doc'])
  })

  it('ranks id prefixes, then name prefixes, then contained text, then descriptions', () => {
    expect(filterSkills(skills, 'de').map((skill) => skill.id)).toEqual(['demo', 'deploy', 'doc', 'code-review'])
    expect(filterSkills(skills, 'DEM').map((skill) => skill.id)).toEqual(['demo', 'doc', 'notes'])
    expect(filterSkills(skills, 'zzz')).toEqual([])
  })

  it('looks in descriptions only for three letters or more, and only at the start of a word', () => {
    // "de" is inside "Keeps a demo log" but a two-letter query would match nearly every description.
    expect(filterSkills(skills, 'de').map((skill) => skill.id)).not.toContain('notes')
    expect(filterSkills(skills, 'log').map((skill) => skill.id)).toEqual(['notes'])
    // "emo" is in the middle of "demo".
    expect(filterSkills([{ id: 'x', name: 'x', description: 'Keeps a demo log' }], 'emo')).toEqual([])
  })

  it('caps the list', () => {
    const many = Array.from({ length: SKILL_MATCH_LIMIT + 5 }, (_, index) => ({ id: `s${index}`, name: `s${index}` }))
    expect(filterSkills(many, '')).toHaveLength(SKILL_MATCH_LIMIT)
    expect(filterSkills(many, 's')).toHaveLength(SKILL_MATCH_LIMIT)
  })
})

describe('applySkill', () => {
  const demo = skills[1]!
  it('writes the skill over the word and moves the caret past the space after it', () => {
    expect(applySkill('use $de', { start: 4, end: 7, query: 'de' }, demo)).toEqual({ text: 'use $demo ', caret: 10 })
  })

  it('keeps an existing space or line break instead of doubling it', () => {
    expect(applySkill('use $de and more', { start: 4, end: 7, query: 'de' }, demo)).toEqual({ text: 'use $demo and more', caret: 10 })
    expect(applySkill('a $d\nb', { start: 2, end: 4, query: 'd' }, demo)).toEqual({ text: 'a $demo\nb', caret: 7 })
  })

  it('replaces the whole word when the caret was inside it', () => {
    expect(applySkill('use $demo x', { start: 4, end: 9, query: 'de' }, skills[2]!)).toEqual({ text: 'use $deploy x', caret: 12 })
  })
})

describe('parseSkills', () => {
  it('keeps what the picker needs and none of the skill text or paths', () => {
    const list = parseSkills(fixture('skills.json'))
    expect(list).toEqual([
      { id: 'opencode', name: 'OpenCode', description: 'Use this skill for any question about OpenCode itself.' },
      { id: 'demo', name: 'demo', description: 'Demo skill. When loaded, reply with the single word PINEAPPLE.' },
      { id: 'manual-only', name: 'manual-only', description: 'Only the user may invoke this one.' },
    ])
    expect(JSON.stringify(list)).not.toMatch(/home\/me|builtin|Built-in instructions|PINEAPPLE and nothing/)
  })

  it('skips names that could not be written after a $, repeats and junk', () => {
    expect(parseSkills({ data: [
      { id: 'ok' }, { id: 'ok', name: 'again' }, { id: 'two words' }, { id: 'a$b' }, { name: 'no id' }, 'text', null,
      { id: 'tab\there' },
    ] })).toEqual([{ id: 'ok', name: 'ok' }])
  })

  it('refuses an answer that is not a list', () => {
    expect(() => parseSkills({})).toThrow(ServiceShapeError)
    expect(() => parseSkills(null)).toThrow(ServiceShapeError)
    expect(parseSkills({ data: 'nope' })).toEqual([])
  })
})

describe('skills in the conversation', () => {
  const { messages } = parseMessagesPage(fixture('messages-skills.json'), false, 3)

  it('shows the skills a user message invoked, and leaves the text as written', () => {
    expect(messages[0]).toMatchObject({ kind: 'user', text: 'héllo $demo please', skills: [{ id: 'demo', name: 'demo' }] })
    expect(JSON.stringify(messages[0])).not.toContain('skill_content')
  })

  it('gives a skill message its text as details', () => {
    expect(messages[2]).toMatchObject({ kind: 'note', text: 'Loaded the demo skill' })
    expect((messages[2] as { detail?: string }).detail).toMatch(/^# Demo skill/)
  })

  it('reads the skill the agent loaded out of its tool call', () => {
    const assistant = messages[1]
    const part = assistant?.kind === 'assistant' ? assistant.parts[0] : undefined
    expect(part).toMatchObject({ kind: 'tool', name: 'skill', status: 'completed' })
    const call = skillCall(part as Extract<ChatPart, { kind: 'tool' }>)
    expect(call.name).toBe('demo')
    expect(call.body).toBe('# Demo skill\n\nWhen this skill is loaded, answer by replying with the single word PINEAPPLE and nothing else.')
    expect(call.files).toEqual([
      '/home/me/app/.claude/skills/demo/reference/notes.md',
      '/home/me/app/.claude/skills/demo/scripts/run.sh',
    ])
  })
})

function skillPart(overrides: Partial<Extract<ChatPart, { kind: 'tool' }>> = {}): Extract<ChatPart, { kind: 'tool' }> {
  return { kind: 'tool', id: 'call_1', name: 'skill', status: 'completed', input: '{\n  "id": "demo"\n}', ...overrides }
}

describe('skillCall and its summary', () => {
  it('names the skill from the input until its text has arrived', () => {
    const waiting = skillPart({ status: 'running' })
    expect(skillCall(waiting)).toEqual({ name: 'demo', body: null, files: [] })
    expect(toolSummary(waiting, '/home/me/app')).toBe('Loading the demo skill')
    expect(toolSummary(skillPart({ output: '<skill_content name="Demo">\n# Skill: Demo\n\nText\n</skill_content>' }), '/home/me/app')).toBe('Loaded the Demo skill')
  })

  it('reports a skill that could not be found', () => {
    const failed = skillPart({ status: 'error', error: 'Skill not found: nope', input: '{"id":"nope"}' })
    expect(toolSummary(failed, '/home/me/app')).toBe('Could not load the nope skill')
  })

  it('copes with a skill cut short and with output in another shape', () => {
    const cut = skillPart({ output: '<skill_content name="demo">\n# Skill: demo\n\nLong text\n\nBase directory for this skill: /home/me\n\n<skill_files>\n<file>/home/me/a.md</file>\n<file>/home/me/b' })
    expect(skillCall(cut)).toEqual({ name: 'demo', body: 'Long text', files: ['/home/me/a.md'] })
    expect(skillCall(skillPart({ output: 'something else' }))).toEqual({ name: 'demo', body: null, files: [] })
    expect(skillCall(skillPart({ input: 'not json' })).name).toBeNull()
  })

  it('cuts at the last directory note, so a skill that quotes the line keeps its own text', () => {
    const own = 'Line one.\nBase directory for this skill: is a phrase this skill quotes.\nLine three.'
    const output = `<skill_content name="demo">\n# Skill: demo\n\n${own}\n\nBase directory for this skill: /home/me\n</skill_content>`
    expect(skillCall(skillPart({ output })).body).toBe(own)
  })
})
