import { useEffect, useState } from 'react'
import { FolderSearch, LoaderCircle } from 'lucide-react'
import type { InboxFolder, InboxFolderIcon } from '@shared/types'
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
import { ProjectIconPicker } from '@/components/inbox/ProjectIconPicker'
import { WslFolderBrowser } from '@/components/WslFolderBrowser'
import { inboxFolderLabel } from '@/lib/inbox'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/** The longest name the field takes. Longer names are stored, but a folder name is rarely near this. */
export const PROJECT_NAME_MAX_LENGTH = 200

/**
 * The form that adds a project to the Inbox: the folder, and optionally a name and an icon. On Windows the
 * folder is in a WSL distro, where OpenCode runs; on macOS it is a local folder. Workspace sessions are not
 * touched. It starts empty each time it is shown, so the dialog and the project manager both mount it fresh.
 */
export function AddProjectForm({
  onAdded,
  onClose,
}: {
  onAdded?: (folder: InboxFolder) => void
  onClose: () => void
}): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addFolder = useInboxChat((state) => state.addFolder)
  const wsl = Boolean(platform?.isWindows)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<InboxFolderIcon | undefined>(undefined)
  const [distro, setDistro] = useState('')
  const [adding, setAdding] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (wsl) void refreshDistros()
  }, [wsl, refreshDistros])

  useEffect(() => {
    if (!wsl || distro) return
    const preferred = distros.find((item) => item.isDefault) ?? distros[0]
    if (preferred) setDistro(preferred.name)
  }, [wsl, distro, distros])

  const browse = async (): Promise<void> => {
    // The Windows file dialog cannot show a distro's folders, so WSL folders are chosen in MDE's own browser.
    if (wsl) {
      setBrowsing(true)
      return
    }
    const picked = await window.api.paths.browse()
    if (!picked) return
    const resolution = await window.api.paths.resolve({ kind: 'native', rawPath: picked })
    setPath(resolution.path)
  }

  const canAdd = path.trim().length > 0 && (!wsl || distro.length > 0) && !adding

  const add = async (): Promise<void> => {
    if (!canAdd) return
    setAdding(true)
    setError(null)
    try {
      const label = name.trim()
      const folder = await addFolder({
        kind: wsl ? 'wsl' : 'native',
        ...(wsl ? { distro } : {}),
        path: path.trim(),
        ...(label ? { name: label } : {}),
        ...(icon ? { icon } : {}),
      })
      onAdded?.(folder)
      onClose()
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not add the project.'))
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
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
            <Button
              type="button"
              variant="secondary"
              disabled={wsl && !distro}
              onClick={() => void browse()}
              title={wsl ? `Browse folders in ${distro || 'a WSL distro'}` : 'Browse'}
            >
              <FolderSearch className="h-3.5 w-3.5" />
              Browse
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inbox-folder-name">Name</Label>
          <Input
            id="inbox-folder-name"
            value={name}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            placeholder={path.trim() ? inboxFolderLabel(path.trim()) : 'The folder’s name'}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Icon</Label>
          <ProjectIconPicker value={icon} onChange={setIcon} />
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!canAdd}>
            {adding && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Add project
          </Button>
        </DialogFooter>
      </form>
      {wsl && (
        <WslFolderBrowser
          open={browsing}
          onOpenChange={setBrowsing}
          distro={distro}
          startPath={path}
          onChoose={(chosen) => {
            setPath(chosen)
            setBrowsing(false)
          }}
        />
      )}
    </>
  )
}

/** Adds a project from anywhere that has no project yet to start in: the new-thread page, mostly. */
export function AddInboxFolderDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: (folder: InboxFolder) => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            New threads start OpenCode in this folder. Projects are separate from your terminal sessions.
          </DialogDescription>
        </DialogHeader>
        <AddProjectForm onAdded={onAdded} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
