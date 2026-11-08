import { create } from 'zustand'
import { getFancySettings, saveFancySettings, type FancySettings } from '@/fancy/settings'

interface Store {
  settings: FancySettings
  /** Changes some of the settings and keeps the result between runs. */
  update: (patch: Partial<FancySettings>) => void
}

/** Fancy mode: the animated background and the Inbox thread effects, as the person last set them. */
export const useFancyMode = create<Store>((set, get) => ({
  settings: getFancySettings(),
  update: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveFancySettings(settings)
    set({ settings })
  }
}))

/** Whether fancy mode draws the background. */
export function useFancyBackgroundOn(): boolean {
  return useFancyMode((state) => state.settings.enabled)
}

/** Whether fancy mode lights up unread and working threads. */
export function useFancyThreadEffectsOn(): boolean {
  return useFancyMode((state) => state.settings.enabled && state.settings.threadEffects)
}
