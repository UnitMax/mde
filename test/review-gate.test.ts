import { describe, expect, it, vi } from 'vitest'
import type { ChatPermission } from '../src/shared/types'
import { ReviewGate, type GateRequest, type ReviewGateDependencies } from '../src/main/inbox/review-gate'

const permission = (resources: string[], extra: Partial<ChatPermission> = {}): ChatPermission => ({
  id: 'per_1', action: 'shell', resources, revision: 'rev-1', ...extra,
})

function setup(options: {
  request?: GateRequest | null | Error
  answer?: string | { status: number }
  approve?: () => Promise<void>
  endpoint?: boolean
} = {}) {
  const answer = options.answer ?? '{"verdict":"allow","risk":"low","reason":"Runs the tests."}'
  let release: (() => void) | null = null
  const fetchGate = new Promise<void>((resolve) => { release = resolve })
  const fetcher = vi.fn(async () => {
    await fetchGate
    return typeof answer === 'string'
      ? new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }))
      : new Response('{}', { status: answer.status })
  })
  const dependencies = {
    readRequest: vi.fn(async () => {
      if (options.request instanceof Error) throw options.request
      return options.request === undefined ? { permission: permission(['npm test']), callId: 'call-1' } : options.request
    }),
    context: vi.fn(async () => ({ directory: '/home/me/app', userMessages: ['Run the tests.'] })),
    endpoint: vi.fn(async () => options.endpoint === false ? null : { baseUrl: 'https://reviewer.example/v1', model: 'm', askMediumRisk: true }),
    approve: vi.fn(options.approve ?? (async () => {})),
    release: vi.fn(),
    changed: vi.fn(),
    now: () => 5_000,
    fetch: fetcher as unknown as typeof fetch,
  } satisfies ReviewGateDependencies
  const gate = new ReviewGate(dependencies)
  const settle = async () => {
    release?.()
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { gate, dependencies, settle, fetcher }
}

describe('review gate', () => {
  it('shows the request as being reviewed, then answers a safe one once and never lets it through', async () => {
    const { gate, dependencies, settle } = setup()
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    expect(gate.review('per_1')).toEqual({ state: 'reviewing' })
    expect(gate.holding('per_1')).toBe(true)
    expect(dependencies.changed).toHaveBeenCalledWith('ses_thread')
    await settle()
    expect(dependencies.approve).toHaveBeenCalledWith('ses_thread', 'ses_thread', 'per_1', 'rev-1')
    expect(dependencies.release).not.toHaveBeenCalled()
    expect(gate.review('per_1')).toBeUndefined()
    expect(gate.reviewedCalls('ses_thread')).toEqual([{ callId: 'call-1', reason: 'Runs the tests.', by: 'model', at: 5_000 }])
  })

  it('answers a subagent\'s request under the subagent\'s session', async () => {
    const { gate, dependencies, settle } = setup()
    gate.begin('ses_thread', 'ses_child', 'per_1')
    await settle()
    expect(dependencies.readRequest).toHaveBeenCalledWith('ses_thread', 'ses_child', 'per_1')
    expect(dependencies.approve).toHaveBeenCalledWith('ses_thread', 'ses_child', 'per_1', 'rev-1')
  })

  it('lets a risky request through with the reviewer\'s reason', async () => {
    const { gate, dependencies, settle } = setup({ answer: '{"verdict":"ask","risk":"high","reason":"Uploads a file."}' })
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    await settle()
    expect(dependencies.approve).not.toHaveBeenCalled()
    expect(dependencies.release).toHaveBeenCalledWith('ses_thread')
    expect(gate.review('per_1')).toEqual({ state: 'asked', risk: 'high', reason: 'Uploads a file.', by: 'model' })
    expect(gate.holding('per_1')).toBe(false)
  })

  it('asks, saying why, when the reviewer cannot be reached or is not set up', async () => {
    const down = setup({ answer: { status: 503 } })
    down.gate.begin('ses_thread', 'ses_thread', 'per_1')
    await down.settle()
    expect(down.dependencies.release).toHaveBeenCalled()
    expect(down.gate.review('per_1')).toEqual({ state: 'unavailable', reason: 'The reviewer endpoint has a problem right now.' })

    const none = setup({ endpoint: false })
    none.gate.begin('ses_thread', 'ses_thread', 'per_1')
    await none.settle()
    expect(none.dependencies.approve).not.toHaveBeenCalled()
    expect(none.gate.review('per_1')).toMatchObject({ state: 'unavailable' })
  })

  it('gives way when the person answers during the review', async () => {
    const { gate, dependencies, settle } = setup()
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    gate.settle('per_1')
    await settle()
    expect(dependencies.approve).not.toHaveBeenCalled()
    expect(dependencies.release).not.toHaveBeenCalled()
    expect(gate.review('per_1')).toBeUndefined()
  })

  it('lets the request through when the approval is refused, as for a request that changed', async () => {
    const { gate, dependencies, settle } = setup({ approve: async () => { throw new Error('This permission request changed.') } })
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    await settle()
    expect(dependencies.release).toHaveBeenCalled()
    expect(gate.review('per_1')).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('could not answer') })
    expect(gate.reviewedCalls('ses_thread')).toEqual([])
  })

  it('drops a request that is gone before it could be read, and asks about one it cannot read', async () => {
    const gone = setup({ request: null })
    gone.gate.begin('ses_thread', 'ses_thread', 'per_1')
    await gone.settle()
    expect(gone.dependencies.release).not.toHaveBeenCalled()
    expect(gone.gate.review('per_1')).toBeUndefined()

    const broken = setup({ request: { permission: permission([], { incomplete: true }) } })
    broken.gate.begin('ses_thread', 'ses_thread', 'per_1')
    await broken.settle()
    expect(broken.fetcher).not.toHaveBeenCalled()
    expect(broken.dependencies.release).toHaveBeenCalled()

    const failing = setup({ request: new Error('offline') })
    failing.gate.begin('ses_thread', 'ses_thread', 'per_1')
    await failing.settle()
    expect(failing.dependencies.release).toHaveBeenCalled()
    expect(failing.gate.review('per_1')).toMatchObject({ state: 'unavailable' })
  })

  it('reviews a request once, however often it is announced', async () => {
    const { gate, dependencies, settle } = setup()
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    gate.begin('ses_thread', 'ses_thread', 'per_1')
    await settle()
    expect(dependencies.readRequest).toHaveBeenCalledTimes(1)
  })
})
