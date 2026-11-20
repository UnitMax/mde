/**
 * How much room the composer's toolbar has. Every control in it reads the same size and drops the same
 * things, instead of each one truncating on its own rules, so a narrow box loses labels in a fixed order and
 * never turns a word into "M…". The model name is the only text that is ever cut short.
 *
 * - wide, medium: everything.
 * - narrow: the MCP count and the agent's name go; their icons and the badge stay.
 * - tight: the effort goes too.
 *
 * The context meter is always its small ring, at every size.
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
