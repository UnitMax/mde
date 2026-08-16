import type { SessionColor } from './types'

export interface SessionColorOption {
  id: SessionColor
  label: string
  hex: string
}

export const DEFAULT_SESSION_COLOR: SessionColor = 'default'

export const SESSION_COLORS = [
  { id: 'default', label: 'Slate', hex: '#232c3b' },
  { id: 'blue', label: 'Blue', hex: '#1e3f66' },
  { id: 'indigo', label: 'Indigo', hex: '#2b3470' },
  { id: 'violet', label: 'Violet', hex: '#3b2d64' },
  { id: 'plum', label: 'Plum', hex: '#4d2c50' },
  { id: 'rose', label: 'Rose', hex: '#512e42' },
  { id: 'red', label: 'Red', hex: '#522d35' },
  { id: 'orange', label: 'Orange', hex: '#5a3b25' },
  { id: 'green', label: 'Green', hex: '#244932' },
  { id: 'teal', label: 'Teal', hex: '#1f4949' }
] as const satisfies readonly SessionColorOption[]

export function isSessionColor(value: unknown): value is SessionColor {
  return SESSION_COLORS.some((option) => option.id === value)
}

export function sessionColorHex(color: SessionColor | undefined): string {
  return SESSION_COLORS.find((option) => option.id === (color ?? DEFAULT_SESSION_COLOR))?.hex ?? '#232c3b'
}
