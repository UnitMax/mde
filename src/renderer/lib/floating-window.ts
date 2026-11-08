/** A window floating inside another view, in pixels from that view's top-left corner. */
export interface FloatingRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FloatingBounds {
  width: number
  height: number
}

/** Which edge or corner a resize handle sits on. */
export type FloatingEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const FLOATING_EDGES: readonly FloatingEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
export const FLOATING_MIN_SIZE = { width: 320, height: 180 } as const
export const FLOATING_MARGIN = 16
const DEFAULT_MAX_SIZE = { width: 760, height: 460 } as const

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/** A window that fits the view it floats in: never smaller than its minimum unless the view is, never outside it. */
export function clampFloatingRect(rect: FloatingRect, bounds: FloatingBounds): FloatingRect {
  const width = Math.round(clamp(rect.width, Math.min(FLOATING_MIN_SIZE.width, bounds.width), bounds.width))
  const height = Math.round(clamp(rect.height, Math.min(FLOATING_MIN_SIZE.height, bounds.height), bounds.height))
  return {
    width,
    height,
    x: Math.round(clamp(rect.x, 0, bounds.width - width)),
    y: Math.round(clamp(rect.y, 0, bounds.height - height)),
  }
}

/** Where a window opens that has not been placed: the bottom-right corner, over the end of the conversation and the sidebar beside it. */
export function defaultFloatingRect(bounds: FloatingBounds): FloatingRect {
  const width = Math.min(DEFAULT_MAX_SIZE.width, Math.round(bounds.width * 0.6))
  const height = Math.min(DEFAULT_MAX_SIZE.height, Math.round(bounds.height * 0.5))
  return clampFloatingRect({
    width,
    height,
    x: bounds.width - width - FLOATING_MARGIN,
    y: bounds.height - height - FLOATING_MARGIN,
  }, bounds)
}

export function moveFloatingRect(start: FloatingRect, dx: number, dy: number, bounds: FloatingBounds): FloatingRect {
  return clampFloatingRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
}

/** Drags one edge or corner by (dx, dy). The opposite edge stays where it was, and the window stays inside its view. */
export function resizeFloatingRect(
  start: FloatingRect,
  edge: FloatingEdge,
  dx: number,
  dy: number,
  bounds: FloatingBounds
): FloatingRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (edge.includes('w')) left = clamp(start.x + dx, 0, right - FLOATING_MIN_SIZE.width)
  if (edge.includes('e')) right = clamp(right + dx, left + FLOATING_MIN_SIZE.width, bounds.width)
  if (edge.includes('n')) top = clamp(start.y + dy, 0, bottom - FLOATING_MIN_SIZE.height)
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + FLOATING_MIN_SIZE.height, bounds.height)
  return clampFloatingRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds)
}

export function isFloatingRect(value: unknown): value is FloatingRect {
  if (!value || typeof value !== 'object') return false
  const { x, y, width, height } = value as Record<string, unknown>
  return [x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part)) && (width as number) > 0 && (height as number) > 0
}
