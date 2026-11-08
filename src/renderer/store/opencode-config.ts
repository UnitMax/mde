import { create } from 'zustand'
import {
  draftsEqual,
  emptyDraft,
  OPENCODE_CONFIG_CHANGED,
  validateDraft,
  type OpenCodeConfigDraft,
  type OpenCodeConfigSnapshot,
  type OpenCodeConfigTarget,
} from '@shared/opencode-config'
import { ipcErrorMessage } from '@/lib/ipc-error'

interface OpenCodeConfigStore {
  /** Which file is being edited; null before the first load. */
  target: OpenCodeConfigTarget | null
  /** The file as it was read or last saved. Null while loading the first time, or when it could not be read. */
  snapshot: OpenCodeConfigSnapshot | null
  /** What the forms edit. It starts as the snapshot's draft and is only written by `save`. */
  draft: OpenCodeConfigDraft
  loading: boolean
  saving: boolean
  /** Why the file could not be read (not the same as a file that was read but is not valid JSONC). */
  loadError: string | null
  saveError: string | null
  /** The file changed on disk after it was read; the draft cannot be applied to it. */
  conflict: boolean
  /** When the last save finished, for the "Saved" note; cleared by the next edit. */
  savedAt: number | null
  /** Reads the file for a target and replaces the draft with what it holds. */
  load: (target: OpenCodeConfigTarget) => Promise<void>
  /** Changes the draft; `change` returns the new draft and must not modify the one it is given. */
  edit: (change: (draft: OpenCodeConfigDraft) => OpenCodeConfigDraft) => void
  /** Puts the draft back to what the file holds. */
  revert: () => void
  /** Writes the draft to the file. Resolves to whether it was written. */
  save: () => Promise<boolean>
  /** Forgets the file, e.g. when the dialog closes. A read still in flight is ignored. */
  reset: () => void
}

/** Whether the draft differs from the file. */
export function isConfigDirty(state: Pick<OpenCodeConfigStore, 'snapshot' | 'draft'>): boolean {
  return state.snapshot !== null && !draftsEqual(state.draft, state.snapshot.draft)
}

const IDLE = {
  target: null,
  snapshot: null,
  draft: emptyDraft(),
  loading: false,
  saving: false,
  loadError: null,
  saveError: null,
  conflict: false,
  savedAt: null,
} satisfies Partial<OpenCodeConfigStore>

/** Bumped by every load and reset, so that an answer that arrives after the person moved on is dropped. */
let generation = 0

export const useOpenCodeConfig = create<OpenCodeConfigStore>((set, get) => ({
  ...IDLE,

  load: async (target) => {
    generation += 1
    const mine = generation
    set({ ...IDLE, target, loading: true })
    try {
      const snapshot = await window.api.opencodeConfig.read(target)
      if (mine !== generation) return
      set({ snapshot, draft: snapshot.draft, loading: false })
    } catch (reason) {
      if (mine !== generation) return
      set({ loading: false, loadError: ipcErrorMessage(reason, 'Could not read the OpenCode configuration.') })
    }
  },

  edit: (change) =>
    set((state) => ({ draft: change(state.draft), saveError: null, conflict: false, savedAt: null })),

  revert: () =>
    set((state) => ({ draft: state.snapshot?.draft ?? emptyDraft(), saveError: null, conflict: false, savedAt: null })),

  save: async () => {
    const { target, snapshot, draft, saving } = get()
    if (!target || !snapshot || saving) return false
    if (snapshot.parseError) {
      set({ saveError: 'The file is not valid JSON, so MDE will not change it. Fix it by hand first.' })
      return false
    }
    const problem = validateDraft(draft)
    if (problem) {
      set({ saveError: problem })
      return false
    }
    const mine = generation
    set({ saving: true, saveError: null, conflict: false })
    try {
      const saved = await window.api.opencodeConfig.save({ ...target, draft, revision: snapshot.revision })
      if (mine !== generation) return false
      // Edits made while the write was under way are kept; only what was sent is now in the file.
      const stillEditing = get().draft !== draft
      set({ snapshot: saved, draft: stillEditing ? get().draft : saved.draft, saving: false, savedAt: Date.now() })
      return true
    } catch (reason) {
      if (mine !== generation) return false
      const message = ipcErrorMessage(reason, 'Could not save the OpenCode configuration.')
      set({ saving: false, saveError: message, conflict: message.includes(OPENCODE_CONFIG_CHANGED) })
      return false
    }
  },

  reset: () => {
    generation += 1
    set({ ...IDLE })
  },
}))
