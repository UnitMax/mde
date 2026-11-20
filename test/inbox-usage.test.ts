// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxStore } from '../src/main/inbox/store'
import { InboxRecorder } from '../src/main/inbox/recorder'
import { InboxChatService, USAGE_TIMEOUT_MS } from '../src/main/inbox/chat'
import { OpenCodeServiceError, serviceUrl, type ServiceOperation, type ServiceRequest } from '../src/main/opencode/service/client'
import { parseUsageStats } from '../src/main/opencode/service/parse'
import {
  formatCost, formatTokens, InboxUsageDialog, usageBuckets, usageServices, usageSince,
} from '../src/renderer/components/inbox/InboxUsageDialog'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import type { ChatUsageState, InboxFolder } from '../src/shared/types'

/** Trimmed from a real OpenCode 2.2.6 answer. */
const answer = {
  data: {
    range: { from: 1_782_055_206_312, to: 1_794_695_977_555 },
    sessions: 159,
    subagents: 21,
    prompts: 380,
    steps: 1434,
    tokens: { input: 6_901_040, output: 570_887, reasoning: 192_718, cache: { read: 62_660_058, write: 0 } },
    cost: 3.9636406781999964,
    tools: {
      mode: 'detail',
      totals: { calls: 1523, succeeded: 1480, failed: 43, unfinished: 0 },
      usage: [
        { name: 'bash', calls: 280, succeeded: 278, failed: 2, unfinished: 0, durationP50: 4 },
        { name: 'read', calls: 544, succeeded: 524, failed: 20, unfinished: 0, durationP50: 12 },
        { name: 'bad\nname', calls: 3, succeeded: 3, failed: 0, unfinished: 0 },
      ],
    },
    activeDays: 42,
    streak: 12,
    activity: [{ date: '2026-11-14', steps: 9 }, { date: '2026-11-12', steps: 8 }, { date: 'yesterday', steps: 4 }],
    models: [
      { model: { id: 'qwen38-local', providerID: 'llama.cpp', variant: 'default' }, steps: 155, tokens: { input: 397_609, output: 186_343, reasoning: 0, cache: { read: 8_578_443, write: 0 } }, cost: 0 },
      { model: { id: 'deepseek-v4-flash', providerID: 'openrouter', variant: 'max' }, steps: 266, tokens: { input: 412_985, output: 110_598, reasoning: 80_089, cache: { read: 38_109_440, write: 0 } }, cost: 0.2 },
      { model: { id: 'deepseek-v4-flash', providerID: 'openrouter', variant: 'default' }, steps: 10, tokens: { input: 15, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.05 },
    ],
  },
}

describe('OpenCode usage statistics', () => {
  it('keeps the totals, merges a model’s variants, and orders models and tools by size', () => {
    const stats = parseUsageStats(answer)
    expect(stats).toMatchObject({
      sessions: 159, subagents: 21, prompts: 380, steps: 1434, activeDays: 42, streak: 12, toolCalls: 1523, toolFailures: 43,
      tokens: { input: 6_901_040, output: 570_887, reasoning: 192_718, cacheRead: 62_660_058, cacheWrite: 0 },
    })
    expect(stats.cost).toBeCloseTo(3.96, 2)
    expect(stats.activity).toEqual([{ date: '2026-11-12', steps: 8 }, { date: '2026-11-14', steps: 9 }])
    expect(stats.models.map((entry) => [entry.model, entry.steps])).toEqual([
      [{ id: 'deepseek-v4-flash', providerId: 'openrouter' }, 276],
      [{ id: 'qwen38-local', providerId: 'llama.cpp' }, 155],
    ])
    expect(stats.models[0]!.cost).toBeCloseTo(0.25)
    expect(stats.tools).toEqual([
      { name: 'read', calls: 544, failed: 20, medianMs: 12 },
      { name: 'bash', calls: 280, failed: 2, medianMs: 4 },
    ])
  })

  it('refuses an answer that is not statistics', () => {
    expect(() => parseUsageStats({ data: { sessions: 3 } })).toThrow('session statistics')
    expect(() => parseUsageStats(null)).toThrow()
  })

  it('builds the request from fixed parameters only', () => {
    const url = serviceUrl('http://127.0.0.1:1', 'session.stats', { query: { tools: 'detail', from: '1700000000000', timezone: 'Europe/Berlin' } })
    expect(url).toBe('http://127.0.0.1:1/api/experimental/session/stats?tools=detail&from=1700000000000&timezone=Europe%2FBerlin')
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.stats', { query: { timezone: 'x&tools=none' } })).toThrow()
    expect(() => serviceUrl('http://127.0.0.1:1', 'session.stats', { query: { from: 'yesterday' } })).toThrow()
  })

  it('asks the service of the folder’s threads, and says when OpenCode has no statistics', async () => {
    const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
    const recorder = new InboxRecorder(store, { now: () => 1, readBranch: async () => 'main', onChanged: () => {} })
    let response: unknown = answer
    const calls: { target: unknown; operation: ServiceOperation; request: ServiceRequest }[] = []
    const request = vi.fn(async (target: unknown, operation: ServiceOperation, req: ServiceRequest = {}) => {
      calls.push({ target, operation, request: req })
      if (response instanceof Error) throw response
      return response
    })
    let enabled = true
    const service = new InboxChatService({
      client: { request, openEvents: vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {})), reset: vi.fn(), endpoint: async () => ({ url: 'http://127.0.0.1:1', password: 'p' }) },
      store, recorder, send: () => {}, enabled: () => enabled, now: () => 1, createId: () => 'abc', sleep: async () => {},
    })
    const folder = service.addFolder({ directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' } })

    const state = await service.usage({ folderId: folder.id, since: 1_700_000_000_000, timezone: 'Europe/Berlin' })
    expect(state.supported).toBe(true)
    expect(state.stats?.sessions).toBe(159)
    expect(calls).toEqual([{
      target: { kind: 'wsl', distro: 'Ubuntu' },
      operation: 'session.stats',
      request: { query: { tools: 'detail', from: '1700000000000', timezone: 'Europe/Berlin' }, timeoutMs: USAGE_TIMEOUT_MS },
    }])

    response = new OpenCodeServiceError('Not found', 404)
    await expect(service.usage({ folderId: folder.id })).resolves.toEqual({ supported: false, stats: null })
    expect(calls[1]?.request).toEqual({ query: { tools: 'detail' }, timeoutMs: USAGE_TIMEOUT_MS })
    response = new OpenCodeServiceError('Broken', 500)
    await expect(service.usage({ folderId: folder.id })).rejects.toThrow('Broken')
    await expect(service.usage({ folderId: 'fld_gone' })).rejects.toThrow('no longer in the Inbox')
    enabled = false
    await expect(service.usage({ folderId: folder.id })).rejects.toThrow('only available')
    service.stop()
  })
})

const folder = (id: string, target: InboxFolder['target']): InboxFolder =>
  ({ id, name: id, directory: '/home/me/app', target, createdAt: 1, lastUsedAt: 1 })

describe('the usage overview’s figures', () => {
  // Saturday 14 November 2026, in the afternoon, local time.
  const now = new Date(2026, 10, 14, 15, 30).getTime()

  it('starts a range at midnight so that it holds as many dates as it says', () => {
    expect(new Date(usageSince('7d', now)!)).toEqual(new Date(2026, 10, 8))
    expect(new Date(usageSince('30d', now)!)).toEqual(new Date(2026, 9, 16))
    expect(usageSince('all', now)).toBeUndefined()
  })

  it('draws a bar for every day of a range, days without activity too', () => {
    const buckets = usageBuckets([{ date: '2026-11-09', steps: 4 }, { date: '2026-11-14', steps: 2 }], usageSince('7d', now), now)
    expect(buckets.map((bucket) => bucket.steps)).toEqual([0, 4, 0, 0, 0, 0, 2])
    expect(buckets[0]).toEqual({ date: '2026-11-08', steps: 0, week: false })
  })

  it('draws a bar per week, from Monday, for all time', () => {
    const buckets = usageBuckets([{ date: '2026-10-28', steps: 3 }, { date: '2026-11-01', steps: 2 }, { date: '2026-11-10', steps: 5 }], undefined, now)
    expect(buckets).toEqual([
      { date: '2026-10-26', steps: 5, week: true },
      { date: '2026-11-02', steps: 0, week: true },
      { date: '2026-11-09', steps: 5, week: true },
    ])
    expect(usageBuckets([], undefined, now)).toEqual([])
  })

  it('offers one OpenCode per place, the project in view’s first', () => {
    const app = folder('fld_app', { kind: 'wsl', distro: 'Ubuntu' })
    const docs = folder('fld_docs', { kind: 'wsl', distro: 'Ubuntu' })
    const debian = folder('fld_deb', { kind: 'wsl', distro: 'Debian' })
    expect(usageServices([app, docs, debian], null).map((entry) => [entry.label, entry.folder.id])).toEqual([['Ubuntu', 'fld_app'], ['Debian', 'fld_deb']])
    expect(usageServices([app, docs, debian], debian).map((entry) => entry.label)).toEqual(['Debian', 'Ubuntu'])
    expect(usageServices([folder('fld_mac', { kind: 'native' })], null)[0]?.label).toBe('This computer')
  })

  it('writes counts and dollars short', () => {
    expect(formatTokens(9_999)).toMatch(/^9.999$/)
    expect(formatTokens(70_324_703)).toMatch(/70\.3\s?M/)
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(3.9636)).toBe('$3.96')
    expect(formatCost(1234.5)).toBe('$1235')
  })
})

