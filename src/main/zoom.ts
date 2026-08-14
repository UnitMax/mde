export const DEFAULT_ZOOM_FACTOR = 1
export const MIN_ZOOM_FACTOR = 0.5
export const MAX_ZOOM_FACTOR = 2
export const ZOOM_STEP = 0.1

export type ZoomAction = 'in' | 'out' | 'reset'

interface ZoomInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
}

/** Returns the zoom action represented by a browser keyboard event. */
export function getZoomAction(input: ZoomInput): ZoomAction | null {
  if (input.type !== 'keyDown' || input.alt || (!input.control && !input.meta)) return null

  if (
    input.key === '+' ||
    input.key === '=' ||
    input.code === 'Equal' ||
    input.code === 'NumpadAdd'
  ) {
    return 'in'
  }
  if (
    input.key === '-' ||
    input.key === '_' ||
    input.code === 'Minus' ||
    input.code === 'NumpadSubtract'
  ) {
    return 'out'
  }
  if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') return 'reset'
  return null
}

export function adjustZoomFactor(factor: number, action: ZoomAction): number {
  if (action === 'reset') return DEFAULT_ZOOM_FACTOR

  const delta = action === 'in' ? ZOOM_STEP : -ZOOM_STEP
  const next = Math.round((factor + delta) * 100) / 100
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, next))
}
