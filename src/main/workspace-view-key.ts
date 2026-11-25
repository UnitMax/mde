import type { WorkspaceViewName } from '@shared/ipc'

interface WorkspaceViewKeyInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

export type WorkspaceViewKeyAction = WorkspaceViewName | 'ignore'

/** The title bar's sections, left to right, and the key that opens each. */
const VIEW_KEYS: Record<string, WorkspaceViewName> = { F6: 'sessions', F7: 'todo', F8: 'inbox' }

function viewFor(input: WorkspaceViewKeyInput): WorkspaceViewName | undefined {
  return VIEW_KEYS[input.key] ?? (input.code === undefined ? undefined : VIEW_KEYS[input.code])
}

/**
 * What a key press means for the title bar's sections. F6, F7 and F8 open Sessions, To Do and the Inbox from anywhere
 * in the window, a terminal or a page of the MDE browser included, while the renderer says the full window is on screen
 * (not the mini window). A held key is swallowed ('ignore') so its repeats never reach a shell.
 */
export function getWorkspaceViewKeyAction(input: WorkspaceViewKeyInput, active: boolean): WorkspaceViewKeyAction | null {
  if (
    !active ||
    input.type !== 'keyDown' ||
    input.control || input.meta || input.alt || input.shift
  ) {
    return null
  }
  const view = viewFor(input)
  if (!view) return null
  return input.isAutoRepeat ? 'ignore' : view
}

/** Whether the renderer shows the title bar's sections, so F6, F7 and F8 should reach it, as it last said. */
export class WorkspaceViewKey {
  private active = false

  setActive(active: boolean): void {
    this.active = active
  }

  action(input: WorkspaceViewKeyInput): WorkspaceViewKeyAction | null {
    return getWorkspaceViewKeyAction(input, this.active)
  }
}
