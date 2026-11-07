// @vitest-environment happy-dom
import { act, createElement, useRef, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPicker } from '../src/renderer/components/inbox/ChatComposer'
import { ChatSendButton } from '../src/renderer/components/inbox/ChatSendButton'
import { ContextMeter } from '../src/renderer/components/inbox/ContextMeter'
import { McpChip } from '../src/renderer/components/inbox/McpChip'
import { ModelPicker } from '../src/renderer/components/inbox/ModelPicker'
import { ComposerSizeContext, useMeasuredComposerSize } from '../src/renderer/components/inbox/composer-toolbar'
import type { ComposerSize } from '../src/renderer/lib/composer-size'
import type { ContextUsage } from '../src/renderer/lib/chat'
import { useInboxMcp } from '../src/renderer/store/inbox-mcp'
import type { ChatAgent, ChatModel } from '../src/shared/types'

const SIZES: ComposerSize[] = ['wide', 'medium', 'narrow', 'tight']

const model: ChatModel = { id: 'beam', providerId: 'opencode', providerName: 'OpenCode', name: 'Beam Free', variants: ['medium'] }
const agents: ChatAgent[] = [{ id: 'build', name: 'Build', description: 'Builds' }, { id: 'plan', name: 'Plan', description: 'Plans' }] as ChatAgent[]
const usage = (patch: Partial<ContextUsage> = {}): ContextUsage => ({
  used: 21_300,
  step: { input: 1_300, output: 0, reasoning: 0, cacheRead: 20_000, cacheWrite: 0 },
  limit: 200_000,
  ratio: 21_300 / 200_000,
  tone: 'normal',
  outputLimit: null,
  modelName: 'Beam Free',
  thread: null,
  compacted: null,
  ...patch,
})

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function at(size: ComposerSize, element: ReactElement, width = Number.POSITIVE_INFINITY): Promise<void> {
  await act(async () => root.render(createElement(ComposerSizeContext.Provider, { value: { size, width } }, element)))
}
const q = (selector: string): HTMLElement | null => container.querySelector<HTMLElement>(selector)
const chevron = (trigger: HTMLElement | null): Element | null => trigger?.querySelector('.lucide-chevron-down') ?? null

