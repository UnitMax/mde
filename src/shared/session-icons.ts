import type { SessionIcon } from './types'

export interface SessionIconOption {
  id: SessionIcon
  label: string
  emoji: string
}

export const SESSION_ICONS = [
  { id: 'computer', label: 'Computer', emoji: '💻' },
  { id: 'robot', label: 'Robot', emoji: '🤖' },
  { id: 'rocket', label: 'Rocket', emoji: '🚀' },
  { id: 'tools', label: 'Tools', emoji: '🛠️' },
  { id: 'bug', label: 'Bug', emoji: '🐛' },
  { id: 'lightning', label: 'Lightning', emoji: '⚡' },
  { id: 'globe', label: 'Web', emoji: '🌐' },
  { id: 'package', label: 'Package', emoji: '📦' },
  { id: 'test', label: 'Tests', emoji: '🧪' },
  { id: 'palette', label: 'Design', emoji: '🎨' }
] as const satisfies readonly SessionIconOption[]

export function isSessionIcon(value: unknown): value is SessionIcon {
  return SESSION_ICONS.some((option) => option.id === value)
}

export function sessionIconOption(icon: SessionIcon | undefined): SessionIconOption | undefined {
  return SESSION_ICONS.find((option) => option.id === icon)
}
