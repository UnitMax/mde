import { testLayout } from './helpers/terminal-layout'
import { MAX_TERMINAL_COUNT } from '../src/shared/terminal-layouts'
import { describe, expect, it } from 'vitest'
import { IpcChannels } from '../src/shared/ipc'
import { assertIpcPayload, IPC_LIMITS, ipcPayloadValidators, type IpcChannel } from '../src/main/ipc-validation'

const palette = { foreground: '#ffffff', background: '#000000' }
const size = { cols: 80, rows: 24 }
const ensure = { terminalId: 'pane', sessionId: 'session', palette, size }
const layout = testLayout([{ id: 'pane' }])
const sessionId = { sessionId: 'session' }
const terminalId = { terminalId: 'pane' }
const tab = { sessionId: 'session', tabId: 'tab' }
const model = { id: 'model-1', providerId: 'provider-1' }

/** Explicit legitimate fixtures prevent an exhaustive registry that rejects normal use. */
const validPayloads = {
  [IpcChannels.appInfo]: undefined,
  [IpcChannels.platformInfo]: undefined,
  [IpcChannels.workspaceList]: undefined,
  [IpcChannels.todoProjectsCreate]: { name: 'Tasks', shorthand: 'APP' },
  [IpcChannels.todoProjectsUpdate]: { id: 'project', patch: { shorthand: 'NEW' } },
  [IpcChannels.todoProjectsRemove]: 'project',
  [IpcChannels.todoTasksCreate]: { todoProjectId: 'project', columnId: 'todo', title: 'Task', description: '# Notes\n\nText' },
  [IpcChannels.todoTasksUpdate]: { id: 'task', patch: { description: '' } },
  [IpcChannels.todoTasksMove]: { id: 'task', columnId: 'done', beforeId: null },
  [IpcChannels.todoTasksRemove]: 'task',
  [IpcChannels.sessionsCreate]: { name: 'Shell', kind: 'wsl', distro: 'Ubuntu-24.04', shell: undefined },
  [IpcChannels.sessionsDuplicate]: 'session',
  [IpcChannels.sessionsUpdate]: { id: 'session', patch: { shell: '', icon: null, color: 'blue' } },
  [IpcChannels.sessionsReorder]: { id: 'session', beforeId: null },
  [IpcChannels.sessionsRemove]: 'session',
  [IpcChannels.tabsCreate]: sessionId,
  [IpcChannels.tabsSelect]: tab,
  [IpcChannels.tabsUpdate]: { ...tab, patch: { name: 'Tab', layout } },
  [IpcChannels.tabsRemove]: tab,
  [IpcChannels.ptyEnsure]: ensure,
  [IpcChannels.ptyRestart]: ensure,
  [IpcChannels.ptyWrite]: { terminalId: 'pane', data: '\x03\x1b[A\r\n' },
  [IpcChannels.ptyResize]: { terminalId: 'pane', size },
  [IpcChannels.ptyPalette]: { terminalId: 'pane', palette },
  [IpcChannels.ptyDispose]: 'pane',
  [IpcChannels.ptyStatuses]: undefined,
  [IpcChannels.ptyDirectories]: undefined,
  [IpcChannels.ptyDropFiles]: { terminalId: 'pane', files: [{ name: 'test.txt', nativePath: '/tmp/test.txt' }], mode: 'shell', treeEntry: undefined },
  [IpcChannels.clipboardWriteText]: 'copied\ntext',
  [IpcChannels.clipboardPaste]: undefined,
  [IpcChannels.wslAvailable]: undefined,
  [IpcChannels.wslDistros]: undefined,
  [IpcChannels.pathBrowse]: undefined,
  [IpcChannels.pathResolve]: { kind: 'wsl', distro: undefined, rawPath: '' },
  [IpcChannels.pathValidate]: { kind: 'native', path: 'C:\\src\\project' },
  [IpcChannels.pathListWslDirectories]: { distro: 'Ubuntu-24.04', path: '/home/me', hidden: true },
  [IpcChannels.pathRevealTerminal]: 'pane',
  [IpcChannels.pathOpenTerminalInVsCode]: 'pane',
  [IpcChannels.gitInfo]: { terminalId: 'pane', directory: '/workspace' },
  [IpcChannels.gitTerminalInfo]: terminalId,
  [IpcChannels.gitDiff]: { terminalId: 'pane', directory: '/workspace', path: 'src/file.ts' },
  [IpcChannels.filesList]: { sessionId: 'session', path: '' },
  [IpcChannels.filesRead]: { sessionId: 'session', path: 'src/file.ts' },
  [IpcChannels.inboxList]: undefined,
  [IpcChannels.inboxSetRead]: { id: 'ses_thread', read: true },
  [IpcChannels.inboxSetArchived]: { id: 'ses_thread', archived: false },
  [IpcChannels.inboxSetPinned]: { id: 'ses_thread', pinned: true },
  [IpcChannels.inboxSetCustomTitle]: { id: 'ses_thread', customTitle: 'My task' },
  [IpcChannels.inboxRemove]: { id: 'ses_thread' },
  [IpcChannels.inboxFolders]: undefined,
  [IpcChannels.inboxFoldersAdd]: { kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/app' },
  [IpcChannels.inboxFoldersRemove]: { id: 'fld_1234' },
  [IpcChannels.inboxComposerSet]: { folderId: 'fld_1234', agent: 'plan', model },
  [IpcChannels.inboxGitInfo]: { folderId: 'fld_1234' },
  [IpcChannels.chatConfigure]: { executable: 'opencode' },
  [IpcChannels.chatOptions]: { folderId: 'fld_1234' },
  [IpcChannels.chatDraft]: { key: 'thread:ses_one', action: 'load' },
  [IpcChannels.chatDrafts]: undefined,
  [IpcChannels.chatCreate]: { folderId: 'fld_1234', text: 'Fix the login\n\tplease', agent: 'build', model },
  [IpcChannels.inboxChangeDiff]: { threadId: 'ses_thread', path: 'src/app.ts' },
  [IpcChannels.inboxChanges]: { threadId: 'ses_thread', details: true },
  [IpcChannels.chatMessages]: { threadId: 'ses_thread', cursor: 'eyJpZCI6Im1zZyJ9' },
  [IpcChannels.chatSend]: { threadId: 'ses_thread', text: 'Next step', agent: 'plan', model },
  [IpcChannels.chatInterrupt]: { threadId: 'ses_thread' },
  [IpcChannels.chatRedo]: { threadId: 'ses_thread' },
  [IpcChannels.chatDiscardPending]: { threadId: 'ses_thread', messageId: 'msg_1995ecb990017ppXoSN0T9zH6a' },
  [IpcChannels.chatSetDelivery]: { threadId: 'ses_thread', messageId: 'msg_1995ecb990017ppXoSN0T9zH6a', delivery: 'queue' },
  [IpcChannels.chatMcp]: { threadId: 'ses_thread' },
  [IpcChannels.chatMcpSet]: { folderId: 'fld_1234', server: 'context 7', enabled: false },
  [IpcChannels.chatRevert]: { threadId: 'ses_thread', messageId: 'msg_1995ecb990017ppXoSN0T9zH6a', files: false },
  [IpcChannels.chatFork]: { threadId: 'ses_thread', messageId: 'msg_1995ecb990017ppXoSN0T9zH6a' },
  [IpcChannels.chatRegenerateTitle]: { threadId: 'ses_thread' },
  [IpcChannels.chatRequests]: { threadId: 'ses_thread' },
  [IpcChannels.chatPermissionReply]: { threadId: 'ses_thread', requestId: 'per_1', decision: 'once' },
  [IpcChannels.chatFormReply]: { threadId: 'ses_thread', formId: 'frm_1', answer: { q0: 'Red', q1: ['a', 'b'], q2: true, q3: 3 } },
  [IpcChannels.chatSubscribe]: { threadId: 'ses_thread' },
  [IpcChannels.chatUnsubscribe]: { threadId: 'ses_thread' },
  [IpcChannels.windowModeGet]: undefined,
  [IpcChannels.windowModeSet]: { mode: 'mini' },
  [IpcChannels.windowChromeSet]: { color: '#10141b', symbolColor: '#7b8698' },
} satisfies Record<IpcChannel, unknown>

const channels = Object.values(IpcChannels)

function rejects(channel: IpcChannel, payload: unknown): void {
  expect(() => assertIpcPayload(channel, payload)).toThrow(`Invalid IPC payload for ${channel}.`)
}

describe('IPC payload boundary', () => {
  it('covers every channel exactly once', () => {
    expect(Object.keys(ipcPayloadValidators).sort()).toEqual([...channels].sort())
    expect(Object.keys(validPayloads).sort()).toEqual([...channels].sort())
  })

  it.each(channels)('accepts structured-cloned normal requests on %s', (channel) => {
    expect(() => assertIpcPayload(channel, structuredClone(validPayloads[channel]))).not.toThrow()
  })

  it.each(channels)('rejects malformed, oversized and prototype-shaped requests on %s', (channel) => {
    for (const value of [null, true, 42, [], new Date(), Object.create({ name: 'Inherited' }),
      JSON.parse('{"__proto__":{"polluted":true}}'), 'x'.repeat(IPC_LIMITS.text + 1)]) {
      rejects(channel, value)
    }
    const normal = validPayloads[channel]
    const extra = normal && typeof normal === 'object' ? { ...normal, unexpected: true } : { unexpected: true }
    rejects(channel, extra)
  })

  it('accepts a distro with an optional path and hidden flag when listing WSL folders', () => {
    const channel = IpcChannels.pathListWslDirectories
    expect(() => assertIpcPayload(channel, { distro: 'Ubuntu-24.04' })).not.toThrow()
    expect(() => assertIpcPayload(channel, { distro: 'Ubuntu-24.04', path: '/home/me/src' })).not.toThrow()
    rejects(channel, {})
    rejects(channel, { distro: '-d' })
    rejects(channel, { distro: 'Ubuntu\n' })
    rejects(channel, { distro: 'Ubuntu', path: '' })
    rejects(channel, { distro: 'Ubuntu', path: '/home/me\n/x' })
    rejects(channel, { distro: 'Ubuntu', path: 'x'.repeat(IPC_LIMITS.path + 1) })
    rejects(channel, { distro: 'Ubuntu', hidden: 'yes' })
    rejects(channel, { distro: 'Ubuntu', command: 'ls' })
  })

  it('accepts only OpenCode session IDs and booleans for inbox changes', () => {
    rejects(IpcChannels.inboxSetRead, { id: 'thread', read: true })
    rejects(IpcChannels.inboxSetRead, { id: 'ses_thread', read: 'yes' })
    rejects(IpcChannels.inboxSetArchived, { id: 'ses_../escape', archived: true })
    rejects(IpcChannels.inboxSetPinned, { id: 'thread', pinned: true })
    rejects(IpcChannels.inboxSetPinned, { id: 'ses_thread', pinned: 'yes' })
    rejects(IpcChannels.inboxSetPinned, { id: 'ses_thread' })
    rejects(IpcChannels.inboxRemove, { id: '' })
    expect(() => assertIpcPayload(IpcChannels.inboxRemove, { id: 'ses_thread', removeWorktree: true })).not.toThrow()
    rejects(IpcChannels.inboxRemove, { id: 'ses_thread', removeWorktree: 'yes' })
    rejects(IpcChannels.inboxGitInfo, { folderId: '../fld' })
    rejects(IpcChannels.inboxGitInfo, { folderId: 'fld_1234', directory: '/home/me/app' })
    rejects(IpcChannels.inboxList, { id: 'ses_thread' })
  })

  it('bounds chat requests', () => {
    rejects(IpcChannels.chatRedo, { threadId: 'ses_../escape' })
    for (const bad of [
      { threadId: 'ses_thread' },
      { threadId: 'ses_thread', messageId: 'ses_thread' },
      { threadId: 'ses_thread', messageId: 'msg_../escape' },
      { threadId: 'ses_thread', messageId: 'msg_' },
      { threadId: 'ses_thread', messageId: 'msg_1', files: 'no' },
      { threadId: 'ses_thread', messageId: 'msg_1', text: 'Injected' },
      { threadId: 'ses_../escape', messageId: 'msg_1' },
    ]) rejects(IpcChannels.chatRevert, bad)
    expect(() => assertIpcPayload(IpcChannels.chatRevert, { threadId: 'ses_thread', messageId: 'msg_1' })).not.toThrow()
    rejects(IpcChannels.chatRedo, { threadId: 'ses_thread', files: false })
    for (const bad of [
      {},
      { threadId: 'ses_../escape' },
      { threadId: 'ses_thread', messageId: 'ses_thread' },
      { threadId: 'ses_thread', messageId: 'msg_../escape' },
      { threadId: 'ses_thread', messageId: 'msg_' },
      { threadId: 'ses_thread', messageId: null },
      { threadId: 'ses_thread', before: 'msg_1' },
      { threadId: 'ses_thread', messageId: 'msg_1', title: 'Injected' },
    ]) rejects(IpcChannels.chatFork, bad)
    // A fork of the whole conversation names no message.
    expect(() => assertIpcPayload(IpcChannels.chatFork, { threadId: 'ses_thread' })).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.chatFork, { threadId: 'ses_thread', messageId: 'msg_1' })).not.toThrow()
    // Taking back a held message names the thread and the message, and nothing else.
    for (const bad of [
      {},
      { threadId: 'ses_thread' },
      { messageId: 'msg_1' },
      { threadId: 'ses_../escape', messageId: 'msg_1' },
      { threadId: 'ses_thread', messageId: 'ses_thread' },
      { threadId: 'ses_thread', messageId: 'msg_../escape' },
      { threadId: 'ses_thread', messageId: 'msg_' },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: 'steer' },
    ]) rejects(IpcChannels.chatDiscardPending, bad)
    expect(() => assertIpcPayload(IpcChannels.chatDiscardPending, { threadId: 'ses_thread', messageId: 'msg_1' })).not.toThrow()
    // Switching a held message names the thread, the message and one of the two ways of delivery.
    for (const bad of [
      {},
      { threadId: 'ses_thread', messageId: 'msg_1' },
      { threadId: 'ses_thread', delivery: 'steer' },
      { messageId: 'msg_1', delivery: 'steer' },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: 'later' },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: 'STEER' },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: null },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: ['steer'] },
      { threadId: 'ses_../escape', messageId: 'msg_1', delivery: 'steer' },
      { threadId: 'ses_thread', messageId: 'msg_../escape', delivery: 'steer' },
      { threadId: 'ses_thread', messageId: 'ses_thread', delivery: 'steer' },
      { threadId: 'ses_thread', messageId: 'msg_1', delivery: 'steer', text: 'Injected' },
    ]) rejects(IpcChannels.chatSetDelivery, bad)
    for (const delivery of ['steer', 'queue']) {
      expect(() => assertIpcPayload(IpcChannels.chatSetDelivery, { threadId: 'ses_thread', messageId: 'msg_1', delivery })).not.toThrow()
    }
    // A send may say how it reaches a busy agent; anything but the two ways is refused.
    for (const delivery of ['steer', 'queue']) {
      expect(() => assertIpcPayload(IpcChannels.chatSend, { threadId: 'ses_thread', text: 'Hi', delivery })).not.toThrow()
    }
    for (const delivery of ['later', 'STEER', '', null, 1, ['queue'], { mode: 'queue' }]) {
      rejects(IpcChannels.chatSend, { threadId: 'ses_thread', text: 'Hi', delivery })
    }
    rejects(IpcChannels.chatRegenerateTitle, { threadId: 'ses_../escape' })
    rejects(IpcChannels.chatRegenerateTitle, { threadId: 'ses_thread', title: 'Injected' })
    expect(() => assertIpcPayload(IpcChannels.chatCreate, { folderId: 'fld_1234', text: '', attachmentIds: ['a'], draftRevision: 1, agent: 'build', model })).not.toThrow()
    for (const mode of ['gui', 'terminal']) {
      expect(() => assertIpcPayload(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'Hi', agent: 'build', model, mode })).not.toThrow()
    }
    rejects(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'Hi', agent: 'build', model, mode: 'shell' })
    rejects(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'x'.repeat(100_001), agent: 'build', model })
    rejects(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'bell\u0007', agent: 'build', model })
    rejects(IpcChannels.chatCreate, { folderId: '../fld', text: 'Hi', agent: 'build', model })
    rejects(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'Hi', agent: '../build', model })
    rejects(IpcChannels.chatCreate, { folderId: 'fld_1234', text: 'Hi', agent: 'build', model: { id: 'm' } })
    // A worktree request names the branch to start from and, optionally, a valid name for the new one; never a path.
    const create = { folderId: 'fld_1234', text: 'Hi', agent: 'build', model }
    expect(() => assertIpcPayload(IpcChannels.chatCreate, { ...create, worktree: { base: 'origin/main' } })).not.toThrow()
    rejects(IpcChannels.chatCreate, { ...create, worktree: {} })
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: '' } })
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'x'.repeat(257) } })
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'main\nother' } })
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'main', path: '/home/me/elsewhere' } })
    expect(() => assertIpcPayload(IpcChannels.chatCreate, { ...create, worktree: { base: 'main', branch: 'feature/dark-mode_2' } })).not.toThrow()
    for (const branch of ['', ' ', '-f', '--force', 'two words', 'a..b', 'a//b', '/a', 'a/', 'a.lock', '.hidden', 'HEAD', 'x'.repeat(101), 'tab\there', 'new\nline', 'ünï', 'a:b', 'a~1']) {
      rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'main', branch } })
    }
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'main', branch: 42 } })
    rejects(IpcChannels.chatCreate, { ...create, worktree: { base: 'main', branch: null } })
    rejects(IpcChannels.chatCreate, { ...create, worktree: 'main' })
    rejects(IpcChannels.chatSend, { threadId: 'thread', text: 'Hi' })
    rejects(IpcChannels.chatMessages, { threadId: 'ses_thread', cursor: 'has space' })
    rejects(IpcChannels.chatPermissionReply, { threadId: 'ses_thread', requestId: 'per_1', decision: 'maybe' })
    rejects(IpcChannels.chatPermissionReply, { threadId: 'ses_thread', requestId: 'frm_1', decision: 'once' })
    rejects(IpcChannels.chatFormReply, { threadId: 'ses_thread', formId: 'frm_1', answer: { q0: { nested: true } } })
    rejects(IpcChannels.chatFormReply, { threadId: 'ses_thread', formId: 'frm_1', answer: [] })
    rejects(IpcChannels.chatFormReply, {
      threadId: 'ses_thread', formId: 'frm_1',
      answer: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`q${index}`, 'x']))
    })
    rejects(IpcChannels.inboxFoldersAdd, { kind: 'docker', path: '/home/me/app' })
    expect(() => assertIpcPayload(IpcChannels.chatOptions, { threadId: 'ses_thread' })).not.toThrow()
    rejects(IpcChannels.chatOptions, {})
    rejects(IpcChannels.chatOptions, { folderId: 'fld_1234', threadId: 'ses_thread' })
  })

  it('names exactly one place and a plain server name in the MCP requests', () => {
    expect(() => assertIpcPayload(IpcChannels.chatMcp, { folderId: 'fld_1234' })).not.toThrow()
    rejects(IpcChannels.chatMcp, {})
    rejects(IpcChannels.chatMcp, { folderId: 'fld_1234', threadId: 'ses_thread' })
    rejects(IpcChannels.chatMcp, { threadId: 'ses_../escape' })
    const set = { threadId: 'ses_thread', enabled: true }
    for (const server of ['demo_math', 'context 7', 'a.b', 'a/b', 'é', '.well-known', 'x'.repeat(200)]) {
      expect(() => assertIpcPayload(IpcChannels.chatMcpSet, { ...set, server })).not.toThrow()
    }
    // Names that would leave the URL path, or are not a name at all.
    for (const server of ['', '.', '..', '...', 'x'.repeat(201), 'a\nb', 'a\u0000b', 'a\u007fb', 3, null, ['a']]) {
      rejects(IpcChannels.chatMcpSet, { ...set, server })
    }
    rejects(IpcChannels.chatMcpSet, { threadId: 'ses_thread', server: 'demo_math' })
    rejects(IpcChannels.chatMcpSet, { threadId: 'ses_thread', server: 'demo_math', enabled: 'yes' })
    rejects(IpcChannels.chatMcpSet, { server: 'demo_math', enabled: true })
    rejects(IpcChannels.chatMcpSet, { folderId: 'fld_1234', threadId: 'ses_thread', server: 'demo_math', enabled: true })
  })

  it('rejects getters without executing them and inherited/unknown nested fields', () => {
    let accessed = false
    const payload = Object.defineProperty({}, 'name', { get: () => { accessed = true; return 'Project' } })
    rejects(IpcChannels.sessionsCreate, payload)
    expect(accessed).toBe(false)
    rejects(IpcChannels.sessionsUpdate, { id: 'session', patch: { kind: 'wsl' } })
    rejects(IpcChannels.todoTasksUpdate, { id: 'task', patch: Object.create({ title: 'Inherited' }) })
    rejects(IpcChannels.sessionsUpdate, { id: 'project', patch: JSON.parse('{"constructor":{}}') })
    rejects(IpcChannels.sessionsCreate, { name: 'Shell', kind: 'native', [Symbol('extra')]: true })
  })

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, IPC_LIMITS.terminalDimension + 1, '80'])('rejects invalid terminal dimensions: %s', (cols) => {
    rejects(IpcChannels.ptyEnsure, { ...ensure, size: { cols, rows: 24 } })
    rejects(IpcChannels.ptyResize, { terminalId: 'pane', size: { cols, rows: 24 } })
  })

  it('bounds labels, IDs, paths and text without logging the payload', () => {
    rejects(IpcChannels.sessionsCreate, { name: 'x'.repeat(IPC_LIMITS.label + 1), kind: 'native' })
    rejects(IpcChannels.sessionsRemove, 'x'.repeat(IPC_LIMITS.id + 1))
    rejects(IpcChannels.pathValidate, { kind: 'native', path: 'x'.repeat(IPC_LIMITS.path + 1) })
    rejects(IpcChannels.ptyWrite, { terminalId: 'pane', data: 'private'.repeat(IPC_LIMITS.text) })
    expect(() => assertIpcPayload(IpcChannels.clipboardWriteText, 'private'.repeat(IPC_LIMITS.text)))
      .toThrow(/^Invalid IPC payload for clipboard:write-text\.$/)
    rejects(IpcChannels.todoTasksCreate, { ...validPayloads[IpcChannels.todoTasksCreate], description: 42 })
    rejects(IpcChannels.sessionsUpdate, { id: 'session', patch: null })
  })

  it('rejects invalid enums and controls in process/path/identity fields', () => {
    rejects(IpcChannels.sessionsCreate, { ...validPayloads[IpcChannels.sessionsCreate], kind: 'remote' })
    rejects(IpcChannels.sessionsUpdate, { id: 'session', patch: { color: 'anything' } })
    rejects(IpcChannels.sessionsUpdate, { id: 'session', patch: { icon: 'anything' } })
    rejects(IpcChannels.windowModeSet, { mode: 'fullscreen' })
    rejects(IpcChannels.windowModeSet, { mode: undefined })
    for (const color of ['red', 'rgb(0,0,0)', 'url(x)', '#12', '#12345', '#1234567', '#gggggg', '10141b', '#10141b;', ' #10141b', '']) {
      rejects(IpcChannels.windowChromeSet, { color, symbolColor: '#ffffff' })
      rejects(IpcChannels.windowChromeSet, { color: '#ffffff', symbolColor: color })
    }
    rejects(IpcChannels.windowChromeSet, { color: '#ffffff' })
    expect(() => assertIpcPayload(IpcChannels.windowChromeSet, { color: '#FFF', symbolColor: '#aBc123' })).not.toThrow()
    rejects(IpcChannels.pathResolve, { kind: 'native', rawPath: '/tmp/a\0b' })
    rejects(IpcChannels.sessionsRemove, 'session\r')
  })

  it('validates new-pane launches, nested arguments and aggregate bounds', () => {
    const launch = { sourceTerminalId: 'source', agent: { kind: 'codex', command: { executable: 'codex', args: ['--model', 'example'] } } }
    expect(() => assertIpcPayload(IpcChannels.ptyEnsure, { ...ensure, launch })).not.toThrow()
    rejects(IpcChannels.ptyRestart, { ...ensure, launch })
    for (const bad of ['invalid', { ...launch, directory: 'invalid' },
      { ...launch, agent: { kind: 'codex', command: { executable: 'codex', args: Array(2) } } },
      { ...launch, agent: { kind: 'codex', command: { executable: 'codex', args: Object.setPrototypeOf(['a'], { reduce: () => 0 }) } } },
      { ...launch, agent: { kind: 'codex', command: { executable: 'codex', args: Array(129).fill('a') } } },
      { ...launch, agent: { kind: 'codex', command: { executable: 'codex', args: Array(9).fill('x'.repeat(32768)) } } },
      { ...launch, agent: { kind: 'codex', command: { executable: 'codex', args: ['a\x85b'] } } }]) {
      rejects(IpcChannels.ptyEnsure, { ...ensure, launch: bad })
    }
  })

  it('validates bounded drop arrays and safe relative file paths', () => {
    const drop = { terminalId: 'pane', files: [], treeEntry: { sessionId: 'source', path: 'src/a.ts' }, mode: 'shell' }
    expect(() => assertIpcPayload(IpcChannels.ptyDropFiles, drop)).not.toThrow()
    rejects(IpcChannels.ptyDropFiles, { ...drop, files: Array(2) })
    rejects(IpcChannels.ptyDropFiles, { ...drop, files: Array(257).fill({ name: 'file' }) })
    rejects(IpcChannels.ptyDropFiles, { ...drop, files: [{ name: 'file', nativePath: 42 }] })
    for (const path of ['../outside', '/absolute', 'src/../outside', 'src\\outside', 'src//file', 'a\nfile']) {
      rejects(IpcChannels.ptyDropFiles, { ...drop, treeEntry: { sessionId: 'source', path } })
      rejects(IpcChannels.filesRead, { sessionId: 'session', path })
      rejects(IpcChannels.filesList, { sessionId: 'session', path })
    }
  })

  it('accepts terminal directory roots and rejects mixed or unsafe selectors', () => {
    const root = { terminalId: 'pane', directory: '/workspace/current' }
    expect(() => assertIpcPayload(IpcChannels.filesList, { ...root, path: '' })).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.filesRead, { ...root, path: 'src/main.ts' })).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.gitInfo, root)).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.gitDiff, { ...root, path: 'src/main.ts' })).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.ptyDropFiles, { terminalId: 'target', files: [], mode: 'shell', treeEntry: { ...root, path: 'src' } })).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.chatDraft, { key: 'draft:drf_one', action: 'tree', ...root, path: 'src/main.ts' })).not.toThrow()
    for (const channel of [IpcChannels.filesList, IpcChannels.filesRead]) {
      rejects(channel, { ...root, sessionId: 'session', path: 'src/main.ts' })
      rejects(channel, { terminalId: 'pane', path: 'src/main.ts' })
      rejects(channel, { ...root, directory: '', path: 'src/main.ts' })
      rejects(channel, { ...root, path: '../outside' })
    }
    rejects(IpcChannels.gitInfo, { sessionId: 'session' })
    rejects(IpcChannels.gitInfo, { ...root, sessionId: 'session' })
  })

  it('rejects malformed trees, unmatched pane references and invalid ratios', () => {
    const valid = testLayout([{ id: 'a' }, { id: 'b' }])
    if (valid.tree.type !== 'split') throw new Error('Expected split')
    const update = (value: unknown) => ({ ...tab, patch: { layout: value } })
    for (const value of [
      { ...layout, layout: 'unknown' },
      { ...layout, panes: [] },
      { ...valid, panes: [{ id: 'a' }, { id: 'a' }] },
      { ...valid, tree: { ...valid.tree, ratio: Infinity } },
      { ...valid, tree: { ...valid.tree, ratio: 0 } },
      { ...valid, tree: { ...valid.tree, ratio: 1 } },
      { ...valid, tree: { ...valid.tree, axis: 'diagonal' } },
      { ...valid, tree: { ...valid.tree, second: valid.tree.first } },
      { ...valid, tree: { ...valid.tree, first: { type: 'pane', paneId: 'missing' } } },
      { ...valid, panes: [...valid.panes].reverse() },
      { ...layout, panes: [{ id: 'pane', unexpected: true }] },
      { ...layout, tree: { ...layout.tree, unexpected: true } },
      { ...layout, tree: Object.create(layout.tree) },
      { ...layout, panes: Array(1) },
      { ...layout, panes: [{ id: 'pane', get title() { throw new Error('Must not access getter') } }] },
      { ...valid, tree: { ...valid.tree, get ratio() { throw new Error('Must not access getter') } } },
    ]) rejects(IpcChannels.tabsUpdate, update(value))
    const cycle = { ...valid.tree }
    cycle.first = cycle
    rejects(IpcChannels.tabsUpdate, update({ ...valid, tree: cycle }))
  })

  it('accepts nested layouts beyond nine panes and rejects excessive tree sizes', () => {
    const make = (count: number) => testLayout(Array.from({ length: count }, (_, index) => ({ id: `pane-${index}` })))
    const update = (value: unknown) => ({ ...tab, patch: { layout: value } })
    expect(() => assertIpcPayload(IpcChannels.tabsUpdate, update(make(12)))).not.toThrow()
    expect(() => assertIpcPayload(IpcChannels.tabsUpdate, update(make(MAX_TERMINAL_COUNT)))).not.toThrow()
    rejects(IpcChannels.tabsUpdate, update(make(MAX_TERMINAL_COUNT + 1)))
  })
})


