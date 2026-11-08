import type { FancyPalette } from '@/fancy/color'
import type { FancyBackgroundId } from '@/fancy/settings'
import { createAurora } from './aurora'
import { createConstellation } from './constellation'
import { createContours } from './contours'
import type { BackgroundFactory, BackgroundRenderer } from './types'

export type { BackgroundRenderer } from './types'

const FACTORIES: Record<FancyBackgroundId, BackgroundFactory> = {
  aurora: createAurora,
  constellation: createConstellation,
  contours: createContours
}

/** How fast each background wants to be redrawn; the picture changes slowly, so fewer frames lose nothing. */
export const BACKGROUND_FPS: Record<FancyBackgroundId, number> = { aurora: 20, constellation: 30, contours: 20 }

/** A moment at which each background is at its most characteristic, for still pictures and previews. */
export const BACKGROUND_STILL_TIME: Record<FancyBackgroundId, number> = { aurora: 31, constellation: 22, contours: 40 }

export function createBackground(id: FancyBackgroundId, palette: FancyPalette): BackgroundRenderer {
  return FACTORIES[id](palette)
}