describe('the usage dialog', () => {
  let root: Root
  let container: HTMLDivElement
  const usage = vi.fn<(req: unknown) => Promise<ChatUsageState>>()
  const testId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    usage.mockReset()
    usage.mockResolvedValue({ supported: true, stats: parseUsageStats(answer) })
    vi.stubGlobal('api', { chat: { usage } })
    useInboxChat.setState({ folders: [folder('fld_app', { kind: 'wsl', distro: 'Ubuntu' }), folder('fld_deb', { kind: 'wsl', distro: 'Debian' })] })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  const render = (project: InboxFolder | null = null): Promise<void> =>
    act(async () => root.render(createElement(InboxUsageDialog, { open: true, onOpenChange: () => {}, project })))

  it('shows the totals, the token mix, the activity, the models and the tools', async () => {
    await render()
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'fld_app', since: usageSince('30d') }))
    expect(testId('usage-total-tokens')?.textContent).toMatch(/70\.3\s?M/)
    expect(testId('usage-cost')?.textContent).toContain('$3.96')
    expect(testId('usage-sessions')?.textContent).toContain('159')
    expect(testId('usage-days')?.textContent).toContain('12-day streak')
    expect(testId('usage-token-mix')?.textContent).toContain('Cache read')
    // Cache write was 0, so it takes no room.
    expect(testId('usage-token-mix')?.textContent).not.toContain('Cache write')
    expect(document.querySelectorAll('[data-testid="usage-activity-bar"]')).toHaveLength(30)
    expect(Array.from(document.querySelectorAll('[data-testid="usage-model"]'), (row) => row.textContent)).toEqual([
      expect.stringContaining('deepseek-v4-flash'), expect.stringContaining('qwen38-local'),
    ])
    expect(testId('usage-tools')?.textContent).toContain('20 failed')
  })

  it('shows its scrollbar only while the pointer is over it', async () => {
    await render()
    const dialog = testId('inbox-usage')!
    expect(dialog.classList.contains('hover-scrollbar')).toBe(true)
    expect(dialog.hasAttribute('data-scrollbar-shown')).toBe(false)
    await act(async () => { dialog.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body })) })
    expect(dialog.hasAttribute('data-scrollbar-shown')).toBe(true)
    await act(async () => { dialog.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })) })
    expect(dialog.hasAttribute('data-scrollbar-shown')).toBe(false)
  })

  it('asks again for another range or another OpenCode', async () => {
    await render()
    await act(async () => testId('usage-range-all')!.click())
    expect(usage).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'fld_app', since: undefined }))
    await act(async () => testId('usage-service-wsl:Debian')!.click())
    expect(usage).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'fld_deb' }))
    await act(async () => testId('usage-refresh')!.click())
    expect(usage).toHaveBeenCalledTimes(4)
  })

  it('says it is still reading, for how long, and why a long history takes a while', async () => {
    vi.useFakeTimers()
    try {
      let resolveUsage!: (state: ChatUsageState) => void
      usage.mockReturnValueOnce(new Promise((resolve) => { resolveUsage = resolve }))
      await render()
      expect(testId('usage-loading')?.textContent).toContain('Reading OpenCode’s statistics')
      expect(testId('usage-loading-seconds')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(2_000) })
      expect(testId('usage-loading-seconds')?.textContent).toBe('2 s')
      expect(testId('usage-loading-hint')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(4_000) })
      expect(testId('usage-loading-hint')?.textContent).toContain('long history')
      await act(async () => resolveUsage({ supported: true, stats: parseUsageStats(answer) }))
      expect(testId('usage-loading')).toBeNull()

      // Over the figures already shown while another range is read, its seconds counted from the start again.
      usage.mockReturnValueOnce(new Promise(() => {}))
      await act(async () => testId('usage-range-all')!.click())
      expect(testId('usage-total-tokens')).not.toBeNull()
      expect(testId('usage-loading')).not.toBeNull()
      expect(testId('usage-loading-seconds')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so when OpenCode has no statistics, or an error when it fails', async () => {
    usage.mockResolvedValueOnce({ supported: false, stats: null })
    await render()
    expect(testId('usage-unsupported')).not.toBeNull()
    usage.mockRejectedValueOnce(new Error('Could not reach the OpenCode background service.'))
    await act(async () => testId('usage-refresh')!.click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not reach')
  })
})
