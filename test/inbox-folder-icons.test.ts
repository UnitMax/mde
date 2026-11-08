import { describe, expect, it } from 'vitest'
import {
  INBOX_FOLDER_COLORS,
  INBOX_FOLDER_EMOJI_MAX_LENGTH,
  INBOX_FOLDER_SYMBOLS,
  inboxFolderColorHex,
  isInboxFolderColor,
  isInboxFolderEmoji,
  isInboxFolderSymbol,
  normalizeInboxFolderIcon,
} from '../src/shared/inbox-folder-icons'

describe('inbox folder icons', () => {
  it('offers unique built-in icons and tints, each with a label and (for a tint) a hex colour', () => {
    expect(new Set(INBOX_FOLDER_SYMBOLS.map((option) => option.id)).size).toBe(INBOX_FOLDER_SYMBOLS.length)
    expect(new Set(INBOX_FOLDER_SYMBOLS.map((option) => option.label)).size).toBe(INBOX_FOLDER_SYMBOLS.length)
    expect(INBOX_FOLDER_SYMBOLS[0]).toEqual({ id: 'folder', label: 'Folder' })
    expect(new Set(INBOX_FOLDER_COLORS.map((option) => option.id)).size).toBe(INBOX_FOLDER_COLORS.length)
    for (const option of INBOX_FOLDER_COLORS) expect(option.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('knows its own ids and nothing else', () => {
    expect(isInboxFolderSymbol('rocket')).toBe(true)
    expect(isInboxFolderSymbol('Rocket')).toBe(false)
    expect(isInboxFolderSymbol('constructor')).toBe(false)
    expect(isInboxFolderSymbol(undefined)).toBe(false)
    expect(isInboxFolderColor('teal')).toBe(true)
    expect(isInboxFolderColor('#14a3a0')).toBe(false)
    expect(inboxFolderColorHex('teal')).toBe('#14a3a0')
    expect(inboxFolderColorHex(undefined)).toBeUndefined()
  })

  it('takes exactly one emoji, however many characters it is made of', () => {
    for (const emoji of ['🚀', '📁', '🛠️', '❤️', '⭐', '👩‍💻', '👨‍👩‍👧‍👦', '👍🏽', '🇩🇪', '1️⃣', '🏴󠁧󠁢󠁥󠁮󠁧󠁿']) {
      expect(isInboxFolderEmoji(emoji), emoji).toBe(true)
    }
    for (const bad of ['', ' ', 'a', 'abc', '1', '🚀🚀', '🚀 ', ' 🚀', '🚀a', '🚀\n', '<b>', '\u0000', 7, null, undefined, {}]) {
      expect(isInboxFolderEmoji(bad), String(bad)).toBe(false)
    }
    expect(isInboxFolderEmoji('🚀'.repeat(INBOX_FOLDER_EMOJI_MAX_LENGTH))).toBe(false)
  })

  it('normalizes an icon to a clean copy, or to nothing', () => {
    expect(normalizeInboxFolderIcon({ kind: 'symbol', id: 'bug', color: 'red', extra: 1 })).toEqual({ kind: 'symbol', id: 'bug', color: 'red' })
    expect(normalizeInboxFolderIcon({ kind: 'symbol', id: 'bug' })).toEqual({ kind: 'symbol', id: 'bug' })
    expect(normalizeInboxFolderIcon({ kind: 'emoji', emoji: '🚀', extra: 1 })).toEqual({ kind: 'emoji', emoji: '🚀' })
    for (const bad of [undefined, null, 'bug', [], {}, { kind: 'symbol' }, { kind: 'symbol', id: 'x' }, { kind: 'symbol', id: 'bug', color: 'x' }, { kind: 'emoji', emoji: 'x' }, { kind: 'emoji' }, { kind: 'other' }]) {
      expect(normalizeInboxFolderIcon(bad)).toBeUndefined()
    }
  })
})
