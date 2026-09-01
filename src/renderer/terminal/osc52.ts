/**
 * Policy for OSC 52, the escape sequence that lets a program running in a
 * terminal set the host clipboard.
 *
 * Every byte a process writes to a PTY reaches the parser, including output
 * from a remote SSH host, a file printed with `cat`, or attacker-authored text
 * inside a cloned repository. Obeying OSC 52 unconditionally therefore hands
 * clipboard control to anything that can print. The danger is what the user
 * pastes next: a payload ending in a newline is executed the moment it lands in
 * a shell prompt.
 *
 * The gate has two layers. The hard preconditions below apply under every
 * policy value and cannot be switched off, so a hidden, unfocused, or idle pane
 * can never reach the clipboard. The policy only decides how much confirmation
 * a foreground, just-used pane needs.
 */

export type Osc52Policy = 'never' | 'notify' | 'ask'

export type Osc52Decision =
  | 'allow'
  /** Needs an explicit, per-pane grant from the user first. */
  | 'ask'
  | 'deny-policy'
  /** The pane is off screen, or it or the window is unfocused. */
  | 'deny-inactive'
  /** No recent real user input in this pane. */
  | 'deny-stale'

export const OSC52_POLICIES: readonly Osc52Policy[] = ['notify', 'ask', 'never']

/**
 * How long a real keystroke or click keeps a pane eligible. A legitimate yank
 * follows the keypress that triggered it by milliseconds; this only has to be
 * generous enough to cover a slow remote round trip.
 */
export const OSC52_USER_INPUT_WINDOW_MS = 5_000

export const OSC52_PREVIEW_LENGTH = 120

/** How long an unanswered clipboard prompt stands before it counts as a refusal. */
export const OSC52_PROMPT_TIMEOUT_MS = 20_000

export interface Osc52Context {
  policy: Osc52Policy
  /** Whether the user already approved this pane for the rest of its life. */
  granted: boolean
  /** Whether the terminal is currently mounted in the DOM. */
  attached: boolean
  windowFocused: boolean
  terminalFocused: boolean
  /** `Number.POSITIVE_INFINITY` when the pane has never received user input. */
  msSinceUserInput: number
}

export function osc52ClipboardDecision(context: Osc52Context): Osc52Decision {
  if (context.policy === 'never') return 'deny-policy'
  if (!context.attached || !context.windowFocused || !context.terminalFocused) {
    return 'deny-inactive'
  }
  if (!(context.msSinceUserInput <= OSC52_USER_INPUT_WINDOW_MS)) return 'deny-stale'
  if (context.policy === 'ask' && !context.granted) return 'ask'
  return 'allow'
}

export interface Osc52Preview {
  /** Truncated, with control and direction-altering characters escaped. */
  preview: string
  truncated: boolean
  /** Length of the full decoded payload, not of `preview`. */
  length: number
  /** Pasting such a payload into a shell runs it immediately. */
  endsWithNewline: boolean
  multiline: boolean
}

const namedEscapes = new Map<number, string>([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0b, '\\v'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x1b, '\\e']
])

/**
 * Characters that would let a payload misrepresent itself in the preview the
 * user is judging: C0/C1 controls, and the bidirectional and zero-width
 * formatting characters that can reorder or hide neighbouring text.
 */
function needsEscape(code: number): boolean {
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  if (code >= 0x200b && code <= 0x200f) return true
  if (code >= 0x2028 && code <= 0x202e) return true
  if (code >= 0x2066 && code <= 0x2069) return true
  return code === 0xfeff
}

function escapeForPreview(text: string): string {
  let escaped = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\') {
      // Escaped first so a literal backslash cannot forge one of the sequences
      // produced below.
      escaped += '\\\\'
    } else if (namedEscapes.has(code)) {
      escaped += namedEscapes.get(code)
    } else if (needsEscape(code)) {
      escaped += code <= 0xff
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : `\\u{${code.toString(16)}}`
    } else {
      escaped += character
    }
  }
  return escaped
}

/** Builds the human-facing summary shown before or after a clipboard write. */
export function osc52Preview(text: string): Osc52Preview {
  const truncated = text.length > OSC52_PREVIEW_LENGTH
  return {
    preview: escapeForPreview(truncated ? text.slice(0, OSC52_PREVIEW_LENGTH) : text),
    truncated,
    length: text.length,
    endsWithNewline: /[\r\n]$/.test(text),
    multiline: /[\r\n]/.test(text)
  }
}

export function isOsc52Policy(value: unknown): value is Osc52Policy {
  return typeof value === 'string' && OSC52_POLICIES.includes(value as Osc52Policy)
}
