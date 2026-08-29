import { useEffect, useState } from 'react'
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

interface NewTodoProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewTodoProjectDialog({
  open,
  onOpenChange
}: NewTodoProjectDialogProps): JSX.Element {
  const addTodoProject = useWorkspace((state) => state.addTodoProject)
  const [name, setName] = useState('')
  const [shorthand, setShorthand] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setShorthand('')
      setCreating(false)
      setError(null)
    }
  }, [open])

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    const normalizedShorthand = shorthand.trim().toUpperCase()
    if (!trimmed || !/^[A-Z][A-Z0-9]{1,9}$/.test(normalizedShorthand) || creating) return
    setCreating(true)
    setError(null)
    try {
      await addTodoProject({ name: trimmed, shorthand: normalizedShorthand })
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the project.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            name.trim() &&
            /^[A-Z][A-Z0-9]{1,9}$/.test(shorthand.trim().toUpperCase()) &&
            !creating
          ) {
            event.preventDefault()
            void create()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New To Do project</DialogTitle>
          <DialogDescription>
            Create a separate Kanban board for tasks you want to organize.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="todo-project-name">Project name</Label>
          <Input
            id="todo-project-name"
            autoFocus
            value={name}
            placeholder="Product launch"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="todo-project-shorthand">Shorthand</Label>
          <Input
            id="todo-project-shorthand"
            value={shorthand}
            placeholder="ENG"
            maxLength={10}
            onChange={(event) => {
              setShorthand(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
              setError(null)
            }}
          />
          <p className="text-[11px] text-fg-subtle">
            2–10 letters or numbers, starting with a letter. Used for task IDs.
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              !name.trim() ||
              !/^[A-Z][A-Z0-9]{1,9}$/.test(shorthand.trim().toUpperCase()) ||
              creating
            }
            onClick={() => void create()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
