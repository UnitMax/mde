import { useState } from 'react'
import type { InboxThread } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useWorkspace } from '@/store/workspace'

export interface ThreadRename {
  renaming: boolean
  name: string
  saving: boolean
  error: string | null
  setName: (name: string) => void
  /** Opens the dialog with the name the thread has now. */
  start: () => void
  cancel: () => void
  /** Saves a custom name, or with null clears it so OpenCode's title shows again. */
  save: (value: string | null) => Promise<void>
}

/** Renaming a thread, for the sidebar row and the thread header: the custom name is kept in the Inbox only. */
export function useThreadRename(thread: InboxThread): ThreadRename {
  const setCustomTitle = useWorkspace((state) => state.setInboxThreadCustomTitle)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (value: string | null): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await setCustomTitle(thread.id, value)
      setRenaming(false)
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not change the thread name.'))
    } finally {
      setSaving(false)
    }
  }
  return {
    renaming,
    name,
    saving,
    error,
    setName,
    start: () => {
      setName(thread.customTitle ?? thread.title)
      setError(null)
      setRenaming(true)
    },
    cancel: () => setRenaming(false),
    save
  }
}

export function ThreadRenameDialog({ thread, rename }: { thread: InboxThread; rename: ThreadRename }): JSX.Element {
  const { renaming, name, saving, error, setName, cancel, save } = rename
  const inputId = `inbox-thread-name-${thread.id}`
  return (
    <Dialog open={renaming} onOpenChange={(open) => { if (!saving && !open) cancel() }}>
      <DialogContent onOpenAutoFocus={(event) => {
        event.preventDefault()
        const input = document.getElementById(inputId) as HTMLInputElement | null
        input?.focus()
        input?.select()
      }}>
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && !saving) void save(name.trim()) }}>
          <DialogTitle>Rename thread</DialogTitle>
          <DialogDescription className="mt-1">
            Use a custom name in the Inbox. Clear it from the right-click menu to use OpenCode’s title again.
          </DialogDescription>
          <label htmlFor={inputId} className="mb-1 mt-4 block text-xs text-fg-muted">Custom name</label>
          <Input id={inputId} value={name} maxLength={512} disabled={saving} onChange={(event) => setName(event.target.value)} />
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
