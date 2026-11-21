/**
 * Characters that show as nothing or reorder what is around them: controls, zero-width and bidi marks, tag and
 * variation characters. Permission cards and the terminal paste check both mark them, so what the user approves is
 * what they see. Line breaks and tab are not in the set; each caller decides about those.
 */
export const HIDDEN_CHARACTER_CLASS = '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\ufff9-\\ufffb\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}]'

const hidden = new RegExp(`^${HIDDEN_CHARACTER_CLASS}$`, 'u')

export function isHiddenCharacter(character: string): boolean {
  return hidden.test(character)
}
