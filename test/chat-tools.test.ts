import { describe, expect, it } from 'vitest'
import type { ChatPart } from '../src/shared/types'
import { messageBlocks } from '../src/renderer/lib/chat'
import {
  activityBlocks,
  activitySummary,
  answeredQuestions,
  humanizeTool,
  isFeaturedTool,
  markMatches,
  parseGlobOutput,
  parseGrepOutput,
  parseReadOutput,
  parseWebSearch,
  patchFileChanges,
  reasoningPreview,
  reasoningTitle,
  searchRegExp,
  shellInfo,
  shellOutput,
  splitPath,
  todoView,
  toolFailed,
  toolKind,
  urlParts,
} from '../src/renderer/lib/chat-tools'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

function tool(name: string, input: unknown = {}, extra: Partial<ToolPart> = {}): ToolPart {
  return { kind: 'tool', id: `call_${name}`, name, status: 'completed', input: typeof input === 'string' ? input : JSON.stringify(input), ...extra }
}

describe('toolKind', () => {
  it('reads the names OpenCode renamed as the same tool', () => {
    expect(toolKind('bash')).toBe('shell')
    expect(toolKind('shell')).toBe('shell')
    expect(toolKind('task')).toBe('subagent')
    expect(toolKind('subagent')).toBe('subagent')
    expect(toolKind('apply_patch')).toBe('patch')
    expect(toolKind('patch')).toBe('patch')
    expect(toolKind('todowrite')).toBe('todo')
    expect(toolKind('READ')).toBe('read')
    expect(toolKind('search')).toBe('lookup')
  })

  it('leaves tools it does not know as other', () => {
    expect(toolKind('mystery')).toBe('other')
    expect(toolKind('demo_math_add')).toBe('other')
  })

  it('writes a tool name as words', () => {
    expect(humanizeTool('apply_patch')).toBe('Apply patch')
    expect(humanizeTool('lspHover')).toBe('Lsp hover')
    expect(humanizeTool('my-tool.run')).toBe('My tool run')
    expect(humanizeTool('')).toBe('Tool')
  })
})

describe('paths and addresses', () => {
  it('splits a path at its last slash', () => {
    expect(splitPath('src/app/main.ts')).toEqual({ dir: 'src/app/', base: 'main.ts' })
    expect(splitPath('main.ts')).toEqual({ dir: '', base: 'main.ts' })
    expect(splitPath('C:\\app\\main.ts')).toEqual({ dir: 'C:\\app\\', base: 'main.ts' })
  })

  it('splits an address into host and the rest', () => {
    expect(urlParts('https://www.example.com/docs/a?b=1')).toEqual({ host: 'example.com', rest: '/docs/a?b=1' })
    expect(urlParts('https://example.com/')).toEqual({ host: 'example.com', rest: '' })
    expect(urlParts('not a url')).toEqual({ host: 'not a url', rest: '' })
  })
})

describe('shellInfo', () => {
  it('reads the command, the description and how it ended', () => {
    const done = shellInfo(tool('shell', { command: 'npm test', description: 'Run the tests' }, { exitCode: 0 }))
    expect(done).toEqual({ command: 'npm test', description: 'Run the tests', workdir: null, exitCode: 0, failed: false })
    expect(shellInfo(tool('shell', { command: 'false' }, { exitCode: 1 })).failed).toBe(true)
    expect(shellInfo(tool('shell', { command: 'x' }, { status: 'error', error: 'boom' })).failed).toBe(true)
    expect(shellInfo(tool('shell', { command: 'x' }, { status: 'running' }))).toMatchObject({ exitCode: null, failed: false })
  })

  it('names a working folder only when it is not the thread’s own', () => {
    expect(shellInfo(tool('shell', { command: 'ls', workdir: '/home/me/app/' }), '/home/me/app').workdir).toBeNull()
    expect(shellInfo(tool('shell', { command: 'ls', workdir: '/home/me/app/web' }), '/home/me/app').workdir).toBe('web')
    expect(shellInfo(tool('shell', { command: 'ls', workdir: '/etc' }), '/home/me/app').workdir).toBe('/etc')
  })

  it('has no command while the input is still streaming', () => {
    expect(shellInfo(tool('shell', '{"command": "npm te', { status: 'pending' })).command).toBe('')
  })
})

