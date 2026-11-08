import { describe, expect, it, vi } from 'vitest'
import { FILE_MENTION_LIMIT, fileMentionTokens, fileTriggerAt, isMentionablePath, mentionText } from '../src/shared/file-mentions'
import { fileUri, mentionAttachments, resolveFile, type FileFinder } from '../src/main/inbox/file-mentions'
import { parseFileEntries, parseMessage } from '../src/main/opencode/service/parse'
import { InboxChatService } from '../src/main/inbox/chat'
import { InboxRecorder } from '../src/main/inbox/recorder'
import { InboxStore } from '../src/main/inbox/store'
import { OpenCodeServiceError, type ServiceOperation, type ServiceRequest } from '../src/main/opencode/service/client'
import { applyFile, describeFile, splitMentions } from '../src/renderer/lib/file-mentions'
import type { ChatFileEntry } from '../src/shared/types'

describe('writing a path after an @', () => {
  it('writes a plain path as it is and a path with a space or punctuation in quotes', () => {
    expect(mentionText('src/app.ts')).toBe('@src/app.ts')
    expect(mentionText('src/')).toBe('@src/')
    expect(mentionText('my notes.txt')).toBe('@"my notes.txt"')
    expect(mentionText('src/(group)/page.tsx')).toBe('@"src/(group)/page.tsx"')
    expect(mentionText('a,b.txt')).toBe('@"a,b.txt"')
    // A trailing full stop would read as the end of a sentence.
    expect(mentionText('LICENSE.')).toBe('@"LICENSE."')
  })

  it('names only paths that stay inside the project and can be written', () => {
    for (const path of ['a.ts', 'src/a b.ts', 'src/', '.github/workflows/x.yml', 'ü/ß.md']) expect(isMentionablePath(path), path).toBe(true)
    for (const path of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'a\\b', 'a"b', 'a\nb', 'x'.repeat(1001)]) expect(isMentionablePath(path), JSON.stringify(path)).toBe(false)
  })
})

