import { useEffect, useMemo, useState } from 'react'
import type { TodoProject, TodoTask } from '@shared/types'
import { todoTaskIdentifier } from '@shared/todo'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  terminalIdForTask,
  taskIdForTerminal,
  type LiveTerminalDescriptor
} from '@/lib/terminal-task-links'
import { openCodeStatusShortLabel } from '@/lib/opencode-tui-status'
import { useWorkspace } from '@/store/workspace'

export type TerminalTaskLinkTarget =
  | { type: 'terminal'; terminalId: string }
  | { type: 'task'; taskId: string }

interface LinkPair {
  terminalId: string
  taskId: string
}

function taskLabel(task: TodoTask, projects: readonly TodoProject[]): string {
  const project = projects.find((candidate) => candidate.id === task.todoProjectId)
  return project ? `${todoTaskIdentifier(project, task)} · ${task.title}` : task.title
}

function terminalOptionLabel(terminal: LiveTerminalDescriptor): string {
  const status = terminal.openCodeInstance
    ? ` · ${openCodeStatusShortLabel(terminal.openCodeInstance.status)}`
    : ''
  return `${terminal.sessionName} · ${terminal.tabName} · ${terminal.label}${status}`
}

export function TerminalTaskLinkDialog({
  target,
  terminals,
  onOpenChange
}: {
  target: TerminalTaskLinkTarget | null
  terminals: readonly LiveTerminalDescriptor[]
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const tasks = useWorkspace((state) => state.todoTasks)
  const projects = useWorkspace((state) => state.todoProjects)
  const links = useWorkspace((state) => state.terminalTaskLinks)
  const linkTerminalToTodoTask = useWorkspace((state) => state.linkTerminalToTodoTask)
  const unlinkTerminalTask = useWorkspace((state) => state.unlinkTerminalTask)
  const unlinkTodoTask = useWorkspace((state) => state.unlinkTodoTask)
  const [selectedId, setSelectedId] = useState('')
  const [pendingPair, setPendingPair] = useState<LinkPair | null>(null)
  const [confirming, setConfirming] = useState(false)

  const targetKey = target ? `${target.type}:${target.type === 'terminal' ? target.terminalId : target.taskId}` : null
  const terminalById = useMemo(
    () => new Map(terminals.map((terminal) => [terminal.terminalId, terminal])),
    [terminals]
  )
  const targetTask = target?.type === 'task'
    ? tasks.find((task) => task.id === target.taskId)
    : undefined
  const targetTerminal = target?.type === 'terminal'
    ? terminalById.get(target.terminalId)
    : undefined
  const currentTaskId = target?.type === 'terminal'
    ? taskIdForTerminal(links, target.terminalId)
    : undefined
  const currentTerminalId = target?.type === 'task'
    ? terminalIdForTask(links, target.taskId)
    : undefined
  const currentTask = currentTaskId ? tasks.find((task) => task.id === currentTaskId) : undefined
  const currentTerminal = currentTerminalId ? terminalById.get(currentTerminalId) : undefined

  useEffect(() => {
    if (!target) {
      setSelectedId('')
      setPendingPair(null)
      setConfirming(false)
      return
    }
    setSelectedId(
      target.type === 'terminal'
        ? taskIdForTerminal(links, target.terminalId) ?? ''
        : terminalIdForTask(links, target.taskId) ?? ''
    )
    setPendingPair(null)
    setConfirming(false)
  }, [links, targetKey])

  const selectedTask = target?.type === 'terminal'
    ? tasks.find((task) => task.id === selectedId)
    : targetTask
  const selectedTerminal = target?.type === 'task'
    ? terminalById.get(selectedId)
    : targetTerminal
  const pair: LinkPair | null = selectedTask && selectedTerminal
    ? { terminalId: selectedTerminal.terminalId, taskId: selectedTask.id }
    : null
  const linkIsCurrent = pair !== null && links[pair.terminalId] === pair.taskId

  const conflictMessages = pair
    ? [
        (() => {
          const linkedTaskId = taskIdForTerminal(links, pair.terminalId)
          if (!linkedTaskId || linkedTaskId === pair.taskId) return null
          const linkedTask = tasks.find((task) => task.id === linkedTaskId)
          return `${terminalById.get(pair.terminalId)?.label ?? 'This terminal'} is currently linked to ${linkedTask ? taskLabel(linkedTask, projects) : 'another task'}.`
        })(),
        (() => {
          const linkedTerminalId = terminalIdForTask(links, pair.taskId)
          if (!linkedTerminalId || linkedTerminalId === pair.terminalId) return null
          const linkedTerminal = terminalById.get(linkedTerminalId)
          return `${taskLabel(selectedTask!, projects)} is currently linked to ${linkedTerminal?.label ?? 'another terminal'}.`
        })()
      ].filter((message): message is string => message !== null)
    : []

  const close = (): void => {
    setConfirming(false)
    setPendingPair(null)
    onOpenChange(false)
  }

  const commitPair = (nextPair: LinkPair): void => {
    linkTerminalToTodoTask(nextPair.terminalId, nextPair.taskId)
    close()
  }

  const link = (): void => {
    if (!pair || linkIsCurrent) {
      if (linkIsCurrent) close()
      return
    }
    if (conflictMessages.length > 0) {
      setPendingPair(pair)
      setConfirming(true)
      return
    }
    commitPair(pair)
  }

  const unlink = (): void => {
    if (!target) return
    if (target.type === 'terminal') unlinkTerminalTask(target.terminalId)
    else unlinkTodoTask(target.taskId)
    close()
  }

  const open = target !== null
  const hasCurrentLink =
    (currentTaskId !== null && currentTaskId !== undefined) ||
    (currentTerminalId !== null && currentTerminalId !== undefined)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {target && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {target.type === 'terminal' ? 'Link terminal to a task' : 'Link task to a terminal'}
              </DialogTitle>
              <DialogDescription>
                {target.type === 'terminal'
                  ? targetTerminal
                    ? `${targetTerminal.sessionName} · ${targetTerminal.tabName} · ${targetTerminal.label}`
                    : 'This terminal is no longer running.'
                  : targetTask
                    ? taskLabel(targetTask, projects)
                    : 'This task no longer exists.'}
              </DialogDescription>
            </DialogHeader>

            {hasCurrentLink && (
              <div className="rounded border border-line bg-panel px-3 py-2 text-xs text-fg-muted">
                Current link:{' '}
                <span className="text-fg">
                  {currentTask && taskLabel(currentTask, projects)}
                  {currentTask && currentTerminal && ' · '}
                  {currentTerminal && currentTerminal.label}
                  {!currentTask && !currentTerminal && 'unavailable'}
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">
                {target.type === 'terminal' ? 'To Do task' : 'Live terminal'}
              </label>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
                disabled={target.type === 'terminal' ? !targetTerminal || tasks.length === 0 : !targetTask || terminals.length === 0}
              >
                <SelectTrigger aria-label={target.type === 'terminal' ? 'To Do task' : 'Live terminal'}>
                  <SelectValue
                    placeholder={target.type === 'terminal' ? 'Select a task' : 'Select a live terminal'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {target.type === 'terminal'
                    ? tasks.map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {taskLabel(task, projects)}
                        </SelectItem>
                      ))
                    : terminals.map((terminal) => (
                        <SelectItem key={terminal.terminalId} value={terminal.terminalId}>
                          {terminalOptionLabel(terminal)}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              {target.type === 'task' && terminals.length === 0 && (
                <p className="text-xs text-fg-subtle">No running terminals are available.</p>
              )}
            </div>

            <DialogFooter className="justify-between">
              <div>
                {hasCurrentLink && (
                  <Button variant="danger" size="sm" onClick={unlink}>
                    Unlink
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!pair || linkIsCurrent} onClick={link}>
                  {hasCurrentLink ? 'Change link' : 'Link terminal'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Replace existing link?</AlertDialogTitle>
          <AlertDialogDescription>
            {conflictMessages.map((message) => <span key={message} className="block">{message}</span>)}
            Continuing will keep only the new terminal–task link.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPair(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingPair) commitPair(pendingPair)
              }}
            >
              Replace link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