it('rejects attachment paths, unknown operations, foreign shapes and oversized bytes', () => {
  const valid = { key: 'thread:ses_one', action: 'add', name: 'screen.png', mime: 'image/png', data: new Uint8Array([1]) }
  expect(() => assertIpcPayload(IpcChannels.chatDraft, valid)).not.toThrow()
  for (const payload of [
    { ...valid, key: 'thread:../outside' },
    { ...valid, action: 'fetch' },
    { ...valid, path: '/some/file' },
    { ...valid, data: [1, 2] },
    { ...valid, data: new Uint8Array(20 * 1024 * 1024 + 1) },
    { key: 'draft:drf_one', action: 'tree', sessionId: 'source', path: '../secret' },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, payload)).toThrow()
})

it('accepts a new thread’s draft with the folder it is for, on every kind of change, and nothing foreign', () => {
  const key = 'draft:drf_0b1c2d3e-aaaa-bbbb-cccc-1234567890ab'
  for (const payload of [
    { key, action: 'text', text: 'Fix it', folderId: 'fld_one' },
    { key, action: 'prepend', text: 'Fix it', folderId: 'fld_one' },
    { key, action: 'add', name: 'a.png', mime: 'image/png', data: new Uint8Array([1]), folderId: 'fld_one' },
    { key, action: 'tree', sessionId: 'source', path: 'src/a.ts', folderId: 'fld_one' },
    { key, action: 'remove', attachmentId: 'abc', folderId: 'fld_one' },
    { key, action: 'load', folderId: 'fld_one' },
    { key, action: 'flush', folderId: 'fld_one' },
    { key, action: 'clear' },
    { key, action: 'load' },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, payload)).not.toThrow()
  for (const payload of [
    { key: 'draft:drf_', action: 'load' },
    { key: 'draft:../outside', action: 'load' },
    { key: 'draft:drf_one/../x', action: 'load' },
    { key: `draft:drf_${'a'.repeat(65)}`, action: 'load' },
    { key: 'draft:ses_one', action: 'load' },
    // The old key for a folder’s one draft is not a key any more.
    { key: 'folder:fld_one', action: 'load' },
    { key, action: 'text', text: 'Fix it', folderId: '../outside' },
    { key, action: 'text', text: 'Fix it', folderId: 'ses_one' },
    { key, action: 'text', text: 'Fix it', folderId: 42 },
    { key, action: 'text', text: 'Fix it', folder: 'fld_one' },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, payload)).toThrow()
})

