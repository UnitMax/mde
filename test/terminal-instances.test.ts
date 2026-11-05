import { testLayout } from './helpers/terminal-layout'
import { describe, expect, it } from 'vitest'
import {
  terminalDirectoryLabel,
  terminalPaneLabel
} from '../src/renderer/lib/terminal-instances'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const layout: SessionTerminalLayout = testLayout([
  { terminalId: 'session-1' },
  { terminalId: 'session-1:split:1' },
  { terminalId: 'session-1:split:2' }
])

describe('terminal sidebar helpers', () => {
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
