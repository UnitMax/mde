/**
 * A message can point at a pane of the Inbox terminal: the person drags the pane into the message box, and the
 * message then holds `[terminal:<ref> "<title>"]`. The agent reads that text as it is, and passes the ref to the
 * MDE MCP's `read_terminal` tool to read what the pane shows. The ref is a random name MDE keeps for the pane,
 * never the pane's own ID: only an agent the person showed a ref to can name that terminal. The message box and
 * the conversation show the text as a chip; all of them read it with the functions below.
 */

/** Characters of a ref: lowercase letters and digits that cannot be mistaken for one another. */
const REF_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const TERMINAL_REF_LENGTH = 10

/** The longest title a reference carries. */
export const TERMINAL_REF_TITLE_LIMIT = 60

/** Lines `read_terminal` gives when the agent does not say. */
export const TERMINAL_READ_DEFAULT_LINES = 200
/** The most lines one `read_terminal` call gives. */
export const TERMINAL_READ_LINE_LIMIT = 2000
/** The most characters one reading holds; a longer one keeps its end, the newest output. */
export const TERMINAL_READ_CHAR_LIMIT = 60_000

const REF = new RegExp(`^[${REF_ALPHABET}]{${TERMINAL_REF_LENGTH}}$`)
const TOKEN = new RegExp(`\\[terminal:([${REF_ALPHABET}]{${TERMINAL_REF_LENGTH}}) "([^"\\]\\n]{0,${TERMINAL_REF_TITLE_LIMIT}})"\\]`, 'g')

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function isTerminalRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value)
}

/** A new ref from random bytes (`crypto.getRandomValues` or Node's `randomBytes`). */
export function terminalRefFrom(bytes: Uint8Array): string {
  if (bytes.length < TERMINAL_REF_LENGTH) throw new Error('Not enough random bytes for a terminal reference.')
  let ref = ''
  for (let index = 0; index < TERMINAL_REF_LENGTH; index += 1) ref += REF_ALPHABET[bytes[index]! % REF_ALPHABET.length]
  return ref
}

/** A pane's title as a reference can carry it: one line, no quotes or brackets, not too long. */
export function cleanTerminalTitle(title: string): string {
  const cleaned = title.replace(CONTROL, ' ').replace(/["\]\[]/g, '').replace(/\s+/g, ' ').trim()
  const short = cleaned.length > TERMINAL_REF_TITLE_LIMIT ? `${cleaned.slice(0, TERMINAL_REF_TITLE_LIMIT - 1).trimEnd()}…` : cleaned
  return short || 'terminal'
}

/** How a reference is written in a message. */
export function terminalReferenceText(ref: string, title: string): string {
  return `[terminal:${ref} "${cleanTerminalTitle(title)}"]`
}

export interface TerminalReferenceToken {
  start: number
  end: number
  ref: string
  title: string
}

/** The references a message holds, in the order written. Offsets are UTF-16 indices, as in `text.slice`. */
export function terminalReferenceTokens(text: string): TerminalReferenceToken[] {
  if (!text.includes('[terminal:')) return []
  const tokens: TerminalReferenceToken[] = []
  for (const match of text.matchAll(TOKEN)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, ref: match[1]!, title: match[2]! })
  }
  return tokens
}

/** A piece of a message: plain text, or a terminal reference. */
export type TerminalReferencePart = { text: string; reference?: undefined } | { text: string; reference: TerminalReferenceToken }

export function splitTerminalReferences(text: string): TerminalReferencePart[] {
  const tokens = terminalReferenceTokens(text)
  if (tokens.length === 0) return [{ text }]
  const parts: TerminalReferencePart[] = []
  let from = 0
  for (const token of tokens) {
    if (token.start > from) parts.push({ text: text.slice(from, token.start) })
    parts.push({ text: text.slice(token.start, token.end), reference: token })
    from = token.end
  }
  if (from < text.length) parts.push({ text: text.slice(from) })
  return parts
}

/** The window asks main for a reference to one of its Inbox terminal panes. */
export interface TerminalReferenceCreateRequest {
  terminalId: string
  title: string
}

export interface TerminalReferenceCreated {
  ref: string
  /** The reference as it is written into the message. */
  text: string
}

/** Main asks the window what a pane shows. */
export interface TerminalReadRequest {
  requestId: string
  terminalId: string
  lines: number
}

/** What a pane shows, as the window read it from the terminal's screen and scrollback. */
export interface TerminalReading {
  title: string
  /** The shell's current directory, when MDE knows it. */
  directory: string | null
  /** Whether the shell still runs. */
  running: boolean
  /** Lines in the pane's scrollback and screen, of which `text` is the end. */
  totalLines: number
  /** The last lines, joined with `\n`, without colours. */
  text: string
}

export type TerminalReadAnswer =
  | { requestId: string; reading: TerminalReading }
  | { requestId: string; error: string }
