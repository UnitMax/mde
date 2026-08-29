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
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setCreating(false)
    }
  }, [open])

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      await addTodoProject({ name: trimmed })
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === 'Enter' && name.trim() && !creating) {
            event.preventDefault()
            void create()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New To Do project</DialogTitle>
          <DialogDescription>
            Create a separate workspace for tasks you want to organize later.
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

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim() || creating} onClick={() => void create()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
