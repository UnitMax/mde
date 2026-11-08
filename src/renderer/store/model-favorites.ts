import { create } from 'zustand'
import { modelKey } from '@/lib/chat'
import { getModelFavorites, saveModelFavorites, type FavoriteModel } from '@/lib/model-favorites'

interface Store {
  favorites: FavoriteModel[]
  toggle: (model: FavoriteModel) => void
}

export const useModelFavorites = create<Store>((set) => ({
  favorites: getModelFavorites(),
  toggle: (model) => set((state) => {
    const key = modelKey(model)
    const favorites = state.favorites.some((favorite) => modelKey(favorite) === key)
      ? state.favorites.filter((favorite) => modelKey(favorite) !== key)
      : [...state.favorites, { id: model.id, providerId: model.providerId }]
    saveModelFavorites(favorites)
    return { favorites }
  }),
}))
