// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentCommandBar } from '../src/renderer/components/inbox/AgentCommandBar'
import { AGENT_ARRIVAL_MS, HiddenTerminalIndicator } from '../src/renderer/components/inbox/HiddenTerminalIndicator'
import { useInboxFloatingTerminal } from '../src/renderer/store/inbox-floating-terminal'
import { useInboxTerminal } from '../src/renderer/store/inbox-terminal'

let root: Root
let container: HTMLDivElement
const indicator = (): HTMLButtonElement | null => container.querySelector('[data-testid="hidden-terminal-indicator"]')
const set = (state: { floating: boolean; visible: boolean }): Promise<void> => act(async () => useInboxFloatingTerminal.setState(state))

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useInboxFloatingTerminal.setState({ floating: false, visible: false, rect: null, maximized: false })
  useInboxTerminal.setState({ agentArrivals: 0, agentCommands: {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(HiddenTerminalIndicator)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('the hidden floating terminal indicator', () => {
  it('is there only while the terminal floats and is hidden', async () => {
    expect(indicator()).toBeNull()
    await set({ floating: true, visible: true })
    expect(indicator()).toBeNull()
    await set({ floating: true, visible: false })
    expect(indicator()!.textContent).toContain('Terminal hidden')
    expect(indicator()!.textContent).toContain('F11')
    await set({ floating: false, visible: false })
    expect(indicator()).toBeNull()
  })

  it('shows the terminal again on a click, and goes away', async () => {
    await set({ floating: true, visible: false })
    await act(async () => indicator()!.click())
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ floating: true, visible: true })
    expect(indicator()).toBeNull()
  })

  it('says how many terminals are hidden when there are several', async () => {
    const layout = useInboxTerminal.getState().layout
    const pane = layout.panes[0]!
    await act(async () => useInboxTerminal.setState({ layout: { ...layout, panes: [pane, { ...pane, terminalId: 'second' }] } }))
    await set({ floating: true, visible: false })
    expect(indicator()!.textContent).toContain('2 terminals hidden')
    expect(indicator()!.title).toBe('Show the floating terminals (F11)')
    await act(async () => useInboxTerminal.setState({ layout }))
  })

  it('lights up when an agent opens a terminal while it is hidden, then goes back to counting', async () => {
    vi.useFakeTimers()
    try {
      await set({ floating: true, visible: false })
      expect(indicator()!.dataset.arrival).toBe('false')
      await act(async () => useInboxTerminal.setState({ agentArrivals: 1 }))
      expect(indicator()!.dataset.arrival).toBe('true')
      expect(indicator()!.className).toContain('hidden-terminal-arrival')
      expect(indicator()!.textContent).toContain('New agent terminal')
      expect(indicator()!.getAttribute('aria-label')).toBe('An agent opened a terminal. Show (F11)')
      await act(async () => { vi.advanceTimersByTime(AGENT_ARRIVAL_MS) })
      expect(indicator()!.dataset.arrival).toBe('false')
      expect(indicator()!.textContent).toContain('Terminal hidden')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replay an arrival the person saw, once the terminal is hidden later', async () => {
    await set({ floating: true, visible: true })
    await act(async () => useInboxTerminal.setState({ agentArrivals: 1 }))
    await set({ floating: true, visible: false })
    expect(indicator()!.dataset.arrival).toBe('false')
  })

  it('says a command waits for approval until it is answered', async () => {
    await set({ floating: true, visible: false })
    await act(async () => useInboxTerminal.setState({ agentCommands: { p1: { command: 'npm run dev', from: null } } }))
    expect(indicator()!.dataset.waiting).toBe('true')
    expect(indicator()!.textContent).toContain('1 command to approve')
    await act(async () => useInboxTerminal.setState({ agentCommands: {} }))
    expect(indicator()!.textContent).toContain('Terminal hidden')
  })
})

describe('the approval bar of a command an agent asked to run', () => {
  it('shows the command exactly and answers with the button pressed', async () => {
    const decide = vi.fn(async () => {})
    vi.stubGlobal('api', { agentTerminals: { decide } })
    await act(async () => root.render(createElement(AgentCommandBar, { terminalId: 'p1' })))
    expect(container.querySelector('[data-testid="agent-command-bar"]')).toBeNull()
    await act(async () => useInboxTerminal.setState({ agentCommands: { p1: { command: 'npm run dev -- --host', from: 'Fix login' } } }))
    expect(container.querySelector('[data-testid="agent-command-text"]')!.textContent).toBe('npm run dev -- --host')
    expect(container.textContent).toContain('An agent in Fix login wants to run:')
    await act(async () => (container.querySelector('[data-testid="agent-command-run-hour"]') as HTMLButtonElement).click())
    expect(decide).toHaveBeenCalledWith({ terminalId: 'p1', decision: 'run-for-hour' })
    expect(container.querySelector('[data-testid="agent-command-bar"]')).toBeNull()
  })

  it('declines without running', async () => {
    const decide = vi.fn(async () => {})
    vi.stubGlobal('api', { agentTerminals: { decide } })
    await act(async () => useInboxTerminal.setState({ agentCommands: { p1: { command: 'make', from: null } } }))
    await act(async () => root.render(createElement(AgentCommandBar, { terminalId: 'p1' })))
    await act(async () => (container.querySelector('[data-testid="agent-command-cancel"]') as HTMLButtonElement).click())
    expect(decide).toHaveBeenCalledWith({ terminalId: 'p1', decision: 'cancel' })
  })
})
