import { describe, expect, it } from 'vitest'
import { partFileChanges, turnChanges } from '../src/renderer/lib/turn-changes'
import type { ChatMessage, ChatPart } from '../src/shared/types'

const MODEL = { id: 'free-1', providerId: 'opencode' }
const DIR = '/home/me/app'
let counter = 0
const tool = (name: string, input: unknown, extra: Record<string, unknown> = {}): ChatPart =>
  ({ kind: 'tool', id: `call_${++counter}`, name, status: 'completed', input: JSON.stringify(input), ...extra }) as ChatPart
const edit = (name: string, extra: Record<string, unknown> = {}): ChatPart =>
  tool('edit', { filePath: `${DIR}/${name}`, oldString: 'old', newString: 'new' }, extra)
const write = (name: string, content: string, existed?: boolean): ChatPart =>
  tool('write', { filePath: `${DIR}/${name}`, content }, existed === undefined ? {} : { existed })
const patch = (text: string): ChatPart => tool('apply_patch', { patchText: `*** Begin Patch\n${text}\n*** End Patch` })
const step = (id: string, parts: ChatPart[]): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model: MODEL, parts, completed: true }) as ChatMessage
const user = (id: string): ChatMessage => ({ kind: 'user', id, time: 1, text: 'Go' }) as ChatMessage

describe('partFileChanges', () => {
  it('reads edits, writes and patches that finished, and nothing else', () => {
    expect(partFileChanges(edit('a.ts'))?.map((change) => change.action)).toEqual(['edit'])
    expect(partFileChanges(write('b.ts', 'x\n', true))?.map((change) => change.action)).toEqual(['overwrite'])
    expect(partFileChanges(patch('*** Delete File: c.ts'))?.map((change) => change.action)).toEqual(['delete'])
    expect(partFileChanges(edit('a.ts', { status: 'error' }))).toBeNull()
    expect(partFileChanges(edit('a.ts', { status: 'running' }))).toBeNull()
    expect(partFileChanges(tool('shell', { command: 'rm a.ts' }))).toBeNull()
    expect(partFileChanges({ kind: 'text', text: 'hi' } as ChatPart)).toBeNull()
  })
})

describe('turnChanges', () => {
  it('sums up each turn under its last assistant message', () => {
    const result = turnChanges([
      user('u1'), step('a1', [edit('a.ts')]), step('a2', [{ kind: 'text', text: 'Done' } as ChatPart]),
      user('u2'), step('b1', [write('b.ts', 'one\ntwo\n', false)]),
    ], DIR)
    expect([...result.keys()]).toEqual(['a2', 'b1'])
    expect(result.get('a2')).toMatchObject({ additions: 1, deletions: 1, files: [{ path: 'a.ts', action: 'edit' }] })
    expect(result.get('b1')).toMatchObject({ additions: 2, deletions: 0, files: [{ path: 'b.ts', action: 'create' }] })
  })

  it('makes one entry of a file named in full by an edit and from the folder by a patch, in the order first touched', () => {
    const result = turnChanges([
      user('u1'),
      step('a1', [edit('src/a.ts'), write('z.ts', 'z\n', false)]),
      step('a2', [patch('*** Update File: src/a.ts\n@@\n-x\n+y\n+w')]),
    ], DIR).get('a2')!
    expect(result.files.map((file) => [file.path, file.action, file.additions, file.deletions])).toEqual([
      ['src/a.ts', 'edit', 3, 2],
      ['z.ts', 'create', 1, 0],
    ])
    expect(result.files[0]!.hunks).toHaveLength(2)
  })

  it('names what happened to a file over the turn', () => {
    const actions = (parts: ChatPart[]): string[] =>
      turnChanges([user('u1'), step('a1', parts)], DIR).get('a1')!.files.map((file) => file.action)
    expect(actions([write('a.ts', 'x', false), edit('a.ts')])).toEqual(['create'])
    expect(actions([write('a.ts', 'x', false), patch('*** Delete File: a.ts')])).toEqual(['delete'])
    expect(actions([write('a.ts', 'x', true), edit('a.ts')])).toEqual(['edit'])
    expect(actions([write('a.ts', 'x', true), write('a.ts', 'y', true)])).toEqual(['overwrite'])
  })

  it('leaves out turns without changes and the turn still going, and starts a turn at a goal', () => {
    const goal = { kind: 'note', id: 'g1', time: 3, text: 'Goal set', tone: 'info', goal: { objective: 'x' } } as unknown as ChatMessage
    const messages = [user('u1'), step('a1', [tool('read', { path: 'a.ts' })]), user('u2'), step('b1', [edit('a.ts')]), goal, step('c1', [edit('b.ts')])]
    expect([...turnChanges(messages, DIR).keys()]).toEqual(['b1', 'c1'])
    expect([...turnChanges(messages, DIR, true).keys()]).toEqual(['b1'])
  })
})
