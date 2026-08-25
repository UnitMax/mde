import { describe, expect, it } from 'vitest'
import {
  terminalDirectoryLabel,
  terminalPaneLabel,
  terminalPanesForSidebar
} from '../src/renderer/lib/terminal-instances'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const layout: SessionTerminalLayout = {
  layout: 'three',
  panes: [
    { terminalId: 'session-1', primary: true },
    { terminalId: 'session-1:split:1', primary: false },
    { terminalId: 'session-1:split:2', primary: false }
  ],
  sizes: { columnRatio: 0.5, rowRatio: 0.5 }
}

describe('terminal sidebar helpers', () => {
  it('filters OpenCode panes while preserving visible pane order', () => {
    const visible = terminalPanesForSidebar(
      layout,
      new Set(['session-1:split:1'])
    )

    expect(visible.map((pane) => pane.terminalId)).toEqual([
      'session-1',
      'session-1:split:2'
    ])
  })

  it('numbers terminals by their visible pane position', () => {
    expect(terminalPaneLabel(layout.panes[0]!, layout)).toBe('Terminal 1')
    expect(terminalPaneLabel(layout.panes[2]!, layout)).toBe('Terminal 3')
  })

  it('uses a compact basename for native and WSL-style paths', () => {
    expect(terminalDirectoryLabel('/home/me/app')).toBe('app')
    expect(terminalDirectoryLabel('C:\\work\\mde\\app\\')).toBe('app')
    expect(terminalDirectoryLabel('/')).toBe('/')
    expect(terminalDirectoryLabel(undefined)).toBeNull()
  })
})
