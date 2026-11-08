/**
 * The separator of the context and dropdown menus: a hairline in a block that is 12px tall. The items are 32px, so
 * the distance from one separator to the next is always a multiple of 4px. A menu is placed at a whole CSS pixel,
 * which at a system scale of 125%, 150% or 175% is not a whole device pixel, but a multiple of 4px is, so every
 * separator falls on the same sub-pixel and they all look alike. A 1px box with 4px margins (9px) made the first
 * separator look thicker than the second.
 */
export const MENU_SEPARATOR_CLASS = 'relative h-3 shrink-0 before:absolute before:inset-x-0 before:top-[5px] before:h-px before:bg-line'
