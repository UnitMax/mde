import { describe, expect, it, vi } from 'vitest'
import type { PermissionRule } from '../src/shared/opencode-config'
import { THREAD_PERMISSION_MODES, threadPermissionRules, type ThreadPermissionMode } from '../src/shared/permission-modes'
import type { ChatEvent } from '../src/shared/types'
import { InboxChatService } from '../src/main/inbox/chat'
import { InboxRecorder } from '../src/main/inbox/recorder'
import { InboxStore } from '../src/main/inbox/store'
import type { ServiceOperation, ServiceRequest } from '../src/main/opencode/service/client'
import { OpenCodeServiceError } from '../src/main/opencode/service/client'

/**
 * OpenCode 2.2.6 as read from its bundled code: wildcards match like file names, the last matching rule wins, and
 * nothing matching means ask. The session's rules come after the agent's, which carry the configuration's.
 */
function matches(text: string, pattern: string): boolean {
  let source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  if (source.endsWith(' .*')) source = `${source.slice(0, -3)}( .*)?`
  return new RegExp(`^${source}$`, 's').test(text)
}
function evaluate(rules: readonly PermissionRule[], action: string, resource = '*'): PermissionRule['effect'] {
  return rules.findLast((rule) => matches(action, rule.action) && matches(resource, rule.resource))?.effect ?? 'ask'
}