describe('the @word being typed', () => {
  it('finds the word the caret is at the end of, and where it ends', () => {
    expect(fileTriggerAt('@', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(fileTriggerAt('look at @src/ap', 15)).toEqual({ start: 8, end: 15, query: 'src/ap' })
    // In the middle of a word the choice replaces the whole word.
    expect(fileTriggerAt('look at @src/app.ts now', 13)).toEqual({ start: 8, end: 19, query: 'src/' })
    expect(fileTriggerAt('see (@src/a', 11)).toEqual({ start: 5, end: 11, query: 'src/a' })
    expect(fileTriggerAt('line\n@x', 7)).toEqual({ start: 5, end: 7, query: 'x' })
  })

  it('does not trigger inside an address, after the word has ended, or for a skill', () => {
    expect(fileTriggerAt('mail me@example.com', 19)).toBeNull()
    expect(fileTriggerAt('@src/a.ts and', 13)).toBeNull()
    expect(fileTriggerAt('use $demo', 9)).toBeNull()
    expect(fileTriggerAt('@a', 5)).toBeNull()
    expect(fileTriggerAt('@a', -1)).toBeNull()
  })

  it('reads a quoted word to its closing quote, and no further than the line', () => {
    expect(fileTriggerAt('@"my no', 7)).toEqual({ start: 0, end: 7, query: 'my no' })
    expect(fileTriggerAt('@"my no" next', 7)).toEqual({ start: 0, end: 8, query: 'my no' })
    expect(fileTriggerAt('@"my no\nand "quoted"', 7)).toEqual({ start: 0, end: 7, query: 'my no' })
  })
})

describe('the mentions a message makes', () => {
  it('lists each @path that starts a word, with where it is', () => {
    const text = 'Compare @src/a.ts with (@docs/) and @"my notes.txt", please.'
    const at = (word: string): number => text.indexOf(word)
    expect(fileMentionTokens(text)).toEqual([
      { start: at('@src/a.ts'), end: at('@src/a.ts') + 9, text: '@src/a.ts', path: 'src/a.ts' },
      { start: at('@docs/'), end: at('@docs/') + 6, text: '@docs/', path: 'docs/' },
      { start: at('@"my'), end: at('@"my') + 15, text: '@"my notes.txt"', path: 'my notes.txt' },
    ])
    for (const token of fileMentionTokens(text)) expect(text.slice(token.start, token.end)).toBe(token.text)
  })

  it('leaves the full stop that ends a sentence out of the path', () => {
    expect(fileMentionTokens('Read @README.md. Then @src/a.ts.')).toMatchObject([{ path: 'README.md' }, { path: 'src/a.ts' }])
  })

  it('skips words that only look like mentions', () => {
    expect(fileMentionTokens('me@example.com @ @@ @/etc/passwd @../x @a//b @')).toEqual([])
    expect(fileMentionTokens('@"unclosed quote\n@real.ts')).toMatchObject([{ path: 'real.ts' }])
  })

  it('stops reading after a bounded number of mentions', () => {
    const text = Array.from({ length: 200 }, (_, index) => `@f${index}.ts`).join(' ')
    expect(fileMentionTokens(text).length).toBeLessThanOrEqual(FILE_MENTION_LIMIT * 2)
  })
})

const entry = (path: string): ChatFileEntry => ({ path, directory: path.endsWith('/') })

describe('what OpenCode finds for an @', () => {
  it('keeps files and folders in its order, closing folders with a slash and dropping the root', () => {
    expect(parseFileEntries({ data: [
      { path: '/', type: 'directory' },
      { path: 'src/app.ts', type: 'file' },
      { path: 'src', type: 'directory' },
      { path: 'src/', type: 'directory' },
      { path: '../outside', type: 'file' },
      { path: 'a"b', type: 'file' },
      { path: 7, type: 'file' },
      null,
    ] })).toEqual([{ path: 'src/app.ts', directory: false }, { path: 'src/', directory: true }])
  })

  it('does not accept an answer that is not a list', () => {
    expect(() => parseFileEntries({ nothing: true })).toThrow('does not understand')
  })
})

describe('attaching what a message names', () => {
  const project = ['src/app.ts', 'src/sub/', 'my notes.txt', 'README.md']
  const finder = (calls: string[] = []): FileFinder => async (query) => {
    calls.push(query)
    return project.filter((path) => path.toLowerCase().includes(query.toLowerCase().replace(/\/$/, ''))).map(entry)
  }

  it('writes the address of a file with each part encoded', () => {
    expect(fileUri('/home/me/app', 'src/app.ts')).toBe('file:///home/me/app/src/app.ts')
    expect(fileUri('/home/me/app/', 'my notes #1.txt')).toBe('file:///home/me/app/my%20notes%20%231.txt')
    expect(fileUri('/home/me/my app', 'src/sub/')).toBe('file:///home/me/my%20app/src/sub/')
  })

  it('finds a path as itself, or as the folder of that name', async () => {
    expect(await resolveFile(finder(), 'src/app.ts')).toEqual(entry('src/app.ts'))
    expect(await resolveFile(finder(), 'src/sub')).toEqual(entry('src/sub/'))
    expect(await resolveFile(finder(), 'src/sub/')).toEqual(entry('src/sub/'))
    // Something that only resembles it is not it.
    expect(await resolveFile(finder(), 'src/ap')).toBeNull()
  })

  it('attaches the paths the project has, with where each was written, and leaves the rest as text', async () => {
    const text = 'Compare @src/app.ts to @src/sub and @"my notes.txt" but not @alice or @gone.ts'
    const attached = await mentionAttachments(finder(), '/home/me/app', text)
    const at = (word: string): number => text.indexOf(word)
    expect(attached).toEqual([
      { uri: 'file:///home/me/app/src/app.ts', name: 'src/app.ts', mention: { start: at('@src/app.ts'), end: at('@src/app.ts') + 11, text: '@src/app.ts' } },
      { uri: 'file:///home/me/app/src/sub/', name: 'src/sub/', mention: { start: at('@src/sub'), end: at('@src/sub') + 8, text: '@src/sub' } },
      { uri: 'file:///home/me/app/my%20notes.txt', name: 'my notes.txt', mention: { start: at('@"my'), end: at('@"my') + 15, text: '@"my notes.txt"' } },
    ])
  })

  it('attaches a path named twice once, where it was first written, and asks about it once', async () => {
    const calls: string[] = []
    const attached = await mentionAttachments(finder(calls), '/p', '@README.md and again @README.md')
    expect(attached).toHaveLength(1)
    expect(attached[0]?.mention.start).toBe(0)
    expect(calls).toEqual(['README.md'])
  })

  it('attaches no more than the limit', async () => {
    const find: FileFinder = async (query) => [entry(query)]
    const text = Array.from({ length: 30 }, (_, index) => `@f${index}.ts`).join(' ')
    expect(await mentionAttachments(find, '/p', text)).toHaveLength(FILE_MENTION_LIMIT)
  })

  it('goes on without a path whose search fails', async () => {
    const find: FileFinder = async (query) => {
      if (query === 'bad.ts') throw new Error('boom')
      return [entry(query)]
    }
    expect((await mentionAttachments(find, '/p', '@bad.ts @good.ts')).map((file) => file.name)).toEqual(['good.ts'])
  })
})

describe('a sent message that names files', () => {
  const user = (files: unknown[]) => parseMessage({ id: 'msg_1', type: 'user', time: { created: 1 }, text: 'Look at @src/app.ts and @src/sub/', files })

  it('shows what was named as mentions, not as attachments', () => {
    const message = user([
      { data: 'aGk=', mime: 'text/plain', source: { type: 'uri', uri: 'file:///p/src/app.ts' }, name: 'src/app.ts', mention: { start: 8, end: 19, text: '@src/app.ts' } },
      { data: 'YQ==', mime: 'application/x-directory', source: { type: 'uri', uri: 'file:///p/src/sub/' }, name: 'src/sub/', mention: { start: 24, end: 34, text: '@src/sub/' } },
    ])
    expect(message).toMatchObject({
      kind: 'user',
      mentions: [
        { text: '@src/app.ts', path: 'src/app.ts', directory: false },
        { text: '@src/sub/', path: 'src/sub/', directory: true },
      ],
    })
    expect(message).not.toHaveProperty('attachments')
  })

  it('keeps a file that was attached by hand as an attachment beside the mentions', () => {
    const message = user([
      { data: 'aGk=', mime: 'text/plain', source: { type: 'inline' }, name: 'notes.txt' },
      { data: 'aGk=', mime: 'text/plain', source: { type: 'uri', uri: 'file:///p/src/app.ts' }, name: 'src/app.ts', mention: { start: 8, end: 19, text: '@src/app.ts' } },
    ])
    expect(message).toMatchObject({ attachments: [{ name: 'notes.txt', mime: 'text/plain', size: 2 }], mentions: [{ path: 'src/app.ts' }] })
  })

  it('ignores a mention that points outside the project or is not written as one', () => {
    const message = user([
      { data: 'aGk=', mime: 'text/plain', source: { type: 'uri', uri: 'file:///etc/passwd' }, name: '../etc/passwd', mention: { start: 0, end: 5, text: '@x' } },
      { data: 'aGk=', mime: 'text/plain', source: { type: 'uri', uri: 'file:///p/a' }, name: 'a', mention: { start: 0, end: 5, text: 'a' } },
    ])
    expect(message).not.toHaveProperty('mentions')
  })
})

describe('marking the mentions of a sent message', () => {
  const mentions = [
    { text: '@src/app.ts', path: 'src/app.ts', directory: false },
    { text: '@"my notes.txt"', path: 'my notes.txt', directory: false },
  ]

  it('cuts the text where the sent mentions are, and leaves any other @ as text', () => {
    expect(splitMentions('See @src/app.ts, @"my notes.txt" and @alice.', mentions).map((part) => [part.text, part.mention?.path])).toEqual([
      ['See ', undefined],
      ['@src/app.ts', 'src/app.ts'],
      [', ', undefined],
      ['@"my notes.txt"', 'my notes.txt'],
      [' and @alice.', undefined],
    ])
  })

  it('returns the text whole when nothing was named', () => {
    expect(splitMentions('Hi @src/app.ts', [])).toEqual([{ text: 'Hi @src/app.ts' }])
    expect(splitMentions('Hi there', mentions)).toEqual([{ text: 'Hi there' }])
    expect(splitMentions('Hi @src/other.ts', mentions)).toEqual([{ text: 'Hi @src/other.ts' }])
  })
})

describe('choosing a file in the picker', () => {
  it('writes the path over the word and puts the caret after a space', () => {
    const text = 'Look at @sr please'
    const trigger = fileTriggerAt(text, 11)!
    expect(applyFile(text, trigger, entry('src/app.ts'))).toEqual({ text: 'Look at @src/app.ts please', caret: 20 })
  })

  it('adds a space at the end of the text and quotes a path that needs it', () => {
    const trigger = fileTriggerAt('@no', 3)!
    expect(applyFile('@no', trigger, entry('my notes.txt'))).toEqual({ text: '@"my notes.txt" ', caret: 16 })
  })

  it('replaces a quoted word, closing quote and all', () => {
    const text = '@"my no" next'
    expect(applyFile(text, fileTriggerAt(text, 7)!, entry('my notes.txt'))).toEqual({ text: '@"my notes.txt" next', caret: 16 })
  })

  it('shows the name first and the folders after it', () => {
    expect(describeFile('src/main/app.ts')).toEqual({ name: 'app.ts', folder: 'src/main/' })
    expect(describeFile('src/main/')).toEqual({ name: 'main/', folder: 'src/' })
    expect(describeFile('README.md')).toEqual({ name: 'README.md', folder: '' })
  })
})

describe('the files and folders of a project, through the chat service', () => {
  const model = { id: 'model-1', providerId: 'provider-1' }
  const project = ['src/app.ts', 'src/sub/', 'my notes.txt', 'README.md']

  function setup(options: { find?: (query: string) => unknown } = {}) {
    const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
    const recorder = new InboxRecorder(store, { now: () => 1_000, readBranch: async () => 'main', onChanged: () => {} })
    const calls: { operation: ServiceOperation; request: ServiceRequest }[] = []
    const request = vi.fn(async (_target: unknown, operation: ServiceOperation, req: ServiceRequest = {}) => {
      calls.push({ operation, request: req })
      if (operation === 'session.create') return { data: { id: 'ses_new' } }
      if (operation === 'fs.find') {
        const query = req.query?.query ?? ''
        if (options.find) return options.find(query)
        return { data: project.filter((path) => path.toLowerCase().includes(query.toLowerCase().replace(/\/$/, ''))).map((path) => ({ path, type: path.endsWith('/') ? 'directory' : 'file' })) }
      }
      return null
    })
    let nextId = 0
    const service = new InboxChatService({
      client: { request, openEvents: vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {})), reset: vi.fn(), endpoint: async () => ({ url: 'http://127.0.0.1:49374', password: 'test-password' }) },
      store,
      recorder,
      send: () => {},
      enabled: () => true,
      now: () => 1_000,
      createId: () => (nextId++ === 0 ? 'abc' : `abc${nextId}`),
      sleep: async () => {},
    })
    const folder = service.addFolder({ directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu-24.04' } })
    return { service, folder, calls }
  }
  const prompts = (calls: { operation: ServiceOperation; request: ServiceRequest }[]) => calls.filter((call) => call.operation === 'session.prompt')

  it('asks OpenCode for the files that fit what was typed, in the folder or thread', async () => {
    const { service, folder, calls } = setup()
    expect(await service.files({ folderId: folder.id, query: 'app' })).toEqual([{ path: 'src/app.ts', directory: false }])
    expect(calls[0]).toEqual({ operation: 'fs.find', request: { query: { 'location[directory]': '/home/me/app', query: 'app', limit: '40' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    expect(await service.files({ threadId: 'ses_new', query: 'notes' })).toEqual([{ path: 'my notes.txt', directory: false }])
    service.stop()
  })

  it('refuses a folder or thread that is gone', async () => {
    const { service } = setup()
    await expect(service.files({ folderId: 'fld_gone', query: '' })).rejects.toThrow('no longer in the Inbox')
    await expect(service.checkFiles({ threadId: 'ses_gone', paths: ['a'] })).rejects.toThrow('no longer in the Inbox')
  })

  it('tells which of some paths the folder has, as they were written', async () => {
    const { service, folder } = setup()
    expect(await service.checkFiles({ folderId: folder.id, paths: ['src/app.ts', 'src/sub', 'nope.ts', 'src/app.ts', 'my notes.txt'] })).toEqual([
      { path: 'src/app.ts', directory: false },
      { path: 'src/sub', directory: true },
      { path: 'my notes.txt', directory: false },
    ])
  })

  it('counts a path whose search fails as not there', async () => {
    const { service, folder } = setup({ find: () => { throw new OpenCodeServiceError('Not found', 404) } })
    expect(await service.checkFiles({ folderId: folder.id, paths: ['a.ts'] })).toEqual([])
  })

  it('sends the files a message names as attachments with their place in the text', async () => {
    const { service, folder, calls } = setup()
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    const text = 'Explain @src/app.ts and @"my notes.txt", not @alice'
    await service.send({ threadId: 'ses_new', text })
    expect(prompts(calls)[0]?.request).toEqual({
      params: { sessionID: 'ses_new' },
      body: {
        text,
        files: [
          { uri: 'file:///home/me/app/src/app.ts', name: 'src/app.ts', mention: { start: 8, end: 19, text: '@src/app.ts' } },
          { uri: 'file:///home/me/app/my%20notes.txt', name: 'my notes.txt', mention: { start: 24, end: 39, text: '@"my notes.txt"' } },
        ],
      },
    })
    service.stop()
  })

  it('sends the first message of a thread with its files too', async () => {
    const { service, folder, calls } = setup()
    await service.create({ folderId: folder.id, text: 'Read @README.md', agent: 'build', model })
    expect((prompts(calls)[0]?.request.body as { files: unknown[] }).files).toEqual([
      { uri: 'file:///home/me/app/README.md', name: 'README.md', mention: { start: 5, end: 15, text: '@README.md' } },
    ])
    service.stop()
  })

  it('asks nothing about the project when the message has no @', async () => {
    const { service, folder, calls } = setup()
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    await service.send({ threadId: 'ses_new', text: 'no files here' })
    expect(calls.map((call) => call.operation)).toEqual(['session.prompt'])
    expect(prompts(calls)[0]?.request.body).toEqual({ text: 'no files here' })
    service.stop()
  })

  it('sends the message as plain text when the project cannot be searched', async () => {
    const { service, folder, calls } = setup({ find: () => { throw new OpenCodeServiceError('Not found', 404) } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    await service.send({ threadId: 'ses_new', text: 'Read @README.md' })
    expect(prompts(calls)[0]?.request.body).toEqual({ text: 'Read @README.md' })
    service.stop()
  })
})
