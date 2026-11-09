import { describe, expect, it, vi } from 'vitest'
import {
  applyCommand,
  filterCommands,
  parseInvocation,
  slashCommands,
  slashTriggerAt,
  type SlashCommand,
} from '../src/renderer/lib/slash-commands'

const run = (): void => {}
const btw: SlashCommand = { name: 'btw', description: 'Ask a side question', argument: { hint: 'your question', required: true }, run }
const clear: SlashCommand = { name: 'clear', aliases: ['reset', 'new'], description: 'Start over with an empty conversation', run }
const compact: SlashCommand = { name: 'compact', description: 'Summarize the conversation to free up context', argument: { hint: 'what to keep', required: false }, run }
const commands = [btw, clear, compact]

describe('slashTriggerAt', () => {
  it('finds the /word at the very start that the caret is in', () => {
    expect(slashTriggerAt('/', 1)).toEqual({ end: 1, query: '' })
    expect(slashTriggerAt('/bt', 3)).toEqual({ end: 3, query: 'bt' })
    expect(slashTriggerAt('/btw', 2)).toEqual({ end: 4, query: 'b' })
  })

  it('takes the rest of the word the caret is inside, but only searches what is before it', () => {
    expect(slashTriggerAt('/btw rest of it', 3)).toEqual({ end: 4, query: 'bt' })
  })

  it('is closed once the caret is past the first word, or before the slash', () => {
    expect(slashTriggerAt('/btw ', 5)).toBeNull()
    expect(slashTriggerAt('/btw why', 8)).toBeNull()
    expect(slashTriggerAt('/btw', 0)).toBeNull()
  })

  it('only starts at the very start of the message, not mid-text, after a space or on a later line', () => {
    expect(slashTriggerAt('see /btw', 8)).toBeNull()
    expect(slashTriggerAt(' /btw', 5)).toBeNull()
    expect(slashTriggerAt('first\n/btw', 10)).toBeNull()
    expect(slashTriggerAt('btw', 3)).toBeNull()
    // Typing a word that merely starts like a command name must not open the list: the slash is what asks for it.
    expect(slashTriggerAt('b', 1)).toBeNull()
    expect(slashTriggerAt('btw', 1)).toBeNull()
    expect(slashTriggerAt(' /btw', 1)).toBeNull()
    expect(slashTriggerAt('\\btw', 1)).toBeNull()
  })

  it('refuses a caret that is not a position in the text', () => {
    expect(slashTriggerAt('/btw', -1)).toBeNull()
    expect(slashTriggerAt('/btw', 9)).toBeNull()
    expect(slashTriggerAt('/btw', 1.5)).toBeNull()
    expect(slashTriggerAt('', 0)).toBeNull()
  })
})

describe('filterCommands', () => {
  it('lists every command when nothing is typed', () => {
    expect(filterCommands(commands, '')).toEqual(commands)
  })

  it('puts names that start with the query first, then aliases, then names that contain it', () => {
    const list = [{ ...btw, name: 'stable' }, { ...btw, name: 'tab' }, { ...clear, name: 'other', aliases: ['table'] }, { ...btw, name: 'table-of' }]
    expect(filterCommands(list, 'tab').map((command) => command.name)).toEqual(['tab', 'table-of', 'other', 'stable'])
  })

  it('keeps the registry order within a group', () => {
    expect(filterCommands([compact, clear, btw], 'c').map((command) => command.name)).toEqual(['compact', 'clear'])
  })

  it('matches an alias, in any case', () => {
    expect(filterCommands(commands, 'RES').map((command) => command.name)).toEqual(['clear'])
  })

  it('finds a command by a word of its description once the query is long enough to mean something', () => {
    expect(filterCommands(commands, 'side').map((command) => command.name)).toEqual(['btw'])
    expect(filterCommands(commands, 'summ').map((command) => command.name)).toEqual(['compact'])
    // A word has to start with it: "ide" is inside "side" but starts nothing.
    expect(filterCommands(commands, 'ide')).toEqual([])
  })

  it('lists nothing for a word that fits no command, such as the start of a path', () => {
    expect(filterCommands(commands, 'etc/hosts')).toEqual([])
    expect(filterCommands(commands, 'zzz')).toEqual([])
  })
})

