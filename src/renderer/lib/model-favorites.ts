import type { OpenCodeModelRef } from '@shared/types'
import { modelKey } from '@/lib/chat'

export const MODEL_FAVORITES_STORAGE_KEY = 'mde.model-favorites'
export type FavoriteModel = Pick<OpenCodeModelRef, 'id' | 'providerId'>

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** Favorites belong to the provider and model, independently of effort or project availability. */
export function getModelFavorites(): FavoriteModel[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    const favorites = new Map<string, FavoriteModel>()
    for (const value of stored) {
      if (!value || typeof value !== 'object' || !identifier(value.id) || !identifier(value.providerId)) continue
      const model = { id: value.id, providerId: value.providerId }
      favorites.set(modelKey(model), model)
    }
    return [...favorites.values()]
  } catch {
    return []
  }
}

export function saveModelFavorites(models: readonly FavoriteModel[]): void {
  try {
    localStorage.setItem(MODEL_FAVORITES_STORAGE_KEY, JSON.stringify(models.map(({ id, providerId }) => ({ id, providerId }))))
  } catch {
    // Favorites still work for this session when storage is unavailable.
  }
}