/** The built-in `build` agent's own rules (GET /api/agent on OpenCode 2.2.6), which a mode must leave working. */
const BUILD: PermissionRule[] = [
  { action: '*', resource: '*', effect: 'allow' },
  { action: 'read', resource: '*.env', effect: 'ask' },
  { action: 'read', resource: '*.env.*', effect: 'ask' },
  { action: 'read', resource: '*.env.example', effect: 'allow' },
  { action: 'question', resource: '*', effect: 'allow' },
  { action: 'browser', resource: '*', effect: 'deny' },
]
/** The `general` subagent's: it may not ask the person or start subagents of its own. */
const GENERAL: PermissionRule[] = [
  { action: '*', resource: '*', effect: 'allow' },
  { action: 'question', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
]
/** A configuration that asks before shell commands and forbids pushing. */
const CONFIG: PermissionRule[] = [
  { action: 'shell', resource: '*', effect: 'ask' },
  { action: 'shell', resource: 'git push *', effect: 'deny' },
]

const effective = (mode: ThreadPermissionMode, action: string, resource = '*', agent = BUILD) =>
  evaluate([...agent, ...CONFIG, ...threadPermissionRules(mode)], action, resource)

describe('thread permission modes', () => {
  it('sends nothing for the default mode, so the configuration decides alone', () => {
    expect(threadPermissionRules('default')).toEqual([])
    expect(effective('default', 'shell', 'npm test')).toBe('ask')
    expect(effective('default', 'shell', 'git push origin main')).toBe('deny')
    expect(effective('default', 'edit', 'src/a.ts')).toBe('allow')
  })

  it.each([
    // mode, edit, shell, Code Mode, web fetch, web search, an MCP tool, outside the project
    ['read-only', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'ask'],
    ['ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask'],
    ['auto-edit', 'allow', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask'],
    ['full', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow'],
    ['full-web-asks', 'allow', 'allow', 'allow', 'ask', 'ask', 'allow', 'allow'],
  ] as const)('%s: stands on its own for the actions it speaks about', (mode, edit, shell, execute, webfetch, websearch, mcp, outside) => {
    expect(effective(mode, 'edit', 'src/a.ts')).toBe(edit)
    expect(effective(mode, 'shell', 'npm test')).toBe(shell)
    // A mode stands on its own: it overrides the configuration's deny as well as its ask.
    expect(effective(mode, 'shell', 'git push origin main')).toBe(shell)
    expect(effective(mode, 'execute')).toBe(execute)
    expect(effective(mode, 'webfetch', 'https://example.com')).toBe(webfetch)
    expect(effective(mode, 'websearch', 'opencode docs')).toBe(websearch)
    expect(effective(mode, 'github_search_issues')).toBe(mcp)
    expect(effective(mode, 'external_directory', '/home/me/other/*')).toBe(outside)
  })

  it.each(THREAD_PERMISSION_MODES)('%s: leaves reading, searching, questions, to-dos and OpenCode\'s own guards alone', (mode) => {
    for (const action of ['read', 'glob', 'grep', 'question', 'todowrite', 'skill', 'subagent']) {
      expect(effective(mode, action, 'src/a.ts')).toBe('allow')
    }
    // Reading an MCP server's resources is reading, though it looks like an MCP tool.
    expect(effective(mode, 'opencode_read_mcp_resource', 'docs:readme')).toBe('allow')
    expect(effective(mode, 'opencode_list_mcp_resources', 'docs')).toBe('allow')
    // What OpenCode asks or forbids by itself stays so, also for a subagent, which takes its thread's rules along.
    expect(effective(mode, 'read', '/home/me/app/.env')).toBe('ask')
    expect(effective(mode, 'browser')).toBe('deny')
    expect(effective(mode, 'subagent', 'general', GENERAL)).toBe('deny')
    expect(effective(mode, 'question', '*', GENERAL)).toBe('deny')
  })

  it('never hands out a rule for every action', () => {
    for (const mode of THREAD_PERMISSION_MODES) {
      expect(threadPermissionRules(mode).some((rule) => rule.action === '*')).toBe(false)
    }
  })

  it('gives a fresh copy each time, so a change to one cannot leak into the next thread', () => {
    const first = threadPermissionRules('full')
    first[0]!.effect = 'deny'
    expect(threadPermissionRules('full')[0]!.effect).toBe('allow')
  })
})

const model = { id: 'model-1', providerId: 'provider-1' }

function setup(responses: Partial<Record<ServiceOperation, unknown>> = {}) {
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const changed: string[] = []
  const recorder = new InboxRecorder(store, { now: () => 1_000, readBranch: async () => 'main', onChanged: (thread) => changed.push(thread.id) })
  const calls: { operation: ServiceOperation; request: ServiceRequest }[] = []
  const request = vi.fn(async (_target: unknown, operation: ServiceOperation, req: ServiceRequest = {}) => {
    calls.push({ operation, request: req })
    const response = responses[operation]
    if (response instanceof Error) throw response
    return response ?? null
  })
  let nextId = 0
  const service = new InboxChatService({
    client: { request, openEvents: vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {})), reset: vi.fn(), endpoint: async () => ({ url: 'http://127.0.0.1:1', password: 'x' }) },
    store,
    recorder,
    send: (_event: ChatEvent) => {},
    enabled: () => true,
    now: () => 1_000,
    createId: () => `abc${nextId++}`,
    sleep: async () => {},
  })
  const folder = service.addFolder({ directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu-24.04' } })
  return { service, store, calls, request, folder, changed }
}

describe('Inbox thread permissions', () => {
  it('starts a thread with its mode\'s rules and records the mode', async () => {
    const { service, calls, folder, store } = setup({ 'session.create': { data: { id: 'ses_ro' } } })
    const thread = await service.create({ folderId: folder.id, text: 'Look', agent: 'build', model, permissionMode: 'read-only' })
    expect(calls[0]).toMatchObject({ operation: 'session.create', request: { body: { permissions: threadPermissionRules('read-only') } } })
    expect(thread.permissionMode).toBe('read-only')
    expect(store.get('ses_ro')?.permissionMode).toBe('read-only')
    service.stop()
  })

  it.each([undefined, 'default'] as const)('sends no rules at all for %s', async (permissionMode) => {
    const { service, calls, folder } = setup({ 'session.create': { data: { id: 'ses_plain' } } })
    const thread = await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model, ...(permissionMode ? { permissionMode } : {}) })
    expect(calls[0]?.operation).toBe('session.create')
    expect(calls[0]?.request.body).not.toHaveProperty('permissions')
    expect(thread).not.toHaveProperty('permissionMode')
    service.stop()
  })

  it('refuses a mode it does not know before asking OpenCode for anything', async () => {
    const { service, calls, folder } = setup()
    await expect(service.create({ folderId: folder.id, text: 'Go', agent: 'build', model, permissionMode: 'everything' as ThreadPermissionMode })).rejects.toThrow('permission mode')
    expect(calls).toEqual([])
    service.stop()
  })

  it('changes a thread\'s mode on the session, and clears the rules for the default', async () => {
    const { service, calls, folder, store, changed } = setup({ 'session.create': { data: { id: 'ses_t' } } })
    await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model })
    calls.length = 0
    const full = await service.setPermissionMode({ threadId: 'ses_t', mode: 'full' })
    expect(calls).toEqual([{ operation: 'session.update', request: { params: { sessionID: 'ses_t' }, body: { permissions: threadPermissionRules('full') } } }])
    expect(full.permissionMode).toBe('full')
    expect(changed).toContain('ses_t')
    const back = await service.setPermissionMode({ threadId: 'ses_t', mode: 'default' })
    expect(calls[1]).toEqual({ operation: 'session.update', request: { params: { sessionID: 'ses_t' }, body: { permissions: [] } } })
    expect(back).not.toHaveProperty('permissionMode')
    expect(store.get('ses_t')).not.toHaveProperty('permissionMode')
    service.stop()
  })

  it('keeps the mode it had when OpenCode refuses the change, and says why for an older OpenCode', async () => {
    const { service, folder, store, request } = setup({ 'session.create': { data: { id: 'ses_t' } } })
    await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model, permissionMode: 'ask' })
    request.mockRejectedValueOnce(new OpenCodeServiceError('Bad request', 400, 'InvalidRequestError'))
    await expect(service.setPermissionMode({ threadId: 'ses_t', mode: 'full' })).rejects.toThrow('Update OpenCode')
    expect(store.get('ses_t')?.permissionMode).toBe('ask')
    await expect(service.setPermissionMode({ threadId: 'ses_gone', mode: 'full' })).rejects.toThrow('no longer in the Inbox')
    service.stop()
  })

  it('gives a fork its source\'s mode', async () => {
    const forked = { data: { id: 'ses_fork', title: 'Fork', fork: { sessionID: 'ses_t', boundary: { type: 'before', messageID: 'msg_3' } } } }
    const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_t' } }, 'session.fork': forked })
    await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model, permissionMode: 'auto-edit' })
    calls.length = 0
    const { thread } = await service.fork({ threadId: 'ses_t', messageId: 'msg_3' })
    expect(calls.map((call) => call.operation)).toEqual(['session.fork', 'session.update'])
    expect(calls[1]?.request).toEqual({ params: { sessionID: 'ses_fork' }, body: { permissions: threadPermissionRules('auto-edit') } })
    expect(thread.permissionMode).toBe('auto-edit')
    service.stop()
  })

  it('records a fork under the configuration when its mode could not be given to it', async () => {
    const forked = { data: { id: 'ses_fork', title: 'Fork', fork: { sessionID: 'ses_t', boundary: { type: 'before', messageID: 'msg_3' } } } }
    const { service, folder, request } = setup({ 'session.create': { data: { id: 'ses_t' } }, 'session.fork': forked })
    await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model, permissionMode: 'full' })
    const previous = request.getMockImplementation()!
    request.mockImplementation(async (target, operation, input) => {
      if (operation === 'session.update') throw new OpenCodeServiceError('Bad request', 400)
      return previous(target, operation, input)
    })
    const { thread } = await service.fork({ threadId: 'ses_t', messageId: 'msg_3' })
    expect(thread.id).toBe('ses_fork')
    expect(thread).not.toHaveProperty('permissionMode')
    service.stop()
  })

  it('leaves a fork of a default thread alone', async () => {
    const forked = { data: { id: 'ses_fork', title: 'Fork', fork: { sessionID: 'ses_t', boundary: { type: 'before', messageID: 'msg_3' } } } }
    const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_t' } }, 'session.fork': forked })
    await service.create({ folderId: folder.id, text: 'Go', agent: 'build', model })
    calls.length = 0
    await service.fork({ threadId: 'ses_t', messageId: 'msg_3' })
    expect(calls.map((call) => call.operation)).toEqual(['session.fork'])
    service.stop()
  })
})
