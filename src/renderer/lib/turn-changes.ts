import type { ChatMessage, ChatPart } from '@shared/types'
import { displayPath } from '@/lib/chat'
import { patchFileChanges, toolKind } from '@/lib/chat-tools'
import { toolFileChanges, type FileChange } from '@/lib/diff'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** Everything one turn of the agent did to the files, file by file, in the order each was first touched. */
export interface TurnChanges {
  /** One change per file: its edits one after the other, with what happened to it in the end. */
  files: FileChange[]
  additions: number
  deletions: number
}

/** The files a finished tool call changed: an edit, a write or a patch. A call that failed or is still going changed nothing yet. */
export function partFileChanges(part: ChatPart): FileChange[] | null {
  if (part.kind !== 'tool' || part.status !== 'completed') return null
  const kind = toolKind(part.name)
  if (kind === 'edit' || kind === 'write') return toolFileChanges(part as ToolPart)
  if (kind === 'patch') return patchFileChanges(part as ToolPart)
  return null
}

/**
 * What happened to a file over a turn, from what was done to it each time: deleted when the last change deleted it,
 * created when the first created it, edited when it was edited at all, and otherwise what the last write was.
 */
function overallAction(actions: readonly FileChange['action'][]): FileChange['action'] {
  const last = actions[actions.length - 1]!
  if (last === 'delete') return 'delete'
  if (actions[0] === 'create') return 'create'
  if (actions.includes('edit')) return 'edit'
  return last
}

/** One file's changes in a turn as one: the hunks of each in turn, and the counts added up. */
function mergeFileChanges(path: string, changes: readonly FileChange[]): FileChange {
  if (changes.length === 1) return { ...changes[0]!, path }
  return {
    path,
    action: overallAction(changes.map((change) => change.action)),
    hunks: changes.flatMap((change) => change.hunks),
    numbered: changes.every((change) => change.numbered),
    additions: changes.reduce((sum, change) => sum + change.additions, 0),
    deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
  }
}

function collect(steps: readonly Extract<ChatMessage, { kind: 'assistant' }>[], directory: string): TurnChanges | null {
  const byPath = new Map<string, FileChange[]>()
  for (const step of steps) {
    for (const part of step.parts) {
      for (const change of partFileChanges(part) ?? []) {
        // An edit names the file in full and a patch from the project's folder; the same file is one entry.
        const path = displayPath(change.path, directory)
        const list = byPath.get(path)
        if (list) list.push(change)
        else byPath.set(path, [change])
      }
    }
  }
  if (byPath.size === 0) return null
  const files = Array.from(byPath, ([path, changes]) => mergeFileChanges(path, changes))
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

/**
 * The file changes of each finished turn, by the id of the turn's last assistant message (where the turn's summary
 * goes). A turn starts with a message from the person or a goal, as in `turnStats`. The turn still going while the
 * agent runs is left out: its changes are not all in yet. Turns that changed no file are left out too.
 */
export function turnChanges(messages: readonly ChatMessage[], directory: string, running = false): Map<string, TurnChanges> {
  const result = new Map<string, TurnChanges>()
  let steps: Extract<ChatMessage, { kind: 'assistant' }>[] = []
  const close = (): void => {
    const last = steps[steps.length - 1]
    const changes = last ? collect(steps, directory) : null
    if (last && changes) result.set(last.id, changes)
    steps = []
  }
  for (const message of messages) {
    if (message.kind === 'user' || (message.kind === 'note' && message.goal !== undefined)) close()
    else if (message.kind === 'assistant') steps.push(message)
  }
  if (!running) close()
  return result
}