describe('the model chip', () => {
  const chip = (): ReactElement => createElement(ModelPicker, { models: [model], value: { id: 'beam', providerId: 'opencode', variant: 'medium' }, onChange: () => {} })

  it('reads provider, name and effort as one line, and drops the provider and then the effort as the box narrows', async () => {
    await at('wide', chip())
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toBe('OpenCode /Beam Free·Medium')
    expect(q('[data-testid="chat-model-provider"]')?.textContent).toBe('OpenCode /')
    expect(chevron(q('[data-testid="chat-model-picker"]'))).not.toBeNull()

    await at('medium', chip())
    expect(q('[data-testid="chat-model-provider"]')).toBeNull()
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toBe('Beam Free·Medium')
    expect(chevron(q('[data-testid="chat-model-picker"]'))).not.toBeNull()

    await at('narrow', chip())
    expect(q('[data-testid="chat-model-effort"]')?.textContent).toBe('Medium')
    expect(chevron(q('[data-testid="chat-model-picker"]'))).toBeNull()

    await at('tight', chip())
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toBe('Beam Free')
  })

  it('gives the provider, the name and the effort one type size and no extra room between them', async () => {
    await at('wide', chip())
    const trigger = q('[data-testid="chat-model-picker"]')!
    for (const part of ['chat-model-provider', 'chat-model-effort']) {
      expect(q(`[data-testid="${part}"]`)?.className).not.toMatch(/text-\[\d/)
    }
    // A short name is as wide as its text, not padded to a minimum.
    const name = Array.from(trigger.querySelectorAll<HTMLElement>('span.truncate')).find((span) => span.textContent === 'Beam Free')
    expect(name?.style.minWidth).toBe('5ch')
  })

  it('leaves the provider out of a long name until the toolbar is wide enough for all of it', async () => {
    const long: ChatModel = { ...model, id: 'long', name: 'Claude Sonnet 4.5 (extended thinking)' }
    const value = { id: 'long', providerId: 'opencode', variant: 'medium' }
    await at('wide', createElement(ModelPicker, { models: [long], value, onChange: () => {} }), 760)
    expect(q('[data-testid="chat-model-provider"]')).toBeNull()
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toBe('Claude Sonnet 4.5 (extended thinking)·Medium')
    await at('wide', createElement(ModelPicker, { models: [long], value, onChange: () => {} }), 1200)
    expect(q('[data-testid="chat-model-provider"]')?.textContent).toBe('OpenCode /')
  })

  it('keeps the whole choice in the tooltip, whatever the size', async () => {
    for (const size of SIZES) {
      await at(size, chip())
      expect(q('[data-testid="chat-model-picker"]')?.getAttribute('title')).toBe('opencode/beam#medium')
    }
  })
})

describe('the agent chip', () => {
  const chip = (): ReactElement => createElement(AgentPicker, { agents, value: 'build', onChange: () => {} })

  it('keeps the name while there is room, then only the icon, with the name in the tooltip', async () => {
    await at('wide', chip())
    expect(q('[data-testid="chat-agent-picker"]')?.textContent).toBe('Build')
    await at('medium', chip())
    expect(q('[data-testid="chat-agent-picker"]')?.textContent).toBe('Build')
    for (const size of ['narrow', 'tight'] as const) {
      await at(size, chip())
      const trigger = q('[data-testid="chat-agent-picker"]')!
      expect(trigger.textContent).toBe('')
      expect(trigger.getAttribute('title')).toBe('Agent: Build')
      expect(trigger.getAttribute('aria-label')).toBe('Agent')
      expect(trigger.querySelector('svg')).not.toBeNull()
    }
  })
})

describe('where the focus goes when a toolbar menu closes', () => {
  const chip = (): ReactElement => createElement(AgentPicker, { agents, value: 'build', onChange: () => {} })
  const trigger = (): HTMLElement => q('[data-testid="chat-agent-picker"]')!
  const open = (): Promise<void> => act(async () => { trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  const menuItem = (name: string): HTMLElement => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.includes(name))!

  it('leaves the chip without focus, and so without a ring, when the mouse chose or closed', async () => {
    await at('wide', chip())
    await open()
    expect(menuItem('Plan')).toBeDefined()
    await act(async () => { window.dispatchEvent(new Event('pointerdown')) })
    await act(async () => { menuItem('Plan').click() })
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
    // Radix hands the focus back a tick after the menu is gone; give it the chance to.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.activeElement).not.toBe(trigger())
  })

  it('hands it back to the chip when the keyboard closed the menu, where the ring is wanted', async () => {
    await at('wide', chip())
    await open()
    await act(async () => { menuItem('Build').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger()))
  })
})

describe('the context meter', () => {
  const meter = (patch: Partial<ContextUsage> = {}): ReactElement => createElement(ContextMeter, { usage: usage(patch) })

  it('draws segments and a number when wide, a ring and a number when medium, and the ring alone below that', async () => {
    await at('wide', meter())
    expect(q('[data-testid="chat-context-segments"]')).not.toBeNull()
    expect(q('[data-testid="chat-context-ring"]')).toBeNull()
    expect(q('[data-testid="chat-context-meter"]')?.textContent).toBe('21.3K')

    await at('medium', meter())
    expect(q('[data-testid="chat-context-segments"]')).toBeNull()
    expect(q('[data-testid="chat-context-ring"]')).not.toBeNull()
    expect(q('[data-testid="chat-context-meter"]')?.textContent).toBe('21.3K')

    for (const size of ['narrow', 'tight'] as const) {
      await at(size, meter())
      expect(q('[data-testid="chat-context-ring"]')).not.toBeNull()
      expect(q('[data-testid="chat-context-meter"]')?.textContent).toBe('')
      // Nothing is lost: the number is still in the label.
      expect(q('[data-testid="chat-context-meter"]')?.getAttribute('aria-label')).toBe('Context: 21.3K of 200K tokens used (11%)')
    }
  })

  it('fills the ring as far as the window is filled', async () => {
    await at('narrow', meter({ ratio: 0.5, tone: 'normal' }))
    const arc = container.querySelectorAll('[data-testid="chat-context-ring"] circle')[1]
    const [filled, whole] = (arc?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number)
    expect(filled! / whole!).toBeCloseTo(0.5, 5)

    await at('narrow', meter({ ratio: 0, tone: 'normal' }))
    expect(container.querySelectorAll('[data-testid="chat-context-ring"] circle')).toHaveLength(1)
  })

  it('has no ring to fill without a known window, and does not pretend to after a compaction', async () => {
    await at('narrow', meter({ limit: null, ratio: null }))
    expect(q('[data-testid="chat-context-ring"]')).toBeNull()
    expect(q('[data-testid="chat-context-meter"] svg')).not.toBeNull()

    await at('narrow', meter({ ratio: null, compacted: { summaryTokens: null } }))
    expect(q('[data-testid="chat-context-ring"]')).toBeNull()
    expect(q('[data-testid="chat-context-meter"] svg')).not.toBeNull()
  })
})

describe('the MCP chip', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { chat: { mcp: vi.fn(async () => ({ servers: [{ name: 'one', status: 'connected' }, { name: 'two', status: 'failed', error: 'x' }], supported: true })) } },
    })
    useInboxMcp.setState({ entries: {} })
  })
  const chip = (): ReactElement => createElement(McpChip, { place: { request: { folderId: 'f' }, target: { kind: 'native' }, directory: '/home/me/size-test' } })

  it('shows the count next to the plug while there is room, and the status badge at every size', async () => {
    await at('wide', chip())
    await vi.waitFor(() => expect(q('[data-testid="chat-mcp-chip"]')).not.toBeNull())
    expect(q('[data-testid="chat-mcp-chip"]')?.textContent).toBe('1/2')
    for (const size of SIZES) {
      await at(size, chip())
      const trigger = q('[data-testid="chat-mcp-chip"]')!
      expect(trigger.textContent).toBe(size === 'wide' || size === 'medium' ? '1/2' : '')
      expect(trigger.getAttribute('aria-label')).toBe('MCP servers: 1 connected, 1 failed')
      expect(trigger.getAttribute('data-tone')).toBe('danger')
      expect(trigger.querySelector('.bg-danger')).not.toBeNull()
    }
  })
})

