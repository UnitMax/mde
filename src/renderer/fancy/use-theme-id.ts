import { useSyncExternalStore } from 'react'
import type { ApplicationThemeId } from '@/theme/themes'
import { currentThemeId } from './color'

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** The application theme on screen; the component re-renders when the person picks another. */
export function useThemeId(): ApplicationThemeId {
  return useSyncExternalStore(subscribe, () => currentThemeId(), () => 'slate')
}
