import type { TerminalLayoutNode, TerminalResizeAxis } from '../../src/shared/types'

/** A nested arrangement for tests whose subject is pane metadata or process lifecycle. */
export function testLayout<T extends { id?: string; terminalId?: string; paneId?: string }>(
  panes: T[],
  ratio = 0.5,
): { tree: TerminalLayoutNode; panes: T[] } {
  const build = (start: number, end: number, axis: TerminalResizeAxis): TerminalLayoutNode => {
    if (end - start === 1) {
      const pane = panes[start]!
      return { type: 'pane', paneId: pane.id ?? pane.paneId ?? pane.terminalId! }
    }
    const middle = start + Math.floor((end - start) / 2)
    return {
      type: 'split', id: `split-${start}-${end}`, axis, ratio,
      first: build(start, middle, axis === 'column' ? 'row' : 'column'),
      second: build(middle, end, axis === 'column' ? 'row' : 'column'),
    }
  }
  return { tree: build(0, panes.length, 'column'), panes }
}
