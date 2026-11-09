// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HiddenTerminalIndicator } from '../src/renderer/components/inbox/HiddenTerminalIndicator'
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
})