describe('shellOutput', () => {
  it('drops the remnants of color codes and the blank end', () => {
    expect(shellOutput('[32mok[0m done\n[1;31mfail[0m\n\n')).toBe('ok done\nfail')
  })

  it('turns carriage returns into line breaks', () => {
    expect(shellOutput('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('leaves ordinary brackets alone', () => {
    expect(shellOutput('arr[1] = [x, y]')).toBe('arr[1] = [x, y]')
  })
})

describe('parseReadOutput', () => {
  it('reads the numbered lines and leaves the heading out', () => {
    const view = parseReadOutput('Read file /tmp/a.md, lines 1-3\n1: # Title\n2: \n3: Text: more')
    expect(view?.lines).toEqual([{ no: 1, text: '# Title' }, { no: 2, text: '' }, { no: 3, text: 'Text: more' }])
    expect(view?.notes).toEqual([])
  })

  it('starts where the range does and keeps the note after the lines', () => {
    const view = parseReadOutput('Read file a.ts, lines 40-41\n40: const a = 1\n41: const b = 2\n\n(File has more lines. Use offset 42 to continue.)')
    expect(view?.lines.map((line) => line.no)).toEqual([40, 41])
    expect(view?.notes).toEqual(['(File has more lines. Use offset 42 to continue.)'])
  })

  it('reads the older format with its wrapper', () => {
    const view = parseReadOutput('<file>\n00001| first\n00002| second\n\n(End of file - total 2 lines)\n</file>')
    expect(view?.lines).toEqual([{ no: 1, text: 'first' }, { no: 2, text: 'second' }])
    expect(view?.notes).toEqual(['(End of file - total 2 lines)'])
  })

  it('does not take a line that breaks the count for a line of the file', () => {
    const view = parseReadOutput('1: a\n2: b\n9: not next\n3: c')
    expect(view?.lines.map((line) => line.no)).toEqual([1, 2, 3])
  })

  it('gives up on output that is not a file', () => {
    expect(parseReadOutput('Read directory /tmp\nsrc/\nREADME.md')).toBeNull()
    expect(parseReadOutput('')).toBeNull()
    expect(parseReadOutput('[file image.png]')).toBeNull()
  })
})

describe('parseGrepOutput', () => {
  const output = [
    'Found 3 matches',
    '/home/me/app/test/launch.test.ts:',
    "  Line 6: import { buildLaunchSpec } from '../src/main/pty/launch'",
    '',
    "  Line 21: describe('buildLaunchSpec', () => {",
    '/home/me/app/src/pty.ts:',
    '  Line 3: export function buildLaunchSpec() {',
  ].join('\n')

  it('groups the matches by file', () => {
    const view = parseGrepOutput(output)
    expect(view?.matches).toBe(3)
    expect(view?.files.map((file) => [file.path, file.lines.map((line) => line.no)])).toEqual([
      ['/home/me/app/test/launch.test.ts', [6, 21]],
      ['/home/me/app/src/pty.ts', [3]],
    ])
    expect(view?.files[0]?.lines[0]?.text).toContain('buildLaunchSpec')
  })

  it('knows that nothing matched', () => {
    expect(parseGrepOutput('No matches found')).toEqual({ matches: 0, files: [], notes: [] })
    expect(parseGrepOutput('No files found')?.files).toEqual([])
  })

  it('keeps a note about cut-off results', () => {
    const view = parseGrepOutput(`${output}\n\n(Results are truncated. Consider using a more specific path or pattern.)`)
    expect(view?.notes).toEqual(['(Results are truncated. Consider using a more specific path or pattern.)'])
  })

  it('counts the lines when OpenCode gave no total', () => {
    expect(parseGrepOutput('a.ts:\n  Line 1: x\n  Line 2: y')?.matches).toBe(2)
  })

  it('lists files when a search only named them', () => {
    expect(parseGrepOutput('src/a.ts\nsrc/b.ts')?.files).toEqual([{ path: 'src/a.ts', lines: [] }, { path: 'src/b.ts', lines: [] }])
  })

  it('gives up on a shape it does not know', () => {
    expect(parseGrepOutput('Something else entirely happened here')).toBeNull()
  })
})

describe('parseGlobOutput', () => {
  it('lists the paths', () => {
    expect(parseGlobOutput('/a/b.ts\n/a/c.ts\n')).toEqual(['/a/b.ts', '/a/c.ts'])
  })

  it('knows that nothing matched', () => {
    expect(parseGlobOutput('No files found')).toEqual([])
    expect(parseGlobOutput('')).toEqual([])
  })

  it('leaves a note out of the list', () => {
    expect(parseGlobOutput('/a/b.ts\n(Results are truncated.)')).toEqual(['/a/b.ts'])
    expect(parseGlobOutput('(only a note)')).toBeNull()
  })
})

describe('marking matches', () => {
  it('cuts a line into the parts that matched and the rest', () => {
    expect(markMatches('foo bar Foo', searchRegExp('foo'))).toEqual([
      { text: 'foo', match: true },
      { text: ' bar ', match: false },
      { text: 'Foo', match: true },
    ])
  })

  it('leaves the line whole without a pattern, or when the pattern is not a regular expression', () => {
    expect(markMatches('foo', null)).toEqual([{ text: 'foo', match: false }])
    expect(searchRegExp('(unclosed')).toBeNull()
    expect(searchRegExp('')).toBeNull()
  })

  it('does not loop on a pattern that matches nothing', () => {
    expect(searchRegExp('a*')).toBeNull()
    expect(markMatches('abc', /x*/gi)).toEqual([{ text: 'abc', match: false }])
  })
})

describe('parseWebSearch', () => {
  it('reads the results with their first excerpt', () => {
    const output = JSON.stringify({
      search_id: 's',
      results: [
        { url: 'https://example.com/a', title: ' A title ', publish_date: null, excerpts: ['', 'First   excerpt\nhere'] },
        { url: 'https://www.example.org/b', excerpts: [] },
        { title: 'no address' },
        'nope',
      ],
    })
    expect(parseWebSearch(output)).toEqual([
      { title: 'A title', url: 'https://example.com/a', snippet: 'First excerpt here' },
      { title: 'example.org', url: 'https://www.example.org/b', snippet: null },
    ])
  })

  it('gives up on an answer that is not that JSON', () => {
    expect(parseWebSearch('1. a result')).toBeNull()
    expect(parseWebSearch('{"results": "x"}')).toBeNull()
    expect(parseWebSearch('{"results": [')).toBeNull()
  })
})

describe('todoView', () => {
  it('reads the list, how much is done and what is being worked on', () => {
    const view = todoView(tool('todowrite', { todos: [
      { content: 'Plan', status: 'completed', priority: 'high' },
      { content: ' Build ', status: 'in_progress', priority: 'medium' },
      { content: 'Ship', status: 'pending', priority: 'urgent' },
      { content: 'Drop', status: 'cancelled' },
      { content: '' },
      7,
    ] }))
    expect(view.items.map((item) => [item.text, item.state, item.priority])).toEqual([
      ['Plan', 'done', 'high'],
      ['Build', 'active', 'medium'],
      ['Ship', 'pending', null],
      ['Drop', 'cancelled', null],
    ])
    expect(view.done).toBe(1)
    expect(view.current?.text).toBe('Build')
  })

  it('points at the first item waiting when none is active', () => {
    expect(todoView(tool('todowrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] })).current?.text).toBe('b')
    expect(todoView(tool('todowrite', { todos: [{ content: 'a', status: 'completed' }] })).current).toBeNull()
  })

  it('is empty while the input is still streaming', () => {
    expect(todoView(tool('todowrite', '{"todos": [{"con', { status: 'pending' })).items).toEqual([])
  })
})

describe('answeredQuestions', () => {
  const input = { questions: [
    { question: 'Which city?', header: 'City', options: [{ label: 'Paris', description: '' }] },
    { question: 'Which colors?', options: [] },
  ] }

  it('pairs each question with its answers', () => {
    const answered = answeredQuestions(tool('question', input, { answers: [['Paris'], ['Red', 'Blue']] }))
    expect(answered).toEqual([
      { question: 'Which city?', header: 'City', answers: ['Paris'] },
      { question: 'Which colors?', header: null, answers: ['Red', 'Blue'] },
    ])
  })

  it('falls back to the sentence OpenCode wrote', () => {
    const output = 'User has answered your questions: "Which city?"="Paris", "Which colors?"="Red". You can now continue.'
    expect(answeredQuestions(tool('question', input, { output })).map((entry) => entry.answers)).toEqual([['Paris'], ['Red']])
  })

  it('has no answers before the person has answered', () => {
    expect(answeredQuestions(tool('question', input, { status: 'running' })).map((entry) => entry.answers)).toEqual([[], []])
    expect(answeredQuestions(tool('question', '{"quest', { status: 'pending' }))).toEqual([])
  })
})

describe('patchFileChanges', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Update File: src/a.ts',
    '@@ function a()',
    ' const keep = 1',
    '-const old = 2',
    '+const next = 2',
    '+const more = 3',
    '@@',
    '-tail',
    '+tail!',
    '*** Add File: src/new.ts',
    '+export const x = 1',
    '*** Delete File: src/gone.ts',
    '*** Update File: src/b.ts',
    '*** Move to: src/c.ts',
    '-b',
    '+c',
    '*** End Patch',
    '',
  ].join('\n')

  it('turns a patch into one change per file, with its counts', () => {
    const changes = patchFileChanges(tool('patch', { patchText }))!
    expect(changes.map((change) => [change.path, change.action, change.additions, change.deletions])).toEqual([
      ['src/a.ts', 'edit', 3, 2],
      ['src/new.ts', 'create', 1, 0],
      ['src/gone.ts', 'delete', 0, 0],
      ['src/c.ts', 'edit', 1, 1],
    ])
    expect(changes[0]?.hunks).toHaveLength(2)
    expect(changes[0]?.hunks[0]?.lines.map((line) => line.kind)).toEqual(['context', 'del', 'add', 'add'])
    expect(changes[0]?.numbered).toBe(false)
  })

  it('has nothing to show for input that is not a patch, or one still streaming', () => {
    expect(patchFileChanges(tool('patch', { patchText: 'just words' }))).toBeNull()
    expect(patchFileChanges(tool('patch', '{"patchText": "*** Begin', { status: 'pending' }))).toBeNull()
    expect(patchFileChanges(tool('patch', {}))).toBeNull()
  })
})

describe('reasoning', () => {
  it('takes the title a thought starts with', () => {
    expect(reasoningTitle('**Planning the refactor**\n\nFirst I will…')).toBe('Planning the refactor')
    expect(reasoningTitle('\n\n**Checking tests**:')).toBe('Checking tests')
    expect(reasoningTitle('## Weighing options\nText')).toBe('Weighing options')
    expect(reasoningTitle('Plain first line\n**Not a title**')).toBeNull()
    expect(reasoningTitle('**a** and **b**')).toBeNull()
    expect(reasoningTitle('')).toBeNull()
  })

  it('names only the latest heading that has been closed with a line break while the thought streams', () => {
    const text = '**Reading the code**\n\nSome words.\n\n**Planning the fix**\n\nMore words.'
    expect(reasoningTitle(text)).toBe('Reading the code')
    expect(reasoningPreview(text)).toBe('Planning the fix')
    // Still being written: neither half a heading nor a heading that may yet turn into a sentence counts.
    expect(reasoningPreview('**Reading the code**\n\nWords.\n\n**Plan')).toBe('Reading the code')
    expect(reasoningPreview('**Reading the code**\n\nWords.\n\n**Planning**')).toBe('Reading the code')
    expect(reasoningPreview('**Reading the code**\n\nWords.\n\n**Planning**\n')).toBe('Planning')
  })

  it('cuts a long title', () => {
    expect(reasoningTitle(`**${'x'.repeat(200)}**`)).toHaveLength(120)
  })

  it('shows the latest finished sentence of a thought without headings, without its markup', () => {
    expect(reasoningPreview('First idea. I should look at `src/app.ts` next. Then I will')).toBe('I should look at src/app.ts next.')
    expect(reasoningPreview('- first\n- second item\n')).toBe('second item')
    expect(reasoningPreview('First idea.\nI should check a.ts next')).toBe('First idea.')
  })

  it('does not change while a sentence is being written, only when one ends', () => {
    const steps = ['I should', 'I should check', 'I should check the', 'I should check the file.', 'I should check the file. Then']
    expect(steps.map((step) => reasoningPreview(`Start here. ${step}`))).toEqual([
      'Start here.',
      'Start here.',
      'Start here.',
      // The period is not yet followed by anything, so it may still be the dot in a file name or a number.
      'Start here.',
      'I should check the file.',
    ])
    expect(reasoningPreview('Look at v1.2')).toBeNull()
    expect(reasoningPreview('Look at v1.2 now. ')).toBe('Look at v1.2 now.')
  })

  it('has nothing to show before anything is finished', () => {
    expect(reasoningPreview('')).toBeNull()
    expect(reasoningPreview('Still on the first sentence')).toBeNull()
    expect(reasoningPreview('\n\n')).toBeNull()
  })

  it('cuts a long sentence from the end, so that it reads from its start', () => {
    const preview = reasoningPreview(`${'word '.repeat(80).trim()}. `, 20)!
    expect(preview).toHaveLength(20)
    expect(preview.startsWith('word word')).toBe(true)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('activity groups', () => {
  const read = (id: string, extra: Partial<ToolPart> = {}): ChatPart => tool('read', { path: `/app/${id}.ts` }, { id, ...extra })
  const shell = (id: string, extra: Partial<ToolPart> = {}): ChatPart => tool('shell', { command: 'ls' }, { id, ...extra })
  const thought: ChatPart = { kind: 'reasoning', text: 'Hmm' }
  const text: ChatPart = { kind: 'text', text: 'Done' }
  const edit = (id: string): ChatPart => tool('edit', { filePath: 'a.ts', oldString: 'a', newString: 'b' }, { id })

  const lay = (parts: ChatPart[]) => activityBlocks(messageBlocks(parts)).map((block) => block.kind === 'activity'
    ? `group:${block.items.length}`
    : block.kind === 'subagents' ? 'subagents' : block.part.kind === 'tool' ? block.part.id : block.part.kind)

  it('folds three or more steps in a row into one group', () => {
    expect(lay([thought, read('r1'), read('r2'), text])).toEqual(['group:3', 'text'])
    expect(lay([read('r1'), shell('s1'), read('r2'), shell('s2')])).toEqual(['group:4'])
  })

  it('leaves one or two steps as rows', () => {
    expect(lay([thought, read('r1'), text])).toEqual(['reasoning', 'r1', 'text'])
    expect(lay([read('r1')])).toEqual(['r1'])
  })

  it('breaks a run at text, at a file change and at subagents', () => {
    expect(lay([read('r1'), read('r2'), text, read('r3'), read('r4'), read('r5')])).toEqual(['r1', 'r2', 'text', 'group:3'])
    expect(lay([read('r1'), read('r2'), edit('e1'), read('r3'), read('r4')])).toEqual(['r1', 'r2', 'e1', 'r3', 'r4'])
    const subagent = tool('subagent', { agent: 'general', description: 'd', prompt: 'p' }, { id: 'sub' })
    expect(lay([read('r1'), read('r2'), subagent, read('r3')])).toEqual(['r1', 'r2', 'subagents', 'r3'])
  })

  it('does not count a thought with no words', () => {
    expect(lay([{ kind: 'reasoning', text: '  ' }, read('r1'), read('r2')])).toEqual(['reasoning', 'r1', 'r2'])
  })

  it('keeps a failed edit among the rows, with its reason', () => {
    expect(isFeaturedTool(edit('e1'))).toBe(true)
    expect(isFeaturedTool(tool('edit', {}, { status: 'error', error: 'No match' }))).toBe(false)
    expect(lay([read('r1'), tool('edit', {}, { id: 'bad', status: 'error', error: 'No match' }), read('r2')])).toEqual(['group:3'])
  })

  it('draws an answered question as a card and an unanswered one as a row', () => {
    const question = { questions: [{ question: 'Which?' }] }
    expect(isFeaturedTool(tool('question', question, { answers: [['A']] }))).toBe(true)
    expect(isFeaturedTool(tool('question', question, { status: 'running' }))).toBe(false)
    expect(isFeaturedTool(tool('question', question))).toBe(false)
  })

  it('draws a patch as a card only once it can be read as one', () => {
    const patchText = '*** Begin Patch\n*** Update File: a.ts\n-a\n+b\n*** End Patch'
    expect(isFeaturedTool(tool('patch', { patchText }))).toBe(true)
    expect(isFeaturedTool(tool('patch', { patchText }, { status: 'running' }))).toBe(false)
    expect(isFeaturedTool(tool('patch', { patchText: 'x' }))).toBe(false)
  })

  it('notices a step that failed, by its status or by its exit code', () => {
    expect(toolFailed(read('r1', { status: 'error' }))).toBe(true)
    expect(toolFailed(shell('s1', { exitCode: 2 }))).toBe(true)
    expect(toolFailed(shell('s1', { exitCode: 0 }))).toBe(false)
    expect(toolFailed(read('r1', { exitCode: 2 }))).toBe(false)
    expect(toolFailed(thought)).toBe(false)
  })

  it('sums up what was done, in the tense of what is still going on', () => {
    expect(activitySummary([thought, read('a'), read('b'), tool('grep', { pattern: 'x' }), tool('glob', {}), shell('c')])).toBe(
      'Thought, read 2 files, searched 2 times, ran 1 command',
    )
    expect(activitySummary([read('a'), shell('b', { status: 'running' }), shell('c')])).toBe('Read 1 file, running 2 commands')
    expect(activitySummary([read('a'), thought], true)).toBe('Thinking, read 1 file')
    expect(activitySummary([thought, thought, read('a')])).toBe('Thought 2 times, read 1 file')
    expect(activitySummary([tool('webfetch', {}), tool('websearch', {}), tool('skill', {}), tool('execute', {}), tool('todowrite', {})])).toBe(
      'Searched once, fetched 1 page, loaded 1 skill, called 1 tool, updated the to-do list',
    )
    expect(activitySummary([])).toBe('Activity')
  })
})
