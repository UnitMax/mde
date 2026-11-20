/**
 * The small lettered badge that stands for a model provider. It is made from the provider's name alone, so a
 * provider someone set up themselves gets one the same way as a built-in one.
 */

const isLower = (char: string): boolean => char !== char.toLocaleUpperCase() && char === char.toLocaleLowerCase()
const isUpper = (char: string): boolean => char !== char.toLocaleLowerCase() && char === char.toLocaleUpperCase()

/**
 * One or two letters for a provider name. A camel-cased first word gives its first letter and the start of its
 * second hump ("OpenRouter" → "OR", "DeepSeek" → "DS"); anything else gives its first letter ("Anthropic" → "A",
 * "LM Studio" → "L"). Punctuation and spaces at the start are skipped; a name with no letters or digits gives "?".
 */
export function providerInitials(name: string): string {
  const word = name.trim().split(/[\s./:_-]+/u).map((part) => Array.from(part.replace(/[^\p{L}\p{N}]/gu, '')))
    .find((chars) => chars.length > 0)
  const [head, ...rest] = word ?? []
  if (head === undefined) return '?'
  let previous = head
  for (const char of rest) {
    if (isLower(previous) && isUpper(char)) return head.toLocaleUpperCase() + char
    previous = char
  }
  return head.toLocaleUpperCase()
}

/** Hues the badge is drawn in, spread around the wheel so that neighbours in the menu tell apart. */
const HUES = [255, 200, 160, 120, 75, 35, 0, 320, 285] as const

/** The hue for a provider name: the same name always gets the same one, whatever its case or spacing. */
export function providerHue(name: string): number {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return HUES[hash % HUES.length] ?? HUES[0]
}
