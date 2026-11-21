import { createContext } from 'react'
import { create } from 'zustand'

/** A subagent open in a subagent view: its session, and what its row said, for the way back to it. */
export interface SubagentCrumb {
  sessionId: string
  /** The kind of subagent and that it is one, such as "General subagent". */
  label: string
  title: string | null
}

interface SubagentNavState {
  /**
   * For each thread, the subagents opened from it, outermost first: the last is the one shown. A subagent opened from
   * a subagent goes on top. Kept only while MDE runs.
   */
  stacks: Record<string, SubagentCrumb[]>
  /** Opens a subagent on top of what the thread shows; one already in the trail is gone back to instead. */
  open: (threadId: string, crumb: SubagentCrumb) => void
  /** Goes up one level, to the subagent or thread it was opened from. */
  back: (threadId: string) => void
  /** Goes back to a level of the trail: 0 is the thread itself, 1 the first subagent opened from it, and so on. */
  goTo: (threadId: string, depth: number) => void
}

export const useSubagentNav = create<SubagentNavState>((set) => ({
  stacks: {},
  open: (threadId, crumb) => set((state) => {
    const stack = state.stacks[threadId] ?? []
    const at = stack.findIndex((item) => item.sessionId === crumb.sessionId)
    return { stacks: { ...state.stacks, [threadId]: at >= 0 ? stack.slice(0, at + 1) : [...stack, crumb] } }
  }),
  back: (threadId) => set((state) => ({ stacks: { ...state.stacks, [threadId]: (state.stacks[threadId] ?? []).slice(0, -1) } })),
  goTo: (threadId, depth) => set((state) => ({ stacks: { ...state.stacks, [threadId]: (state.stacks[threadId] ?? []).slice(0, Math.max(0, depth)) } })),
}))

/**
 * How a subagent row opens its subagent's conversation, given by the view it is drawn in (a thread or a subagent);
 * null where a row cannot open one, which then opens onto its answer in place.
 */
export const SubagentOpenContext = createContext<((crumb: SubagentCrumb) => void) | null>(null)
