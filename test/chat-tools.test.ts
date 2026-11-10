import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatPart } from '../src/shared/types'
import { messageBlocks } from '../src/renderer/lib/chat'
import {
  activityBlocks,
  activitySummary,
  answeredQuestions,
  compactFlow,
  compactPlans,
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
  samePlan,
  searchRegExp,
  shellInfo,
  shellOutput,
  splitPath,
  todoView,
  toolFailed,
  textHeadline,
  toolKind,
  urlParts,
  type FlowStep,
  type RenderBlock,
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

describe('the headline of words', () => {
  it('is the first line without its markup, cut when long', () => {
    expect(textHeadline('\n\nI will check `src/app.ts` first.\nThen more.')).toBe('I will check src/app.ts first.')
    expect(textHeadline('## Plan\n- one')).toBe('Plan')
    expect(textHeadline('   ')).toBe('')
    expect(textHeadline('x'.repeat(300), 20)).toHaveLength(20)
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
      'Thought, read 2 files, searched 2 times and ran 1 command',
    )
    expect(activitySummary([read('a'), shell('b', { status: 'running' }), shell('c')])).toBe('Read 1 file and running 2 commands')
    expect(activitySummary([read('a'), thought], true)).toBe('Thinking and read 1 file')
    expect(activitySummary([thought, thought, read('a')])).toBe('Thought 2 times and read 1 file')
    expect(activitySummary([tool('webfetch', {}), tool('websearch', {}), tool('skill', {}), tool('execute', {}), tool('todowrite', {})])).toBe(
      'Searched once, fetched 1 page, loaded 1 skill, called 1 tool and updated the to-do list',
    )
    expect(activitySummary([thought])).toBe('Thought')
    expect(activitySummary([{ kind: 'text', text: 'a' }, thought, read('a'), { kind: 'text', text: 'b' }])).toBe('Thought, wrote 2 updates and read 1 file')
    expect(activitySummary([{ kind: 'text', text: 'a' }])).toBe('Wrote an update')
    expect(activitySummary([])).toBe('Activity')
  })
})