describe('applyCommand', () => {
  it('writes the command over the word, with a space after one that takes an argument', () => {
    expect(applyCommand('/bt', { end: 3, query: 'bt' }, btw)).toEqual({ text: '/btw ', caret: 5 })
    expect(applyCommand('/', { end: 1, query: '' }, compact)).toEqual({ text: '/compact ', caret: 9 })
  })

  it('replaces the whole word the caret is in', () => {
    expect(applyCommand('/b', { end: 2, query: '' }, btw)).toEqual({ text: '/btw ', caret: 5 })
    expect(applyCommand('/btx why', { end: 4, query: 'bt' }, btw)).toEqual({ text: '/btw why', caret: 5 })
  })

  it('does not double a space that is already there', () => {
    expect(applyCommand('/bt why', { end: 3, query: 'bt' }, btw)).toEqual({ text: '/btw why', caret: 5 })
  })

  it('adds no space after a command that takes nothing', () => {
    expect(applyCommand('/cl', { end: 3, query: 'cl' }, clear)).toEqual({ text: '/clear', caret: 6 })
  })
})

describe('parseInvocation', () => {
  it('reads the command and what follows it', () => {
    expect(parseInvocation(commands, '/btw why is the sky blue?')).toEqual({ command: btw, args: 'why is the sky blue?', nameEnd: 4 })
  })

  it('takes everything after the name, over several lines, trimmed', () => {
    expect(parseInvocation(commands, '/btw   first line\n\nsecond line  \n')?.args).toBe('first line\n\nsecond line')
    expect(parseInvocation(commands, '/btw\nwhy')?.args).toBe('why')
  })

  it('has no arguments when none follow, with or without the space', () => {
    expect(parseInvocation(commands, '/btw')).toEqual({ command: btw, args: '', nameEnd: 4 })
    expect(parseInvocation(commands, '/btw  ')).toEqual({ command: btw, args: '', nameEnd: 4 })
  })

  it('matches the name in any case and by alias, and says where the name as written ends', () => {
    expect(parseInvocation(commands, '/BTW hi')?.command).toBe(btw)
    expect(parseInvocation(commands, '/Reset')).toEqual({ command: clear, args: '', nameEnd: 6 })
    expect(parseInvocation(commands, '/new now')).toEqual({ command: clear, args: 'now', nameEnd: 4 })
  })

  it('is an ordinary message when it only looks like a command', () => {
    expect(parseInvocation(commands, '/etc/hosts is wrong')).toBeNull()
    expect(parseInvocation(commands, '/btwx hi')).toBeNull()
    expect(parseInvocation(commands, '/btw/hi')).toBeNull()
    expect(parseInvocation(commands, '/unknown thing')).toBeNull()
    expect(parseInvocation(commands, '/')).toBeNull()
    expect(parseInvocation(commands, '')).toBeNull()
    // Not at the start, so not a command.
    expect(parseInvocation(commands, ' /btw hi')).toBeNull()
    expect(parseInvocation(commands, 'please /btw hi')).toBeNull()
    expect(parseInvocation(commands, 'btw hi')).toBeNull()
  })

  it('finds nothing where there are no commands', () => {
    expect(parseInvocation([], '/btw hi')).toBeNull()
  })
})

