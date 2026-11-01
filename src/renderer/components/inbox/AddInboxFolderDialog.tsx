import { useEffect, useState } from 'react'
import { FolderSearch, LoaderCircle } from 'lucide-react'
import type { InboxFolder } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/**
 * Adds a folder to the Inbox only. On Windows the folder is in a WSL distro,
 * where OpenCode runs; on macOS it is a local folder. Workspace projects are
 * not touched.
 */
export function AddInboxFolderDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: (folder: InboxFolder) => void
}): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addFolder = useInboxChat((state) => state.addFolder)
  const wsl = Boolean(platform?.isWindows)
  const [path, setPath] = useState('')
  const [distro, setDistro] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPath('')
    setError(null)
    if (wsl) void refreshDistros()
  }, [open, wsl, refreshDistros])

  useEffect(() => {
    if (!wsl || distro) return
    const preferred = distros.find((item) => item.isDefault) ?? distros[0]
    if (preferred) setDistro(preferred.name)
  }, [wsl, distro, distros])

  const browse = async (): Promise<void> => {
    const picked = await window.api.paths.browse()
    if (!picked) return
    const resolution = await window.api.paths.resolve({ kind: wsl ? 'wsl' : 'native', ...(distro ? { distro } : {}), rawPath: picked })
    setPath(resolution.path)
    if (resolution.distro) setDistro(resolution.distro)
  }

  const canAdd = path.trim().length > 0 && (!wsl || distro.length > 0) && !adding

  const add = async (): Promise<void> => {
    if (!canAdd) return
    setAdding(true)
    setError(null)
    try {
      const folder = await addFolder({ kind: wsl ? 'wsl' : 'native', ...(wsl ? { distro } : {}), path: path.trim() })
      onAdded?.(folder)
      onOpenChange(false)
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not add the folder.'))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a folder to the Inbox</DialogTitle>
          <DialogDescription>
            New threads start OpenCode in this folder. Inbox folders are separate from your projects.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          {wsl && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inbox-folder-distro">WSL distro</Label>
              <Select value={distro} onValueChange={setDistro}>
                <SelectTrigger id="inbox-folder-distro">
                  <SelectValue placeholder="Choose a distro" />
                </SelectTrigger>
                <SelectContent>
                  {distros.map((item) => (
                    <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inbox-folder-path">Folder</Label>
            <div className="flex gap-1.5">
              <Input
                id="inbox-folder-path"
                autoFocus
                value={path}
                placeholder={wsl ? '/home/me/src/app' : '/Users/me/src/app'}
                onChange={(event) => setPath(event.target.value)}
              />
              <Button type="button" variant="secondary" onClick={() => void browse()} title="Browse">
                <FolderSearch className="h-3.5 w-3.5" />
                Browse
              </Button>
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!canAdd}>
              {adding && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              Add folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