describe('the compact layout', () => {
  const read = (id: string): ChatPart => tool('read', { path: `/app/${id}.ts` }, { id })
  const shell = (id: string, extra: Partial<ToolPart> = {}): ChatPart => tool('shell', { command: 'ls' }, { id, ...extra })
  const thought = (words = 'Hmm'): ChatPart => ({ kind: 'reasoning', text: words })
  const text = (words = 'Done'): ChatPart => ({ kind: 'text', text: words })
  const edit = (id: string): ChatPart => tool('edit', { filePath: 'a.ts', oldString: 'a', newString: 'b' }, { id })
  const step = (id: string, parts: ChatPart[], live = false): FlowStep => ({ id, parts, live })

  /** What is drawn for each step, as short words: `group:3` for a group of three. */
  const draw = (steps: FlowStep[]): Record<string, string[]> =>
    Object.fromEntries(
      [...compactFlow(steps)].map(([id, blocks]) => [
        id,
        blocks.map((block) => block.kind === 'activity' ? `group:${block.items.length}` : block.kind === 'subagents' ? 'subagents' : block.part.kind === 'tool' ? block.part.id : block.part.kind),
      ]),
    )

  it('folds a stretch of activity into one group, however short', () => {
    expect(draw([step('a', [read('r1')])])).toEqual({ a: ['group:1'] })
    expect(draw([step('a', [thought(), read('r1'), shell('s1'), text()])])).toEqual({ a: ['group:3', 'text'] })
  })

  it('folds the words the agent wrote on its way into the group, and draws only the answer', () => {
    // The text before the last piece of work is the agent talking its way through it; the text after, the answer.
    expect(draw([step('a', [text('I will look.'), read('r1'), text('Now the fix.'), shell('s1'), text('All done.')])])).toEqual({ a: ['group:4', 'text'] })
    expect(draw([step('a', [text('I will look.'), read('r1')])])).toEqual({ a: ['group:2'] })
    // A thought after the words is work too, so the words are before it.
    expect(draw([step('a', [text('Hmm.'), thought()])])).toEqual({ a: ['group:2'] })
    // Several texts after the last work are all the answer.
    expect(draw([step('a', [shell('s1'), text('One.'), text('Two.')])])).toEqual({ a: ['group:1', 'text', 'text'] })
    // Without any work, what the agent wrote is the answer.
    expect(draw([step('a', [text('Just words.')])])).toEqual({ a: ['text'] })
    expect(draw([step('a', [thought(), text('The answer.')])])).toEqual({ a: ['group:1', 'text'] })
  })

  it('keeps file changes and subagents inside the same stretch of activity', () => {
    expect(draw([step('a', [read('r1'), text('Fixing it.'), edit('e1'), shell('s1'), text('Done.')])])).toEqual({ a: ['group:4', 'text'] })
    expect(draw([step('a', [text('Fixing it.'), edit('e1'), text('Done.')])])).toEqual({ a: ['group:2', 'text'] })
    const subagent = tool('subagent', { agent: 'general', description: 'd', prompt: 'p' }, { id: 'sub' })
    expect(draw([step('a', [read('r1'), subagent, read('r2')])])).toEqual({ a: ['group:3'] })
  })

  it.each(['read', 'write', 'edit', 'patch', 'apply_patch', 'subagent', 'task', 'shell', 'bash', 'grep', 'glob', 'webfetch', 'websearch', 'lookup', 'todo', 'skill', 'execute', 'custom-tool'])(
    'keeps %s in one compact group across pending, running, completed and failed states', (name) => {
      for (const status of ['pending', 'running', 'completed', 'error'] as const) {
        const call = tool(name, { patchText: '*** Begin Patch\n*** Add File: a.ts\n+hello\n*** End Patch', questions: [{ question: 'Which?' }] }, { id: 'call', status, answers: [['A']] })
        expect(draw([step('a', [thought(), text('Working.'), call]), step('b', [thought(), text('Done.')])]))
          .toEqual({ a: ['group:4'], b: ['text'] })
      }
    },
  )

  describe('around a question', () => {
    const question = (id: string, extra: Partial<ToolPart> = {}): ChatPart => tool('question', { questions: [{ question: 'Which?' }] }, { id, ...extra })

    it('shows the words that lead up to a question, and the question, in every state', () => {
      for (const status of ['pending', 'running', 'completed', 'error'] as const) {
        expect(draw([step('a', [read('r1'), thought(), text('Two ways to fix it: A or B.'), question('q', { status, answers: [['A']] })])]))
          .toEqual({ a: ['group:2', 'text', 'q'] })
      }
    })

    it('ends the stretch at the question, so the work after the answer is a line of its own', () => {
      expect(draw([
        step('a', [text('Looking.'), read('r1'), text('Found two causes.'), question('q')]),
        step('b', [thought(), edit('e1'), shell('s1')]),
        step('c', [text('Fixed.')]),
      ])).toEqual({ a: ['group:2', 'text', 'q'], b: ['group:3'], c: ['text'] })
    })

    it('shows only the words since the last tool call before the question', () => {
      expect(draw([step('a', [text('I will look.'), read('r1'), text('The cause is X.'), text('Which fix?'), question('q')])]))
        .toEqual({ a: ['group:2', 'text', 'text', 'q'] })
      // The words may end one step and the question start the next.
      expect(draw([step('a', [shell('s1'), text('Pick one.')]), step('b', [question('q')])])).toEqual({ a: ['group:1', 'text'], b: ['q'] })
    })

    it('keeps a thought between the words and the question as a line of its own', () => {
      expect(draw([step('a', [read('r1'), text('Two options.'), thought(), question('q')])])).toEqual({ a: ['group:1', 'text', 'group:1', 'q'] })
    })

    it('draws a question asked with no words before it on its own', () => {
      expect(draw([step('a', [read('r1'), question('q'), read('r2')])])).toEqual({ a: ['group:1', 'q', 'group:1'] })
      expect(draw([step('a', [question('q')])])).toEqual({ a: ['q'] })
    })

    it('has no live group while the agent waits for an answer, and a new live one once it works on', () => {
      const groups = (steps: FlowStep[]) => [...compactFlow(steps).values()].flat()
        .filter((block): block is Extract<RenderBlock, { kind: 'activity' }> => block.kind === 'activity')
        .map((group) => group.live)
      expect(groups([step('a', [read('r1'), text('Which?'), question('q', { status: 'running' })], true)])).toEqual([false])
      expect(groups([step('a', [read('r1'), text('Which?'), question('q')]), step('b', [shell('s1')], true)])).toEqual([false, true])
    })
  })

  it('runs a stretch on across the steps of the agent, and draws it where it starts', () => {
    const flow = compactFlow([
      step('a', [text('Looking.'), shell('s1'), shell('s2')]),
      step('b', [read('r1'), thought()]),
      step('c', [read('r2')]),
      step('d', [text('Done.')]),
    ])
    const group = flow.get('a')![0] as Extract<RenderBlock, { kind: 'activity' }>
    expect(group.kind).toBe('activity')
    expect(group.items.map((item) => [item.messageId, item.index])).toEqual([['a', 0], ['a', 1], ['a', 2], ['b', 0], ['b', 1], ['c', 0]])
    expect(flow.get('b')).toEqual([])
    expect(flow.get('c')).toEqual([])
    expect(flow.get('d')!.map((block) => block.kind)).toEqual(['part'])
  })

  it('folds the words between the steps into the stretch, and shows the answer in the last one', () => {
    const steps = [step('a', [text('I will look.'), read('r1')]), step('b', [text('Now the tests.'), shell('s1')]), step('c', [text('All done.')])]
    expect(draw(steps)).toEqual({ a: ['group:4'], b: [], c: ['text'] })
    const group = compactFlow(steps).get('a')![0] as Extract<RenderBlock, { kind: 'activity' }>
    expect(group.items.map((item) => item.part.kind)).toEqual(['text', 'tool', 'text', 'tool'])
  })

  it('continues across file changes in later steps and keeps the final answer visible', () => {
    expect(draw([step('a', [read('r1')]), step('b', [edit('e1'), read('r2')])])).toEqual({ a: ['group:3'], b: [] })
    expect(draw([step('a', [read('r1')]), step('b', [text('Final.')])])).toEqual({ a: ['group:1'], b: ['text'] })
  })

  it('does not let a text that has only begun to stream break the stretch, and does not draw it', () => {
    expect(draw([step('a', [read('r1'), text('  ')]), step('b', [read('r2')])])).toEqual({ a: ['group:2'], b: [] })
  })

  it('has the group the agent is at the end of live while the last step is being written', () => {
    const lastGroup = (steps: FlowStep[], id = 'a') => [...compactFlow(steps).get(id)!].reverse().find((block) => block.kind === 'activity') as Extract<RenderBlock, { kind: 'activity' }>
    expect(lastGroup([step('a', [text('Looking.'), shell('s1')], true)]).live).toBe(true)
    // The new step has nothing yet: the agent is still at work on what came before.
    expect(lastGroup([step('a', [shell('s1')]), step('b', [], true)]).live).toBe(true)
    // Writing its answer, or finished, it is not at the activity.
    expect(lastGroup([step('a', [shell('s1'), text('Now')], true)]).live).toBe(false)
    expect(lastGroup([step('a', [shell('s1')], false)]).live).toBe(false)
    // A file change no longer splits the live activity into separate groups.
    const groups = compactFlow([step('a', [shell('s1'), edit('e1'), shell('s2')], true)]).get('a')!.filter((block) => block.kind === 'activity') as Array<Extract<RenderBlock, { kind: 'activity' }>>
    expect(groups.map((group) => group.live)).toEqual([true])
  })

  it('shows the words being written as they are until more work follows, and folds them then', () => {
    // The agent is writing text after its work: it is the answer so far.
    expect(draw([step('a', [shell('s1'), text('I think the')], true)])).toEqual({ a: ['group:1', 'text'] })
    // A new tool call arrives, and the words before it were not the answer after all.
    expect(draw([step('a', [shell('s1'), text('I think the cause is X.'), shell('s2')], true)])).toEqual({ a: ['group:3'] })
  })

  describe('of a conversation', () => {
    const assistant = (id: string, parts: ChatPart[], completed = true): ChatMessage =>
      ({ kind: 'assistant', id, time: 1, agent: 'build', model: { id: 'm', providerId: 'p' }, parts, completed }) as ChatMessage
    const user = (id: string): ChatMessage => ({ kind: 'user', id, time: 1, text: 'Go' }) as ChatMessage
    const note = (id: string): ChatMessage => ({ kind: 'note', id, time: 1, tone: 'info', text: 'Switched' }) as ChatMessage
    const shape = (plans: Map<string, RenderBlock[]>) => Object.fromEntries([...plans].map(([id, blocks]) => [id, blocks.map((block) => block.kind)]))

    it('joins routine notifications without splitting work and keeps their order and details', () => {
      const notice: ChatMessage = { kind: 'note', id: 'n1', time: 1, tone: 'info', text: 'python3 server.py', detail: 'Exited cleanly.', activity: 'notice' }
      const messages = [user('u1'), assistant('a1', [shell('s1')]), notice, assistant('a2', [thought(), text('Stopped.')])]
      const plans = compactPlans(messages, undefined)
      expect(shape(plans)).toEqual({ a1: ['activity'], n1: [], a2: ['part'] })
      const group = plans.get('a1')![0] as Extract<RenderBlock, { kind: 'activity' }>
      expect(group.items.map((item) => item.part.kind)).toEqual(['tool', 'note', 'reasoning'])
      expect(group.items[1]?.part).toBe(notice)
      expect(activitySummary(group.items.map((item) => item.part))).toBe('Thought, ran 1 command and received 1 update')
      expect(compactPlans(messages, undefined, plans).get('a1')).toBe(plans.get('a1'))
    })

    it('keeps live activity live when a routine notification follows it', () => {
      const notice: ChatMessage = { kind: 'note', id: 'n1', time: 1, tone: 'info', text: 'Process update', activity: 'notice' }
      const plans = compactPlans([assistant('a1', [thought()], false), notice], 'a1')
      expect((plans.get('a1')![0] as Extract<RenderBlock, { kind: 'activity' }>).live).toBe(true)
    })

    it('keeps errors, compaction and goal notices outside the group', () => {
      const base = { kind: 'note' as const, id: 'n1', time: 1, text: 'Notice', tone: 'info' as const, activity: 'notice' as const }
      const notices: ChatMessage[] = [
        { ...base, tone: 'error' },
        { ...base, compaction: { status: 'running', reason: 'auto' } },
        { ...base, goal: 'set' },
      ]
      for (const notice of notices) {
        const plans = compactPlans([assistant('a1', [shell('s1')]), notice, assistant('a2', [thought()])], undefined)
        expect(shape(plans)).toEqual({ a1: ['activity'], a2: ['activity'] })
        expect(plans.has('n1')).toBe(false)
      }
    })

    it('lays out each run of steps together, and ends a run at the person or at a note', () => {
      const plans = compactPlans(
        [user('u1'), assistant('a1', [shell('s1')]), assistant('a2', [shell('s2')]), user('u2'), assistant('a3', [shell('s3')]), note('n1'), assistant('a4', [shell('s4')])],
        undefined,
      )
      expect(shape(plans)).toEqual({ a1: ['activity'], a2: [], a3: ['activity'], a4: ['activity'] })
      expect((plans.get('a1')![0] as Extract<RenderBlock, { kind: 'activity' }>).items).toHaveLength(2)
      expect([...plans.keys()]).not.toContain('u1')
    })

    it('has only the live step of the agent live', () => {
      const messages = [assistant('a1', [shell('s1')]), assistant('a2', [shell('s2')], false)]
      const group = (id: string | undefined) => (compactPlans(messages, id).get('a1')![0] as Extract<RenderBlock, { kind: 'activity' }>).live
      expect(group('a2')).toBe(true)
      expect(group(undefined)).toBe(false)
      // A step that was left unfinished, and is not the one being written, is not live.
      expect(group('a1')).toBe(false)
    })

    it('keeps the earlier layout of a step whose layout did not change', () => {
      const first = [assistant('a1', [text('Hi'), shell('s1')]), assistant('a2', [text('Next')], false)]
      const before = compactPlans(first, 'a2')
      // The conversation streams on: a2 gets longer, and a1's parts are the same objects.
      const second = [first[0]!, assistant('a2', [text('Next, and more')], false)]
      const after = compactPlans(second, 'a2', before)
      expect(after.get('a1')).toBe(before.get('a1'))
      expect(after.get('a2')).not.toBe(before.get('a2'))
      // A change that reaches an earlier step (the group grows) is a new layout for it.
      const third = [first[0]!, assistant('a2', [shell('s2')], false)]
      const grown = compactPlans(third, 'a2', after)
      expect(grown.get('a1')).not.toBe(after.get('a1'))
      expect(samePlan(grown.get('a1')!, after.get('a1')!)).toBe(false)
      expect(grown.get('a2')).toEqual([])
    })
  })
})