describe('the Inbox commands', () => {
  type GoalChange = Parameters<Parameters<typeof slashCommands>[0]['goal']>[0]
  const actions = () => ({
    ask: vi.fn(async (_question: string) => undefined),
    fork: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    goal: vi.fn(async (_change: GoalChange) => undefined),
  })
  const named = (name: string, list: SlashCommand[]): SlashCommand => list.find((command) => command.name === name)!

  it('has /btw, which takes a question and asks it', async () => {
    const { ask, fork, compact, goal } = actions()
    const command = named('btw', slashCommands({ ask, fork, compact, goal }))
    expect(command).toMatchObject({ name: 'btw', argument: { required: true } })
    expect(command.description).toMatch(/side question/)
    await command.run('why SQLite?')
    expect(ask).toHaveBeenCalledWith('why SQLite?')
    expect(fork).not.toHaveBeenCalled()
    expect(compact).not.toHaveBeenCalled()
  })

  it('opens the earlier side questions with /btw on its own once there are some, and still asks one that is given', async () => {
    const ask = vi.fn()
    const asked = vi.fn()
    expect(named('btw', slashCommands({ ...actions(), ask })).argument).toEqual({ hint: 'your question', required: true })
    const command = named('btw', slashCommands({ ...actions(), ask, asked }))
    expect(command.argument?.required).toBe(false)
    await command.run('')
    expect(asked).toHaveBeenCalledOnce()
    expect(ask).not.toHaveBeenCalled()
    await command.run('why?')
    expect(ask).toHaveBeenCalledWith('why?')
    expect(asked).toHaveBeenCalledOnce()
  })

  it('has /fork, which takes nothing and forks the whole conversation', async () => {
    const { ask, fork, compact, goal } = actions()
    const command = named('fork', slashCommands({ ask, fork, compact, goal }))
    expect(command.argument).toBeUndefined()
    expect(command.description).toMatch(/fork/i)
    await command.run('')
    expect(fork).toHaveBeenCalledOnce()
    expect(fork).toHaveBeenCalledWith()
    expect(ask).not.toHaveBeenCalled()
    expect(compact).not.toHaveBeenCalled()
  })

  it('has /compact, which takes nothing, answers to /summarize too and compacts the conversation', async () => {
    const { ask, fork, compact, goal } = actions()
    const list = slashCommands({ ask, fork, compact, goal })
    const command = named('compact', list)
    expect(command.argument).toBeUndefined()
    expect(command.aliases).toEqual(['summarize'])
    expect(command.description).toMatch(/summarized/)
    expect(parseInvocation(list, '/summarize')?.command).toBe(command)
    await command.run('')
    expect(compact).toHaveBeenCalledOnce()
    expect(compact).toHaveBeenCalledWith()
    expect(ask).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
  })

  it('gives a failed compaction back to the box, which shows the reason', async () => {
    const command = named('compact', slashCommands({ ...actions(), compact: async () => { throw new Error('No service.') } }))
    await expect(command.run('')).rejects.toThrow('No service.')
  })

  it('gives a failed fork back to the box, which shows the reason', async () => {
    const { ask } = actions()
    const command = named('fork', slashCommands({ ...actions(), ask, fork: async () => { throw new Error('No service.') } }))
    await expect(command.run('')).rejects.toThrow('No service.')
  })

  it('has /goal, which takes an objective and sets it as the goal', async () => {
    const { ask, fork, compact, goal } = actions()
    const list = slashCommands({ ask, fork, compact, goal })
    const command = named('goal', list)
    expect(command).toMatchObject({ name: 'goal', argument: { hint: 'an objective', required: true } })
    expect(command.description).toMatch(/objective/)
    expect(parseInvocation(list, '/GOAL make the tests pass')).toMatchObject({ command, args: 'make the tests pass' })
    await command.run('  Make the tests pass.\nThen the typecheck.  ')
    expect(goal).toHaveBeenCalledWith({ action: 'set', objective: 'Make the tests pass.\nThen the typecheck.' })
    expect(ask).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(compact).not.toHaveBeenCalled()
  })

  it('reads pause, resume and clear after /goal as the actions, in any case and in quotes, as OpenCode does', async () => {
    const { ask, fork, compact, goal } = actions()
    const command = named('goal', slashCommands({ ask, fork, compact, goal }))
    for (const [written, action] of [['pause', 'pause'], ['Resume', 'resume'], [' CLEAR ', 'clear'], ['"pause"', 'pause'], ['\u201Cclear\u201D', 'clear']] as const) {
      goal.mockClear()
      await command.run(written)
      expect(goal).toHaveBeenCalledExactlyOnceWith({ action })
    }
    // More words are an objective, as they are to OpenCode.
    goal.mockClear()
    await command.run('pause the deploy until QA signs off')
    expect(goal).toHaveBeenCalledExactlyOnceWith({ action: 'set', objective: 'pause the deploy until QA signs off' })
  })

  it('refuses an objective OpenCode would refuse, before asking, and gives the reason back to the box', () => {
    const { ask, fork, compact, goal } = actions()
    const command = named('goal', slashCommands({ ask, fork, compact, goal }))
    expect(() => command.run('x'.repeat(4001))).toThrow(/at most 4,000 characters/)
    expect(() => command.run('   ')).toThrow('Say what the goal is.')
    expect(goal).not.toHaveBeenCalled()
  })

  it('gives a failed goal change back to the box, which shows OpenCode\'s reason', async () => {
    const command = named('goal', slashCommands({ ...actions(), goal: async () => { throw new Error('No active goal to pause.') } }))
    await expect(command.run('pause')).rejects.toThrow('No active goal to pause.')
  })

  it('lists /btw, /fork, /compact and /goal, and finds each by typing its name or a word of its description', () => {
    const list = slashCommands(actions())
    expect(list.map((command) => command.name)).toEqual(['btw', 'fork', 'compact', 'goal'])
    expect(filterCommands(list, 'go').map((command) => command.name)).toEqual(['goal'])
    expect(filterCommands(list, 'objective').map((command) => command.name)).toEqual(['goal'])
    expect(filterCommands(list, 'comp').map((command) => command.name)).toEqual(['compact'])
    expect(filterCommands(list, 'sum').map((command) => command.name)).toEqual(['compact'])
    expect(filterCommands(list, 'for').map((command) => command.name)).toEqual(['fork'])
    expect(filterCommands(list, 'copy').map((command) => command.name)).toEqual(['fork'])
    expect(parseInvocation(list, '/fork')).toMatchObject({ command: { name: 'fork' }, args: '' })
  })

  it('uses lower-case names without spaces or slashes, none twice, so that each can be typed and found', () => {
    const names = slashCommands(actions()).flatMap((command) => [command.name, ...(command.aliases ?? [])])
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(new Set(names).size).toBe(names.length)
  })
})