describe('the send button while the agent works', () => {
  const send = (): ReactElement => createElement(ChatSendButton, { running: true, delivery: 'steer', onDeliveryChange: () => {}, disabled: false, sending: false, onSend: () => {} })

  it('keeps the word Steer for screen readers when it has no room to show it', async () => {
    await at('wide', send())
    expect(q('[data-testid="chat-send"] span')?.className).not.toContain('sr-only')
    await at('medium', send())
    expect(q('[data-testid="chat-send"] span')?.className).not.toContain('sr-only')
    for (const size of ['narrow', 'tight'] as const) {
      await at(size, send())
      expect(q('[data-testid="chat-send"] span')?.className).toContain('sr-only')
      expect(q('[data-testid="chat-send"]')?.textContent).toBe('Steer')
    }
  })
})

describe('measuring the toolbar', () => {
  let width = 0
  let notify: () => void = () => {}

  function Probe(): ReactElement {
    const ref = useRef<HTMLDivElement>(null)
    const size = useMeasuredComposerSize(ref)
    return createElement('div', { ref, 'data-testid': 'probe', 'data-size': size.size, 'data-width': String(size.width) })
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width } as DOMRect))
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback } observe(): void {} disconnect(): void {} unobserve(): void {} })
  })
  afterEach(() => vi.restoreAllMocks())

  it('follows the width as the window is resized', async () => {
    width = 720
    await act(async () => root.render(createElement(Probe)))
    expect(q('[data-testid="probe"]')?.getAttribute('data-size')).toBe('wide')
    for (const [next, size] of [[600, 'medium'], [450, 'narrow'], [300, 'tight'], [800, 'wide']] as const) {
      width = next
      await act(async () => notify())
      expect(q('[data-testid="probe"]')?.getAttribute('data-size')).toBe(size)
      expect(q('[data-testid="probe"]')?.getAttribute('data-width')).toBe(String(Math.floor(next / 8) * 8))
    }
  })

  it('stays wide, with room for anything, where the width cannot be measured', async () => {
    width = 0
    await act(async () => root.render(createElement(Probe)))
    expect(q('[data-testid="probe"]')?.getAttribute('data-size')).toBe('wide')
    expect(q('[data-testid="probe"]')?.getAttribute('data-width')).toBe('Infinity')
  })
})
