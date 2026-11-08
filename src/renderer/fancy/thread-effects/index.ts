import type { FancyPalette } from '@/fancy/color'
import { createLightningEffect } from './lightning'
import { createMatrixRainEffect } from './matrix-rain'
import type { RowEffect } from './types'

/** What a thread row can be lit with: a storm for the unread, digital rain for the working. */
export type ThreadEffectKind = 'unread' | 'working'

export const THREAD_EFFECT_FPS = 30

export function createThreadEffect(
  kind: ThreadEffectKind,
  palette: FancyPalette,
  seed: string,
  devicePixelRatio: number
): RowEffect {
  return kind === 'unread'
    ? createLightningEffect(palette, seed)
    : createMatrixRainEffect(palette, seed, devicePixelRatio)
}

export type { RowEffect } from './types'
