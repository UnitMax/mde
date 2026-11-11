/**
 * Lays out a commit graph in lanes, one row per commit, the way `git log --graph` does. Commits come
 * newest first, every child before its parents. Each lane waits for one commit (the parent of the
 * row above it); a commit takes the first lane waiting for it, and any other lanes waiting for it
 * join it there. A lane keeps its color from the tip it started at to the commit where it ends.
 */

export interface GraphInput {
  hash: string
  parents: readonly string[]
  /** Drawn dashed, along with the line to its parents: the uncommitted changes above HEAD. */
  dashed?: boolean
}

export interface GraphSegment {
  /** The lane the line leaves from: at the top edge for `top`, at the commit for `bottom`. */
  from: number
  /** The lane it arrives at: at the commit for `top`, at the bottom edge for `bottom`. */
  to: number
  /** `top` runs from the row's top edge to its middle, `bottom` from its middle to the bottom edge. */
  half: 'top' | 'bottom'
  color: number
  dashed: boolean
}

export interface GraphRow {
  /** The lane the commit sits in. */
  column: number
  color: number
  segments: GraphSegment[]
  /** Lanes the row uses, for the width of its drawing. */
  width: number
}

interface Lane {
  hash: string
  color: number
  dashed: boolean
}

function freeLane(lanes: Array<Lane | null>, taken = -1): number {
  const index = lanes.findIndex((lane, at) => lane === null && at !== taken)
  return index >= 0 ? index : Math.max(lanes.length, taken + 1)
}

export function layoutGitGraph(commits: readonly GraphInput[]): GraphRow[] {
  const lanes: Array<Lane | null> = []
  const rows: GraphRow[] = []
  let colors = 0
  for (const commit of commits) {
    const waiting: number[] = []
    lanes.forEach((lane, index) => { if (lane?.hash === commit.hash) waiting.push(index) })
    const column = waiting[0] ?? freeLane(lanes)
    const color = waiting.length ? lanes[column]!.color : colors++
    const before = lanes.slice()
    const segments: GraphSegment[] = []
    before.forEach((lane, index) => {
      if (!lane) return
      segments.push({ from: index, to: lane.hash === commit.hash ? column : index, half: 'top', color: lane.color, dashed: lane.dashed })
    })
    for (const index of waiting) lanes[index] = null
    while (lanes.length <= column) lanes.push(null)

    commit.parents.forEach((parent, order) => {
      const existing = lanes.findIndex((lane) => lane?.hash === parent)
      // Another branch waits for this parent already: the line joins it. A first parent joins only a
      // lane to its left, so the older line keeps its place and a side branch never pushes it over;
      // otherwise both lanes wait and meet at the parent.
      if (existing >= 0 && (order > 0 || existing < column)) {
        segments.push({ from: column, to: existing, half: 'bottom', color: lanes[existing]!.color, dashed: Boolean(commit.dashed) })
        return
      }
      const lane = order === 0 && lanes[column] === null ? column : freeLane(lanes, column)
      while (lanes.length <= lane) lanes.push(null)
      const laneColor = order === 0 ? color : colors++
      lanes[lane] = { hash: parent, color: laneColor, dashed: Boolean(commit.dashed) }
      segments.push({ from: column, to: lane, half: 'bottom', color: laneColor, dashed: Boolean(commit.dashed) })
    })

    // Lanes that only pass by carry straight on.
    before.forEach((lane, index) => {
      if (lane && lane.hash !== commit.hash && lanes[index] === lane) {
        segments.push({ from: index, to: index, half: 'bottom', color: lane.color, dashed: lane.dashed })
      }
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({ column, color, segments, width: Math.max(before.length, lanes.length, column + 1) })
  }
  return rows
}

/** `just now`, `5 min ago`, `3 h ago`, `yesterday`, `4 days ago`, then the date. */
export function relativeCommitTime(seconds: number, now = Date.now()): string {
  const elapsed = Math.max(0, now / 1000 - seconds)
  if (elapsed < 60) return 'just now'
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)} h ago`
  const days = Math.floor(elapsed / 86_400)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const date = new Date(seconds * 1000)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
