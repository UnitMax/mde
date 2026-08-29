import { useState, type DragEvent as ReactDragEvent } from 'react'
import { Circle, ListTodo, Plus, Settings2 } from 'lucide-react'
import type { TodoProject, TodoTask } from '@shared/types'
import { todoTaskIdentifier } from '@shared/todo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

interface TodoProjectViewProps {
  project: TodoProject | null
  tasks: TodoTask[]
  onNewTask: (columnId: string) => void
  onEditTask: (task: TodoTask) => void
  onOpenSettings: () => void
}

function todoTaskDescriptionPreview(description: string): string {
  const lines = description.split(/\r\n|\r|\n/)
  const firstLine = lines[0] ?? ''
  return lines.length > 1 ? `${firstLine}…` : firstLine
}

export function TodoProjectView({
  project,
  tasks,
  onNewTask,
  onEditTask,
  onOpenSettings
}: TodoProjectViewProps): JSX.Element {
  const moveTodoTask = useWorkspace((state) => state.moveTodoTask)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [dropColumnId, setDropColumnId] = useState<string | null>(null)

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ListTodo className="h-6 w-6 text-fg-subtle" />
        <div>
          <p className="text-[13px] text-fg-muted">No To Do project selected</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Create a To Do project from the sidebar to get started.
          </p>
        </div>
      </div>
    )
  }

  const taskForDrag = (event: ReactDragEvent): string =>
    draggingTaskId ?? event.dataTransfer.getData('text/plain')

  const moveBefore = (
    event: ReactDragEvent<HTMLButtonElement>,
    target: TodoTask,
    columnTasks: TodoTask[]
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = taskForDrag(event)
    if (!sourceId || sourceId === target.id) return
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY >= rect.top + rect.height / 2
    const tasksWithoutSource = columnTasks.filter((task) => task.id !== sourceId)
    const targetIndex = tasksWithoutSource.findIndex((task) => task.id === target.id)
    const beforeId = after ? tasksWithoutSource[targetIndex + 1]?.id ?? null : target.id
    setDraggingTaskId(null)
    setDropColumnId(null)
    void moveTodoTask(sourceId, target.columnId, beforeId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{project.name}</h1>
        <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
          {project.shorthand}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          title="Project settings"
          aria-label="Project settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex h-full min-w-full gap-3">
          {project.columns.map((column, columnIndex) => {
            const columnTasks = tasks.filter((task) => task.columnId === column.id)
            return (
              <section
                key={column.id}
                className={cn(
                  'flex h-full min-w-[280px] flex-1 flex-col rounded-lg border border-transparent',
                  dropColumnId === column.id && 'border-accent/50 bg-accent/5'
                )}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropColumnId(column.id)
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropColumnId(null)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceId = taskForDrag(event)
                  setDraggingTaskId(null)
                  setDropColumnId(null)
                  if (sourceId) void moveTodoTask(sourceId, column.id, null)
                }}
              >
                <div className="flex h-9 shrink-0 items-center gap-2 px-2">
                  <Circle
                    className={cn(
                      'h-3.5 w-3.5',
                      columnIndex === project.columns.length - 1
                        ? 'text-ok'
                        : columnIndex === 1
                          ? 'text-warn'
                          : 'text-fg-subtle'
                    )}
                  />
                  <h2 className="truncate text-[12px] font-medium text-fg-muted">{column.name}</h2>
                  <span className="text-[11px] text-fg-subtle">{columnTasks.length}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    onClick={() => onNewTask(column.id)}
                    title={`New task in ${column.name}`}
                    aria-label={`New task in ${column.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-2">
                  {columnTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      draggable
                      onClick={() => onEditTask(task)}
                      onDragStart={(event) => {
                        setDraggingTaskId(task.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', task.id)
                      }}
                      onDragEnd={() => {
                        setDraggingTaskId(null)
                        setDropColumnId(null)
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => moveBefore(event, task, columnTasks)}
                      className={cn(
                        'block w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-left shadow-sm transition-colors hover:border-line-strong hover:bg-hover',
                        draggingTaskId === task.id && 'opacity-45'
                      )}
                    >
                      <span className="font-mono text-[10px] text-fg-subtle">
                        {todoTaskIdentifier(project, task)}
                      </span>
                      <span className="mt-1 block text-[13px] font-medium leading-5 text-fg">
                        {task.title}
                      </span>
                      {task.description && (
                        <span className="mt-1 block truncate text-xs leading-4 text-fg-muted">
                          {todoTaskDescriptionPreview(task.description)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
