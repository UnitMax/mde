import type { PersistedTerminalLayout, TerminalLayoutNode } from './types'

/** Bounds process/resource use and validation depth independently of the arrangement. */
export const MAX_TERMINAL_COUNT = 64

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length <= keys.length && ownKeys.every((key) => typeof key === 'string' && keys.includes(key) &&
    'value' in Object.getOwnPropertyDescriptor(value, key)!)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

export function terminalPaneIds(tree: TerminalLayoutNode): string[] {
  return tree.type === 'pane' ? [tree.paneId] : [...terminalPaneIds(tree.first), ...terminalPaneIds(tree.second)]
}

/** Rejects cycles, duplicate nodes, excessive depth, accessors and unknown fields before traversal. */
export function isTerminalLayoutTree(value: unknown): value is TerminalLayoutNode {
  let remaining = MAX_TERMINAL_COUNT * 2 - 1
  const panes = new Set<string>()
  const splits = new Set<string>()
  const visit = (node: unknown): boolean => {
    if (--remaining < 0 || !record(node, ['type', 'paneId', 'id', 'axis', 'ratio', 'first', 'second'])) return false
    if (node.type === 'pane') {
      if (!record(node, ['type', 'paneId']) || !identifier(node.paneId) || panes.has(node.paneId)) return false
      panes.add(node.paneId)
      return true
    }
    if (node.type !== 'split' || !record(node, ['type', 'id', 'axis', 'ratio', 'first', 'second']) ||
      !identifier(node.id) || splits.has(node.id) || (node.axis !== 'column' && node.axis !== 'row') ||
      typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) return false
    splits.add(node.id)
    return visit(node.first) && visit(node.second)
  }
  return visit(value)
}

export function isPersistedTerminalLayout(value: unknown): value is PersistedTerminalLayout {
  if (!record(value, ['tree', 'panes']) || !isTerminalLayoutTree(value.tree) || !Array.isArray(value.panes) ||
    Object.getPrototypeOf(value.panes) !== Array.prototype) return false
  const ids = terminalPaneIds(value.tree)
  if (value.panes.length !== ids.length || Reflect.ownKeys(value.panes).length !== ids.length + 1) return false
  for (let index = 0; index < ids.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.panes, String(index))
    if (!descriptor || !('value' in descriptor)) return false
    const pane: unknown = descriptor.value
    if (!record(pane, ['id', 'title']) || pane.id !== ids[index]) return false
    if (pane.title !== undefined && (typeof pane.title !== 'string' || !pane.title.trim() ||
      pane.title.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(pane.title))) return false
  }
  return true
}
