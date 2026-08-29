import { ListTodo } from 'lucide-react'
import type { TodoProject } from '@shared/types'

interface TodoProjectViewProps {
  project: TodoProject | null
}

export function TodoProjectView({ project }: TodoProjectViewProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {project && (
        <header className="flex h-12 shrink-0 items-center border-b border-line px-5">
          <h1 className="truncate text-[13px] font-medium text-fg">{project.name}</h1>
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <ListTodo className="h-6 w-6 text-fg-subtle" />
        <div>
          <p className="text-[13px] text-fg-muted">
            {project ? 'Task view coming later' : 'No To Do project selected'}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {project
              ? 'This project is ready for the upcoming task view.'
              : 'Create a To Do project from the sidebar to get started.'}
          </p>
        </div>
      </div>
    </div>
  )
}
