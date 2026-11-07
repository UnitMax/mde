/**
 * How much room the composer's toolbar has. Every control in it reads the same size and drops the same
 * things, instead of each one truncating on its own rules, so a narrow box loses labels in a fixed order and
 * never turns a word into "M…". The model name is the only text that is ever cut short.
 *
 * - wide: everything, the context meter as segments, the provider after the model.
 * - medium: the provider goes, and the segments become a ring.
 * - narrow: the MCP count, the agent's name and the context number go; their icons, the badge and the ring stay.
 * - tight: the effort goes too.
 */
export type ComposerSize = 'wide' | 'medium' | 'narrow' | 'tight'

const ORDER: readonly ComposerSize[] = ['tight', 'narrow', 'medium', 'wide']

/** The toolbar's width, in pixels, from which each size applies. */
export const COMPOSER_SIZE_FLOORS = { wide: 680, medium: 540, narrow: 410 } as const

/**
 * The size for a toolbar this wide. A width that was not measured (zero, or not a number) counts as wide:
 * everything is shown until the real width is known.
 */
export function composerSizeFor(width: number): ComposerSize {
  if (!Number.isFinite(width) || width <= 0) return 'wide'
  if (width >= COMPOSER_SIZE_FLOORS.wide) return 'wide'
  if (width >= COMPOSER_SIZE_FLOORS.medium) return 'medium'
  if (width >= COMPOSER_SIZE_FLOORS.narrow) return 'narrow'
  return 'tight'
}

/** Whether `size` is `floor` or roomier. */
export function atLeast(size: ComposerSize, floor: ComposerSize): boolean {
  return ORDER.indexOf(size) >= ORDER.indexOf(floor)
}

/** What the model chip's text is estimated to need per character, in pixels, at the toolbar's 12 px type. */
const CHAR_PX = 6.5
/** Everything else on the row at the wide size (attach, agent, MCP, context, send, the chip's own padding), with some slack. */
const ROW_PX = 470

/** The characters of the separators in `Provider / Model · Effort`, as the chip counts them. */
const PROVIDER_SEPARATOR = 3
const EFFORT_SEPARATOR = 3

/**
 * Whether the provider's name fits in front of the model name and the effort in a toolbar this wide. The model
 * name matters more than the provider, so when the whole would not fit the provider is left out, instead of
 * squeezing the name. An estimate from the character count, not a measurement; the name still ends in an
 * ellipsis if the estimate is off.
 */
export function providerFits(name: string, effort: string | null, provider: string, width: number): boolean {
  const chars = provider.length + PROVIDER_SEPARATOR + name.length + (effort ? effort.length + EFFORT_SEPARATOR : 0)
  return chars * CHAR_PX <= width - ROW_PX
}