it('accepts how a new thread would start with a draft, and nothing it would not understand', () => {
  const key = 'draft:drf_0b1c2d3e-aaaa-bbbb-cccc-1234567890ab'
  const choice = { agent: 'build', model, worktree: { base: 'origin/main', branch: 'feature/dark-mode' } }
  for (const payload of [
    { key, action: 'text', text: 'Fix it', folderId: 'fld_one', choice },
    { key, action: 'prepend', text: 'Fix it', folderId: 'fld_one', choice },
    { key, action: 'add', name: 'a.png', mime: 'image/png', data: new Uint8Array([1]), folderId: 'fld_one', choice },
    { key, action: 'tree', sessionId: 'source', path: 'src/a.ts', folderId: 'fld_one', choice },
    { key, action: 'remove', attachmentId: 'abc', folderId: 'fld_one', choice },
    { key, action: 'load', folderId: 'fld_one', choice },
    { key, action: 'flush', folderId: 'fld_one', choice },
    { key, action: 'flush', folderId: 'fld_one', choice: {} },
    { key, action: 'flush', folderId: 'fld_one', choice: { agent: 'plan' } },
    { key, action: 'flush', folderId: 'fld_one', choice: { worktree: { base: 'main' } } },
    // A name still being typed is no reason to lose the text: only the size is checked here.
    { key, action: 'text', text: 'Fix it', folderId: 'fld_one', choice: { ...choice, worktree: { base: 'main', branch: 'topic/' } } },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, payload)).not.toThrow()
  const text = { key, action: 'text', text: 'Fix it', folderId: 'fld_one' }
  for (const choice of [
    'build',
    null,
    [],
    { agent: '../build' },
    { agent: 7 },
    { model: { id: 'm' } },
    { model: 'free-1' },
    { worktree: 'main' },
    { worktree: {} },
    { worktree: { base: 5 } },
    { worktree: { base: 'x'.repeat(257) } },
    { worktree: { base: 'main', branch: 'x'.repeat(257) } },
    { worktree: { base: 'main', branch: 5 } },
    // A blank name is left out by the page, not sent.
    { worktree: { base: 'main', branch: '  ' } },
    { worktree: { base: 'main', branch: 'topic\n/x' } },
    { worktree: { base: 'main', directory: '/home/me/app' } },
    { agent: 'build', directory: '/home/me/app' },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, { ...text, choice })).toThrow()
})

