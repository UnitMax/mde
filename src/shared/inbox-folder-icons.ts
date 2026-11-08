import type { InboxFolderColor, InboxFolderIcon, InboxFolderSymbol } from './types'

export interface InboxFolderSymbolOption {
  id: InboxFolderSymbol
  label: string
}

/** The built-in pictures, in the order the picker shows them. The renderer draws each one by its id. */
export const INBOX_FOLDER_SYMBOLS = [
  { id: 'folder', label: 'Folder' },
  { id: 'repository', label: 'Repository' },
  { id: 'code', label: 'Code' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'braces', label: 'Braces' },
  { id: 'bug', label: 'Bug' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'web', label: 'Web' },
  { id: 'server', label: 'Server' },
  { id: 'database', label: 'Database' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'chip', label: 'Chip' },
  { id: 'package', label: 'Package' },
  { id: 'boxes', label: 'Boxes' },
  { id: 'layers', label: 'Layers' },
  { id: 'wrench', label: 'Wrench' },
  { id: 'hammer', label: 'Hammer' },
  { id: 'gear', label: 'Gear' },
  { id: 'lab', label: 'Lab' },
  { id: 'tests', label: 'Tests' },
  { id: 'design', label: 'Design' },
  { id: 'brush', label: 'Brush' },
  { id: 'pen', label: 'Pen' },
  { id: 'document', label: 'Document' },
  { id: 'book', label: 'Book' },
  { id: 'learning', label: 'Learning' },
  { id: 'work', label: 'Work' },
  { id: 'company', label: 'Company' },
  { id: 'shop', label: 'Shop' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'game', label: 'Game' },
  { id: 'music', label: 'Music' },
  { id: 'camera', label: 'Camera' },
  { id: 'video', label: 'Video' },
  { id: 'mail', label: 'Mail' },
  { id: 'chat', label: 'Chat' },
  { id: 'bot', label: 'Bot' },
  { id: 'sparkles', label: 'Sparkles' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'fire', label: 'Fire' },
  { id: 'nature', label: 'Nature' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' },
  { id: 'security', label: 'Security' },
  { id: 'key', label: 'Key' },
  { id: 'compass', label: 'Compass' },
  { id: 'map', label: 'Map' },
  { id: 'idea', label: 'Idea' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'target', label: 'Target' },
  { id: 'trophy', label: 'Trophy' },
  { id: 'chart', label: 'Chart' },
  { id: 'home', label: 'Home' },
  { id: 'network', label: 'Network' },
] as const satisfies readonly InboxFolderSymbolOption[]

export interface InboxFolderColorOption {
  id: InboxFolderColor
  label: string
  /** Middle tones, so a picture reads on the dark and the light themes alike. */
  hex: string
}

export const INBOX_FOLDER_COLORS = [
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'indigo', label: 'Indigo', hex: '#6366f1' },
  { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  { id: 'pink', label: 'Pink', hex: '#ec4899' },
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'yellow', label: 'Yellow', hex: '#d49b0a' },
  { id: 'green', label: 'Green', hex: '#22a559' },
  { id: 'teal', label: 'Teal', hex: '#14a3a0' },
] as const satisfies readonly InboxFolderColorOption[]

/** The most characters of an emoji: a family or a flag with a skin tone is a handful of code points. */
export const INBOX_FOLDER_EMOJI_MAX_LENGTH = 32

export function isInboxFolderSymbol(value: unknown): value is InboxFolderSymbol {
  return INBOX_FOLDER_SYMBOLS.some((option) => option.id === value)
}

export function isInboxFolderColor(value: unknown): value is InboxFolderColor {
  return INBOX_FOLDER_COLORS.some((option) => option.id === value)
}

export function inboxFolderColorHex(color: InboxFolderColor | undefined): string | undefined {
  return INBOX_FOLDER_COLORS.find((option) => option.id === color)?.hex
}

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/
const EMOJI_PART = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/**
 * Whether the text is exactly one emoji (a flag, a keycap or a joined family counts as one). It is only
 * ever drawn as text, so this keeps the field from holding a word or a pile of characters, not anything unsafe.
 */
export function isInboxFolderEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > INBOX_FOLDER_EMOJI_MAX_LENGTH) return false
  if (CONTROLS.test(value) || !EMOJI_PART.test(value)) return false
  let count = 0
  for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
    if (++count > 1) return false
  }
  return count === 1
}

/** A clean copy of a stored or received icon, or undefined when it is not a valid one. Extra fields are dropped. */
export function normalizeInboxFolderIcon(raw: unknown): InboxFolderIcon | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (record.kind === 'emoji') return isInboxFolderEmoji(record.emoji) ? { kind: 'emoji', emoji: record.emoji } : undefined
  if (record.kind !== 'symbol' || !isInboxFolderSymbol(record.id)) return undefined
  if (record.color !== undefined && !isInboxFolderColor(record.color)) return undefined
  return { kind: 'symbol', id: record.id, ...(record.color !== undefined ? { color: record.color as InboxFolderColor } : {}) }
}
