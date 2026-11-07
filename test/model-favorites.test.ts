// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getModelFavorites, MODEL_FAVORITES_STORAGE_KEY, saveModelFavorites } from '../src/renderer/lib/model-favorites'
import { useModelFavorites } from '../src/renderer/store/model-favorites'

describe('model favorites', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useModelFavorites.setState({ favorites: [] })
  })

  it('saves provider/model identities without effort or model metadata', () => {
    const model = { id: 'model', providerId: 'provider', variant: 'high', name: 'Model' }
    saveModelFavorites([model])
    expect(getModelFavorites()).toEqual([{ id: 'model', providerId: 'provider' }])
    expect(JSON.parse(localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY)!)).toEqual([{ id: 'model', providerId: 'provider' }])
  })

  it('ignores malformed data and duplicate identities', () => {
    for (const raw of ['broken', '{}', 'null', 'true']) {
      localStorage.setItem(MODEL_FAVORITES_STORAGE_KEY, raw)
      expect(getModelFavorites()).toEqual([])
    }
    localStorage.setItem(MODEL_FAVORITES_STORAGE_KEY, JSON.stringify([
      { id: 'model', providerId: 'p' }, { id: 'model', providerId: 'p', variant: 'low' },
      { id: 'model', providerId: 'other' }, null, 'model', {},
      { id: '', providerId: 'p' }, { id: 'bad\nname', providerId: 'p' },
      { id: 'x'.repeat(513), providerId: 'p' },
    ]))
    expect(getModelFavorites()).toEqual([{ id: 'model', providerId: 'p' }, { id: 'model', providerId: 'other' }])
  })

  it('shares favorites across effort levels but keeps providers separate, and persists unstars', () => {
    useModelFavorites.getState().toggle({ id: 'model', providerId: 'p' })
    useModelFavorites.getState().toggle({ id: 'model', providerId: 'other' })
    expect(getModelFavorites()).toEqual(useModelFavorites.getState().favorites)
    useModelFavorites.getState().toggle({ id: 'model', providerId: 'p' })
    expect(getModelFavorites()).toEqual([{ id: 'model', providerId: 'other' }])
  })

  it('keeps favorites usable for the session when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
    expect(getModelFavorites()).toEqual([])
    expect(() => useModelFavorites.getState().toggle({ id: 'model', providerId: 'p' })).not.toThrow()
    expect(useModelFavorites.getState().favorites).toEqual([{ id: 'model', providerId: 'p' }])
    vi.restoreAllMocks()
  })
})