it('takes the draft list without a payload, and a thread started from a draft by its id', () => {
  expect(() => assertIpcPayload(IpcChannels.chatDrafts, undefined)).not.toThrow()
  for (const payload of [{}, null, 'all', { folderId: 'fld_one' }]) expect(() => assertIpcPayload(IpcChannels.chatDrafts, payload)).toThrow()
  const create = { folderId: 'fld_1234', text: 'Fix it', agent: 'build', model, draftId: 'drf_0b1c2d3e-aaaa-bbbb-cccc-1234567890ab', attachmentIds: ['abc'], draftRevision: 3 }
  expect(() => assertIpcPayload(IpcChannels.chatCreate, create)).not.toThrow()
  for (const draftId of ['', 'fld_one', 'drf_', 'drf_../x', `drf_${'a'.repeat(65)}`, 7, null]) {
    expect(() => assertIpcPayload(IpcChannels.chatCreate, { ...create, draftId })).toThrow()
  }
})

it('accepts prepending prompt text to a draft, and nothing else with it', () => {
  const valid = { key: 'thread:ses_one', action: 'prepend', text: 'Fix the login\n\tplease' }
  expect(() => assertIpcPayload(IpcChannels.chatDraft, valid)).not.toThrow()
  for (const payload of [
    { ...valid, text: 'bell\u0007' },
    { ...valid, text: 'x'.repeat(100_001) },
    { ...valid, text: 42 },
    { ...valid, name: 'file.txt' },
    { ...valid, key: 'thread:../outside' },
    { key: 'thread:ses_one', action: 'prepend' },
  ]) expect(() => assertIpcPayload(IpcChannels.chatDraft, payload)).toThrow()
})


describe('custom Inbox name validation', () => {
  it('accepts names and clearing, and rejects malformed requests', () => {
    const channel = IpcChannels.inboxSetCustomTitle
    expect(() => assertIpcPayload(channel, { id: 'ses_thread', customTitle: null })).not.toThrow()
    expect(() => assertIpcPayload(channel, { id: 'ses_thread', customTitle: 'My task' })).not.toThrow()
    for (const customTitle of ['', '   ', 'x'.repeat(513), 'a\nb', 42, undefined]) {
      rejects(channel, { id: 'ses_thread', customTitle })
    }
    rejects(channel, { id: 'invalid', customTitle: 'My task' })
  })
})
