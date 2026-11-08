import { useEffect, useRef, useState } from 'react'
import type { TodoProject, TodoTask } from '@shared/types'
import { todoTaskIdentifier } from '@shared/todo'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
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
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/MarkdownEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'

interface TodoTaskDialogProps {
  project: TodoProject
  task: TodoTask | null
  defaultColumnId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TodoTaskDialog({
  project,
  task,
  defaultColumnId,
  open,
  onOpenChange
}: TodoTaskDialogProps): JSX.Element {
  const addTodoTask = useWorkspace((state) => state.addTodoTask)
  const updateTodoTask = useWorkspace((state) => state.updateTodoTask)
  const removeTodoTask = useWorkspace((state) => state.removeTodoTask)
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState(defaultColumnId)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descriptionEditorRef = useRef<MarkdownEditorHandle>(null)

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setColumnId(task?.columnId ?? defaultColumnId)
    setSaving(false)
    setConfirmingDelete(false)
    setError(null)
  }, [defaultColumnId, open, task])

  const save = async (): Promise<void> => {
    if (!title.trim() || saving || !descriptionEditorRef.current) return
    const description = descriptionEditorRef.current.getMarkdown()
    setSaving(true)
    setError(null)
    try {
      if (task) {
        await updateTodoTask(task.id, {
          title: title.trim(),
          description,
          columnId
        })
      } else {
        await addTodoTask({
          todoProjectId: project.id,
          columnId,
          title: title.trim(),
          description
        })
      }
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the task.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!task) return
    await removeTodoTask(task.id)
    setConfirmingDelete(false)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
            <DialogDescription>
              {task ? todoTaskIdentifier(project, task) : `Add work to ${project.name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="todo-task-title">Title</Label>
              <Input
                id="todo-task-title"
                autoFocus
                value={title}
                placeholder="What needs to be done?"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-task-description">Description</Label>
              <MarkdownEditor
                key={task?.id ?? 'new'}
                ref={descriptionEditorRef}
                defaultValue={task?.description ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Column</Label>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger aria-label="Task column">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {project.columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}

          <DialogFooter className="justify-between">
            <div>
              {task && (
                <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!title.trim() || saving} onClick={() => void save()}>
                {task ? 'Save' : 'Create task'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {task ? todoTaskIdentifier(project, task) : 'this task'}. Its
            number will not be reused.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete task</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
