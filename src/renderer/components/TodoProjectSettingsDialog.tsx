import { useEffect, useState } from 'react'
import type { TodoProject } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWorkspace } from '@/store/workspace'

interface TodoProjectSettingsDialogProps {
  project: TodoProject
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TodoProjectSettingsDialog({
  project,
  open,
  onOpenChange
}: TodoProjectSettingsDialogProps): JSX.Element {
  const updateTodoProject = useWorkspace((state) => state.updateTodoProject)
  const [name, setName] = useState(project.name)
  const [shorthand, setShorthand] = useState(project.shorthand ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validShorthand = /^[A-Z][A-Z0-9]{1,9}$/.test(shorthand)

  useEffect(() => {
    if (!open) return
    setName(project.name)
    setShorthand(project.shorthand ?? '')
    setSaving(false)
    setError(null)
  }, [open, project.id, project.name, project.shorthand])

  const save = async (): Promise<void> => {
    if (!name.trim() || !validShorthand || saving) return
    setSaving(true)
    setError(null)
    try {
      await updateTodoProject(project.id, { name: name.trim(), shorthand })
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save project settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>To Do project settings</DialogTitle>
          <DialogDescription>
            The shorthand prefixes every task number in this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="todo-settings-name">Project name</Label>
            <Input
              id="todo-settings-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-settings-shorthand">Shorthand</Label>
            <Input
              id="todo-settings-shorthand"
              value={shorthand}
              maxLength={10}
              placeholder="ENG"
              onChange={(event) => {
                setShorthand(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                setError(null)
              }}
            />
            <p className="text-[11px] text-fg-subtle">
              2–10 letters or numbers, starting with a letter. Existing task labels update.
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || !validShorthand || saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
