import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FolderPlus, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import type { InboxFolder, InboxFolderIcon } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddProjectForm, PROJECT_NAME_MAX_LENGTH } from '@/components/inbox/AddInboxFolderDialog'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { ProjectIconPicker } from '@/components/inbox/ProjectIconPicker'
import { inboxThreadFolder } from '@/lib/inbox'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string }

/** Where a project is, for its row: the folder, and the WSL distro it is in. */
function placeOf(folder: InboxFolder): string {
  return `${folder.directory}${folder.target.kind === 'wsl' ? ` · ${folder.target.distro}` : ''}`
}

/** Changes a project's name and icon. The folder stays; another folder is another project. */
function EditProjectForm({ folder, onClose }: { folder: InboxFolder; onClose: () => void }): JSX.Element {
  const updateFolder = useInboxChat((state) => state.updateFolder)
  const [name, setName] = useState(folder.name)
  const [icon, setIcon] = useState<InboxFolderIcon | undefined>(folder.icon)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = name.trim().length > 0 && !saving

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await updateFolder({ id: folder.id, name: name.trim(), icon: icon ?? null })
      onClose()
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not save the project.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="inbox-project-edit"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-project-name">Name</Label>
        <Input
          id="inbox-project-name"
          autoFocus
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inbox-project-folder">Folder</Label>
        <Input id="inbox-project-folder" readOnly value={placeOf(folder)} title={placeOf(folder)} className="text-fg-muted" />
        <p className="text-[11px] text-fg-subtle">The folder stays as it is. To work in another one, add it as a new project.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Icon</Label>
        <ProjectIconPicker value={icon} onChange={setIcon} />
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!canSave}>
          {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

function ProjectRow({
  folder,
  threads,
  onEdit,
  onRemove,
}: {
  folder: InboxFolder
  threads: number
  onEdit: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <li
      data-testid="inbox-project-row"
      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-fg-muted">
        <ProjectIcon icon={folder.icon} size="md" />
      </span>
      <span className="min-w-0 flex-1">
        <span data-testid="inbox-project-name" className="block truncate text-[13px] text-fg" title={folder.name}>{folder.name}</span>
        <span className="block truncate text-[11px] text-fg-subtle" title={placeOf(folder)}>
          {placeOf(folder)}
          {threads > 0 && ` · ${threads} ${threads === 1 ? 'thread' : 'threads'}`}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="inbox-project-edit-button"
        aria-label={`Edit ${folder.name}`}
        title="Edit"
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="inbox-project-remove-button"
        aria-label={`Remove ${folder.name}`}
        title="Remove from the Inbox"
        className="hover:text-danger"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

/**
 * The project manager: every folder the Inbox can start threads in, with their icons. A project can be added,
 * renamed, given another icon, or removed. Worktrees MDE made for threads are not projects and are not listed.
 */
export function InboxProjectsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const folders = useInboxChat((state) => state.folders)
  const removeFolder = useInboxChat((state) => state.removeFolder)
  const threads = useWorkspace((state) => state.inboxThreads)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [removing, setRemoving] = useState<InboxFolder | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Closed, it forgets where it was: the next opening starts at the list.
  useEffect(() => {
    if (open) return
    setView({ kind: 'list' })
    setRemoving(null)
    setRemoveError(null)
  }, [open])

  // By name, so a project keeps its place while it is used; the chooser on the new-thread page is by use.
  const projects = useMemo(
    () => folders.filter((folder) => !folder.worktree).sort((a, b) => a.name.localeCompare(b.name)),
    [folders]
  )
  const worktrees = folders.length - projects.length
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const thread of threads) {
      const folder = inboxThreadFolder(thread, folders)
      if (folder) result.set(folder.id, (result.get(folder.id) ?? 0) + 1)
    }
    return result
  }, [threads, folders])

  const editing = view.kind === 'edit' ? projects.find((folder) => folder.id === view.id) : undefined
  // A project that disappeared while it was being edited leaves nothing to edit.
  const shown: View = view.kind === 'edit' && !editing ? { kind: 'list' } : view
  const back = (): void => setView({ kind: 'list' })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* The icon picker makes the form tall; in a short window the dialog scrolls instead of running off the screen. */}
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto" data-testid="inbox-projects">
          <DialogHeader>
            {shown.kind !== 'list' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="inbox-projects-back"
                onClick={back}
                className="-ml-2 mb-1 text-fg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Projects
              </Button>
            )}
            <DialogTitle>{shown.kind === 'add' ? 'Add a project' : shown.kind === 'edit' ? 'Edit project' : 'Projects'}</DialogTitle>
            <DialogDescription>
              {shown.kind === 'list'
                ? 'The folders OpenCode works in. A project’s icon shows beside its threads in the sidebar.'
                : shown.kind === 'add'
                  ? 'New threads start OpenCode in this folder. Projects are separate from your terminal sessions.'
                  : 'Rename the project or give it another icon.'}
            </DialogDescription>
          </DialogHeader>

          {shown.kind === 'add' && <AddProjectForm onClose={back} />}
          {shown.kind === 'edit' && editing && <EditProjectForm key={editing.id} folder={editing} onClose={back} />}
          {shown.kind === 'list' && (
            <>
              {projects.length === 0 ? (
                <p data-testid="inbox-projects-empty" className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[13px] text-fg-muted">
                  No projects yet. Add a folder for OpenCode to work in.
                </p>
              ) : (
                <ul data-testid="inbox-project-list" className="-mx-2 flex max-h-[min(24rem,50vh)] flex-col gap-0.5 overflow-y-auto">
                  {projects.map((folder) => (
                    <ProjectRow
                      key={folder.id}
                      folder={folder}
                      threads={counts.get(folder.id) ?? 0}
                      onEdit={() => setView({ kind: 'edit', id: folder.id })}
                      onRemove={() => {
                        setRemoveError(null)
                        setRemoving(folder)
                      }}
                    />
                  ))}
                </ul>
              )}
              {worktrees > 0 && (
                <p className="mt-2 text-[11px] text-fg-subtle">
                  Worktrees that MDE made for threads are not listed here.
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                <Button type="button" data-testid="inbox-project-add" onClick={() => setView({ kind: 'add' })}>
                  <FolderPlus className="h-3.5 w-3.5" />
                  Add project
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={removing !== null} onOpenChange={(next) => { if (!next && !removeBusy) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{removing?.name}” from the Inbox?</AlertDialogTitle>
          <AlertDialogDescription>
            The project leaves the list and the new-thread chooser. Its threads stay in the Inbox, and the folder on
            disk is not touched. Add the folder again any time.
          </AlertDialogDescription>
          {removeError && <p role="alert" className="mt-3 text-xs text-danger">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="inbox-project-remove-confirm"
              disabled={removeBusy}
              onClick={(event) => {
                // Stay open until the project is gone, so a failure can be shown and tried again.
                event.preventDefault()
                if (!removing) return
                setRemoveBusy(true)
                setRemoveError(null)
                removeFolder(removing.id)
                  .then(() => setRemoving(null))
                  .catch((reason) => setRemoveError(ipcErrorMessage(reason, 'Could not remove the project.')))
                  .finally(() => setRemoveBusy(false))
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
