/**
 * Decides whether text pasted into a terminal must be shown to the user before
 * it reaches the program, and builds what they are shown.
 *
 * Pasted text goes straight to the foreground program. Bracketed paste is the
 * program's own defence: it marks pasted text so a shell leaves it at the
 * prompt instead of running it. That defence covers line breaks only when the
 * program has turned it on, and never covers control characters, because
 * xterm passes an escape character through unchanged and a pasted
 * `ESC [ 201 ~` ends the bracket early. Hidden and text-direction characters
 * defeat the user's own reading of what they copied.
 *
 * So ordinary text is pasted at once, and a paste is held for review when:
 *  - it has a line break and the program has not turned bracketed paste on;
 *  - it has a control character other than tab and line breaks, always;
 *  - it has an invisible or text-direction character, always.
 */

import { isHiddenCharacter } from '@/lib/hidden-characters'

export type PasteHazard = 'line-break' | 'control' | 'hidden'

export interface PasteSegment {
  text: string
  /** A character the preview stands in for, so the user can see where it is. */
  marked: boolean
}

export interface PasteReview {
  hazards: PasteHazard[]
  /** The text line by line, cut to fit the preview. */
  lines: PasteSegment[][]
  truncated: boolean
  /** Lines in the whole paste, not only the preview. */
  lineCount: number
  /** Whether the last line ends with a line break, which a shell takes as Enter. */
  endsWithLineBreak: boolean
}

export const PASTE_PREVIEW_LINES = 12
export const PASTE_PREVIEW_CHARACTERS = 1200

const named = new Map<number, string>([
  [0x08, '\\b'],
  [0x0b, '\\v'],
  [0x0c, '\\f'],
  [0x1b, 'ESC'],
  [0x7f, 'DEL']
])

/** C0 and C1 controls that act as keys or start sequences; tab and line breaks are ordinary text. */
function isControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

const pictographic = /^\p{Extended_Pictographic}$/u
const skinTone = /^\p{Emoji_Modifier}$/u
const keycapBase = /^[0-9#*]$/

/**
 * Whether the hidden character at `index` is one an emoji is built with, which is not held:
 *  - a variation selector (U+FE0E, U+FE0F) right after an emoji ("❤" + U+FE0F), or after 0-9, # or * when the
 *    keycap mark U+20E3 follows ("1" + U+FE0F + U+20E3);
 *  - a joiner (U+200D) between two emoji, the first of which may end in a skin tone or a variation selector
 *    ("👩" + U+200D + "💻").
 * Anything else, such as a joiner after a letter ("café" + U+200D), is held, so a lookalike name cannot hide one.
 */
function isEmojiPart(characters: readonly string[], index: number): boolean {
  const code = characters[index]!.codePointAt(0)
  const before = characters[index - 1] ?? ''
  const after = characters[index + 1] ?? ''
  if (code === 0xfe0e || code === 0xfe0f) {
    return pictographic.test(before) || (keycapBase.test(before) && after === '\u20e3')
  }
  if (code === 0x200d) {
    const emojiBefore = pictographic.test(before) || skinTone.test(before) ||
      ((before === '\ufe0f') && pictographic.test(characters[index - 2] ?? ''))
    return emojiBefore && pictographic.test(after)
  }
  return false
}

/** The hidden characters permission cards mark (`@/lib/hidden-characters`), less emoji parts and the controls above. */
function isHiddenAt(characters: readonly string[], index: number): boolean {
  return isHiddenCharacter(characters[index]!) && !isEmojiPart(characters, index)
}

function hasLineBreak(text: string): boolean {
  return /[\r\n]/.test(text)
}

export function pasteHazards(text: string, bracketedPaste: boolean): PasteHazard[] {
  const hazards = new Set<PasteHazard>()
  if (!bracketedPaste && hasLineBreak(text)) hazards.add('line-break')
  const characters = Array.from(text)
  characters.forEach((character, index) => {
    if (isControl(character.codePointAt(0) ?? 0)) hazards.add('control')
    else if (isHiddenAt(characters, index)) hazards.add('hidden')
  })
  return (['line-break', 'control', 'hidden'] as const).filter((hazard) => hazards.has(hazard))
}

function stand(code: number): string {
  return `<${named.get(code) ?? `U+${code.toString(16).toUpperCase().padStart(4, '0')}`}>`
}

/** Splits text into its lines as a terminal reads them: `\r\n`, `\n` and a lone `\r` each end one. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

export function pasteReview(text: string, bracketedPaste: boolean): PasteReview | null {
  const hazards = pasteHazards(text, bracketedPaste)
  if (hazards.length === 0) return null

  const all = splitLines(text)
  const endsWithLineBreak = all.length > 1 && all[all.length - 1] === ''
  const real = endsWithLineBreak ? all.slice(0, -1) : all
  const lines: PasteSegment[][] = []
  let budget = PASTE_PREVIEW_CHARACTERS
  let truncated = false

  for (const line of real) {
    if (lines.length === PASTE_PREVIEW_LINES || budget <= 0) {
      truncated = true
      break
    }
    const segments: PasteSegment[] = []
    let plain = ''
    const characters = Array.from(line)
    for (const [index, character] of characters.entries()) {
      if (budget <= 0) {
        truncated = true
        break
      }
      budget -= 1
      const code = character.codePointAt(0) ?? 0
      if (isControl(code) || isHiddenAt(characters, index)) {
        if (plain) segments.push({ text: plain, marked: false })
        plain = ''
        segments.push({ text: stand(code), marked: true })
      } else {
        plain += character
      }
    }
    if (plain) segments.push({ text: plain, marked: false })
    lines.push(segments)
  }

  return { hazards, lines, truncated, lineCount: real.length, endsWithLineBreak }
}

/** What the prompt says about each hazard, in the order found. */
export function pastePromptReasons(review: PasteReview): string[] {
  return review.hazards.map((hazard) => {
    if (hazard === 'line-break') {
      const lines = review.lineCount === 1 ? 'It ends with a line break' : `It has ${review.lineCount} lines`
      return `${lines}, and the program in this terminal has not asked for pasted text to be marked, so a shell may run each line as it arrives.`
    }
    if (hazard === 'control') {
      return 'It contains control characters (marked), which can act as keys or end a marked paste early.'
    }
    return 'It contains invisible or text-direction characters (marked), which can hide what the text really says.'
  })
}
