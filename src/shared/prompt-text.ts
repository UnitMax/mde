/**
 * What a chat message may hold. The main process refuses a message (or a draft of one) that breaks these
 * rules, so the message box cleans what is pasted, dropped or quoted into it before it gets that far.
 */

/** The longest message the main process takes, and the longest draft it keeps (UTF-16 code units). */
export const PROMPT_TEXT_LIMIT = 100_000

/** Control characters a message must not hold. Tabs and line breaks (`\n`, `\r`) are fine. */
export const PROMPT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/**
 * Terminal escape sequences, as CI logs and terminal output carry them (`ESC[32;1m`, `ESC[0K`, window titles,
 * links): CSI and OSC sequences, and the two-character ones. They only colour or move text on a terminal.
 */
const ESCAPE_SEQUENCES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[ -/]*[0-~])/g
const CONTROL_CHARACTERS = new RegExp(PROMPT_CONTROL_CHARACTERS.source, 'g')

/**
 * Text as a message can hold it: terminal escape sequences are taken out whole, so no `[0;m` is left behind,
 * a vertical tab or form feed becomes a line break, and any other control character is dropped.
 */
export function cleanPromptText(text: string): string {
  if (!PROMPT_CONTROL_CHARACTERS.test(text)) return text
  return text
    .replace(ESCAPE_SEQUENCES, '')
    .replace(/[\u000b\u000c]/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
}
