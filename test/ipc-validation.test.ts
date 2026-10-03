import { describe, expect, it } from 'vitest'
import { IpcChannels } from '../src/shared/ipc'
import { assertIpcPayload, IPC_LIMITS, ipcPayloadValidators, type IpcChannel } from '../src/main/ipc-validation'

const palette = { foreground: '#ffffff', background: '#000000' }
const size = { cols: 80, rows: 24 }
const ensure = { terminalId: 'pane', sessionId: 'session', palette, size }
const layout = { layout: 'single', panes: [{ id: 'pane' }], sizes: { columnRatio: 0.5, rowRatio: 0.5 } }
const distro = { distro: 'Ubuntu-24.04' }
const enabled = { enabled: true }
const sessionId = { sessionId: 'session' }
const terminalId = { terminalId: 'pane' }
const tab = { sessionId: 'session', tabId: 'tab' }
const plugin = { target: { kind: 'wsl', distro: 'Ubuntu-24.04' } }

/** Explicit legitimate fixtures prevent an exhaustive registry that rejects normal use. */
const validPayloads = {
  [IpcChannels.appInfo]: undefined,
  [IpcChannels.platformInfo]: undefined,
  [IpcChannels.workspaceList]: undefined,
  [IpcChannels.projectsCreate]: { name: 'Project' },
  [IpcChannels.projectsUpdate]: { id: 'project', patch: { name: 'Renamed' } },
  [IpcChannels.projectsRemove]: 'project',
  [IpcChannels.todoProjectsCreate]: { name: 'Tasks', shorthand: 'APP' },
  [IpcChannels.todoProjectsUpdate]: { id: 'project', patch: { shorthand: 'NEW' } },
  [IpcChannels.todoProjectsRemove]: 'project',
  [IpcChannels.todoTasksCreate]: { todoProjectId: 'project', columnId: 'todo', title: 'Task', description: '# Notes\n\nText' },
  [IpcChannels.todoTasksUpdate]: { id: 'task', patch: { description: '' } },
  [IpcChannels.todoTasksMove]: { id: 'task', columnId: 'done', beforeId: null },
  [IpcChannels.todoTasksRemove]: 'task',
  [IpcChannels.sessionsCreate]: { projectId: 'project', name: 'Shell', kind: 'wsl', path: '/home/me/project', distro: 'Ubuntu-24.04', shell: undefined },
  [IpcChannels.sessionsDuplicate]: 'session',
  [IpcChannels.sessionsUpdate]: { id: 'session', patch: { shell: '', icon: null, color: 'blue' } },
  [IpcChannels.sessionsMove]: { id: 'session', projectId: 'project' },
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
  [IpcChannels.wslAvailable]: undefined,
  [IpcChannels.wslDistros]: undefined,
  [IpcChannels.pathBrowse]: undefined,
  [IpcChannels.pathResolve]: { kind: 'wsl', distro: undefined, rawPath: '' },
  [IpcChannels.pathValidate]: { kind: 'native', path: 'C:\\src\\project' },
  [IpcChannels.pathReveal]: 'session',
  [IpcChannels.pathRevealTerminal]: 'pane',
  [IpcChannels.pathOpenInVsCode]: 'session',
  [IpcChannels.pathOpenTerminalInVsCode]: 'pane',
  [IpcChannels.gitInfo]: sessionId,
  [IpcChannels.gitStatus]: sessionId,
  [IpcChannels.gitTerminalInfo]: terminalId,
  [IpcChannels.gitDiff]: { sessionId: 'session', path: 'src/file.ts' },
  [IpcChannels.filesList]: { sessionId: 'session', path: '' },
  [IpcChannels.filesRead]: { sessionId: 'session', path: 'src/file.ts' },
  [IpcChannels.opencodeSessionsList]: { sessionId: 'session', sourceTerminalId: 'pane', executable: '/usr/bin/opencode' },
  [IpcChannels.opencodeTuiPluginState]: distro,
  [IpcChannels.opencodeTuiPluginInstall]: distro,
  [IpcChannels.opencodeTuiPluginRemove]: distro,
  [IpcChannels.opencodeTuiSettings]: undefined,
  [IpcChannels.opencodeTuiSetEnabled]: enabled,
  [IpcChannels.opencodeTuiSetInstanceLabelMode]: { mode: 'numbered' },
  [IpcChannels.codexStatusHookState]: distro,
  [IpcChannels.codexStatusHookInstall]: distro,
  [IpcChannels.codexStatusHookRemove]: distro,
  [IpcChannels.codexStatusSettings]: undefined,
  [IpcChannels.codexStatusSetEnabled]: enabled,
  [IpcChannels.opencodeTokenRatePluginState]: plugin,
  [IpcChannels.opencodeTokenRatePluginInstall]: plugin,
  [IpcChannels.opencodeTokenRatePluginRemove]: plugin,
  [IpcChannels.opencodeAlertsSettings]: undefined,
  [IpcChannels.opencodeAlertsSetEnabled]: enabled,
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

  it('rejects getters without executing them and inherited/unknown nested fields', () => {
    let accessed = false
    const payload = Object.defineProperty({}, 'name', { get: () => { accessed = true; return 'Project' } })
    rejects(IpcChannels.projectsCreate, payload)
    expect(accessed).toBe(false)
    rejects(IpcChannels.sessionsUpdate, { id: 'session', patch: { kind: 'wsl' } })
    rejects(IpcChannels.todoTasksUpdate, { id: 'task', patch: Object.create({ title: 'Inherited' }) })
    rejects(IpcChannels.projectsUpdate, { id: 'project', patch: JSON.parse('{"constructor":{}}') })
    rejects(IpcChannels.projectsCreate, { name: 'Project', [Symbol('extra')]: true })
  })

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, IPC_LIMITS.terminalDimension + 1, '80'])('rejects invalid terminal dimensions: %s', (cols) => {
    rejects(IpcChannels.ptyEnsure, { ...ensure, size: { cols, rows: 24 } })
    rejects(IpcChannels.ptyResize, { terminalId: 'pane', size: { cols, rows: 24 } })
  })

  it('bounds labels, IDs, paths and text without logging the payload', () => {
    rejects(IpcChannels.projectsCreate, { name: 'x'.repeat(IPC_LIMITS.label + 1) })
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
    rejects(IpcChannels.opencodeTuiSetEnabled, { enabled: 'true' })
    rejects(IpcChannels.opencodeTuiSetInstanceLabelMode, { mode: 'unknown' })
    for (const distro of ['../other', 'Ubuntu\n', ' '.repeat(129) + 'Ubuntu']) {
      rejects(IpcChannels.opencodeTuiPluginInstall, { distro })
    }
    rejects(IpcChannels.opencodeTokenRatePluginInstall, { target: { kind: 'native', distro: 'Ubuntu' } })
    rejects(IpcChannels.opencodeSessionsList, { ...validPayloads[IpcChannels.opencodeSessionsList], executable: 'opencode\nunsafe' })
    rejects(IpcChannels.pathResolve, { kind: 'native', rawPath: '/tmp/a\0b' })
    rejects(IpcChannels.sessionsRemove, 'session\r')
  })

  it('validates both launch variants, nested arguments and aggregate bounds', () => {
    const launch = { sourceTerminalId: 'source', directory: 'terminal', agent: { kind: 'codex', command: { executable: 'codex', args: ['--model', 'example'] } } }
    expect(() => assertIpcPayload(IpcChannels.ptyEnsure, { ...ensure, launch })).not.toThrow()
    const resume = { sourceTerminalId: 'source', executable: 'opencode', opencodeSessionId: 'ses_example' }
    expect(() => assertIpcPayload(IpcChannels.ptyEnsure, { ...ensure, launch: resume })).not.toThrow()
    for (const bad of ['invalid', { ...resume, opencodeSessionId: "ses_x' OR 1=1" }, { ...resume, directory: 'terminal' },
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

  it('rejects malformed layouts, mismatched counts, duplicate panes and invalid ratios', () => {
    const update = (value: unknown): unknown => ({ ...tab, patch: { layout: value } })
    for (const value of [
      { ...layout, layout: 'unknown' },
      { ...layout, panes: [] },
      { ...layout, layout: 'columns', panes: [{ id: 'same' }, { id: 'same' }] },
      { ...layout, sizes: { columnRatio: Infinity, rowRatio: 0.5 } },
      { ...layout, sizes: { columnRatio: 0, rowRatio: 0.5 } },
      { ...layout, panes: [{ id: 'pane', unexpected: true }] },
      { ...layout, layout: 'threeColumns', panes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], sizes: { columnRatio: 0.8, secondColumnRatio: 0.2, rowRatio: 0.5 } },
    ]) rejects(IpcChannels.tabsUpdate, update(value))
  })
})
