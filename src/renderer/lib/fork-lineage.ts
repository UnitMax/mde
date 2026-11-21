import type { InboxThread } from '@shared/types'

/** One line of the lineage tree, in the order it is drawn, top to bottom. */
export interface LineageRow {
  /** The thread on this line; null for a thread that was forked from but is no longer in the Inbox. */
  thread: InboxThread | null
  /** The thread's ID, or the removed one's, as its forks still name it. */
  id: string
  depth: number
  /** For each level above this line's own, whether the line down from that level goes on past this line. */
  guides: boolean[]
  /** The last fork of its parent: its line down ends here. */
  last: boolean
  /** How many forks it has. */
  forks: number
}

/**
 * The fork tree a thread belongs to: from the thread everything in it was forked from, down through every fork of a
 * fork, oldest fork first. When that first thread was itself forked from one since removed, the removed one heads the
 * tree, so that its other forks are found too. A thread with no forks and none it was forked from has no tree: the
 * list is empty.
 */
export function forkLineage(threads: readonly InboxThread[], threadId: string): LineageRow[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const start = byId.get(threadId)
  if (!start) return []
  const children = new Map<string, InboxThread[]>()
  for (const thread of threads) {
    if (!thread.forkedFrom || thread.forkedFrom === thread.id) continue
    const list = children.get(thread.forkedFrom)
    if (list) list.push(thread)
    else children.set(thread.forkedFrom, [thread])
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  // Up to where it began; a loop in the records (which forking cannot make) stops the walk.
  let top: string = start.id
  const seen = new Set([top])
  for (let parent = start.forkedFrom; parent && !seen.has(parent);) {
    seen.add(parent)
    top = parent
    parent = byId.get(parent)?.forkedFrom
  }
  if (top === start.id && !children.has(start.id)) return []

  const rows: LineageRow[] = []
  const drawn = new Set<string>()
  const walk = (id: string, depth: number, guides: boolean[], last: boolean): void => {
    if (drawn.has(id)) return
    drawn.add(id)
    const forks = (children.get(id) ?? []).filter((fork) => !drawn.has(fork.id))
    rows.push({ thread: byId.get(id) ?? null, id, depth, guides, last, forks: forks.length })
    const below = depth === 0 ? [] : [...guides, !last]
    forks.forEach((fork, index) => walk(fork.id, depth + 1, below, index === forks.length - 1))
  }
  walk(top, 0, [], true)
  return rows
}
