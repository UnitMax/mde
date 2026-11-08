import type { ChatModel, OpenCodeModelRef } from '@shared/types'
import { modelKey } from '@/lib/chat'
import type { FavoriteModel } from '@/lib/model-favorites'

/** How many favorites the quick switch offers at most. */
export const QUICK_SWITCH_LIMIT = 5

/**
 * The models the quick switch offers: the first few favorites, in the order they were starred, that this place has.
 * A favorite OpenCode does not list here is skipped, so the next one takes its place. When the model in use is a
 * favorite beyond the first few it takes the last place, so the one that is on is always among the buttons.
 */
export function quickSwitchModels(
  models: readonly ChatModel[],
  favorites: readonly FavoriteModel[],
  current: OpenCodeModelRef | null,
  limit = QUICK_SWITCH_LIMIT
): ChatModel[] {
  const byKey = new Map(models.map((model) => [modelKey(model), model]))
  const available = favorites.flatMap((favorite) => byKey.get(modelKey(favorite)) ?? [])
  const shown = available.slice(0, limit)
  const active = current ? available.find((model) => modelKey(model) === modelKey(current)) : undefined
  if (active && !shown.includes(active)) shown[shown.length - 1] = active
  return shown
}

/**
 * What switching to a model chooses: the model itself, with the effort in use when the model has it too, so that
 * moving between two models keeps "High" and falls back to the model's own default when it has no such level.
 */
export function switchedModel(model: ChatModel, current: OpenCodeModelRef | null): OpenCodeModelRef {
  const variant = current?.variant
  return {
    id: model.id,
    providerId: model.providerId,
    ...(variant && model.variants?.includes(variant) ? { variant } : {})
  }
}
