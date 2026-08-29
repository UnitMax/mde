import { Terminal } from 'lucide-react'
import type { LiveTerminalDescriptor } from '@/lib/terminal-task-links'
import { terminalTaskBadgeModel } from '@/lib/terminal-task-links'
import { cn } from '@/lib/utils'

const STATUS_CLASS = {
  idle: 'text-fg-subtle',
  working: 'text-accent',
  attention: 'text-accent',
  completed: 'text-ok',
  error: 'text-danger'
} as const

export function TaskTerminalBadge({
  terminal,
  onClick,
  className
}: {
  terminal: LiveTerminalDescriptor
  onClick: () => void
  className?: string
}): JSX.Element {
  const model = terminalTaskBadgeModel(terminal)
  const statusClass = model.status ? STATUS_CLASS[model.status] : 'text-fg-subtle'

  return (
    <button
      type="button"
      className={cn(
        'inline-flex max-w-[48%] shrink-0 items-center gap-1 rounded border border-line-strong bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-fg-muted transition-colors hover:border-accent/60 hover:bg-hover hover:text-fg',
        statusClass,
        className
      )}
      title={model.description}
      aria-label={model.description}
      data-testid="todo-task-terminal-badge"
      data-status={model.status ?? 'terminal'}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Terminal
        className={cn(
          'h-3 w-3 shrink-0',
          model.working && 'animate-pulse motion-reduce:animate-none'
        )}
        aria-hidden="true"
      />
      <span className="truncate">{model.label}</span>
    </button>
  )
}
