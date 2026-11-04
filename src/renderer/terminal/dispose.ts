import { useWorkspace } from '@/store/workspace'
import { disposeSession } from './sessions'

/** Ends a terminal for good: its process, its screen, and everything the workspace remembers about it. */
export function disposeRuntimeTerminal(terminalId: string): void {
  const workspace = useWorkspace.getState()
  workspace.clearExit(terminalId)
  workspace.setStatus(terminalId, 'none')
  workspace.unlinkTerminalTask(terminalId)
  disposeSession(terminalId)
  void window.api.pty.dispose(terminalId)
}
