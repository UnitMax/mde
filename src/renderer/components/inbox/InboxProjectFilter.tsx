import { ChevronDown, Layers, X } from 'lucide-react'
import type { InboxFolder } from '@shared/types'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { InboxProjectSummary } from '@/lib/inbox'
import { cn } from '@/lib/utils'

/** The value of the "All projects" row; a project's own value is its folder ID. */
const ALL = ''

function Counts({ threads, unread }: { threads: number; unread: number }): JSX.Element {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {unread > 0 && (
        <span
          data-testid="inbox-project-unread"
          title={unread === 1 ? '1 unread thread' : `${unread} unread threads`}
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-accent-fg"
        >
          {unread}
        </span>
      )}
      <span data-testid="inbox-project-count" className="min-w-3 text-right text-[11px] tabular-nums text-fg-subtle">
        {threads > 0 ? threads : ''}
      </span>
    </span>
  )
}

/**
 * Narrows the Inbox to one project, from a field under the search box that looks like it: "All projects" until one
 * is picked, then that project's picture and name with an X to go back. The menu lists every project with its
 * threads (parked ones left out) and how many of them are unread, as the Inbox tab does for all of them.
 */
export function InboxProjectFilter({
  summaries,
  selected,
  total,
  unread,
  onChange,
}: {
  summaries: readonly InboxProjectSummary[]
  /** The project the Inbox is narrowed to. */
  selected: InboxFolder | null
  /** Threads in the Inbox across all projects, and the unread ones among them. */
  total: number
  unread: number
  onChange: (projectId: string | null) => void
}): JSX.Element {
  return (
    <div className="relative px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="inbox-project-filter"
            data-active={selected ? true : undefined}
            aria-label={selected ? `Project: ${selected.name}` : 'Filter by project'}
            title={selected ? selected.directory : 'Filter by project'}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded border pl-2 text-xs outline-none transition-colors',
              'focus-visible:border-accent data-[state=open]:border-accent',
              selected
                ? 'border-accent/50 bg-accent/10 pr-12 text-fg hover:border-accent/70'
                : 'border-line-strong bg-bg pr-2 text-fg-muted hover:bg-hover hover:text-fg'
            )}
          >
            {selected ? (
              <ProjectIcon icon={selected.icon} size="md" testId="inbox-project-filter-icon" />
            ) : (
              <Layers aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            )}
            <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.name : 'All projects'}</span>
            <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle', selected && 'absolute right-3.5')} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          // As wide as the field, and never taller than the room below it; a long list scrolls.
          className="max-h-[min(22rem,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={selected?.id ?? ALL} onValueChange={(value) => onChange(value === ALL ? null : value)}>
            <DropdownMenuRadioItem value={ALL} data-testid="inbox-project-option-all">
              <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-subtle" />
              <span className="min-w-0 truncate">All projects</span>
              <Counts threads={total} unread={unread} />
            </DropdownMenuRadioItem>
            {summaries.length > 0 && <DropdownMenuSeparator />}
            {summaries.map(({ project, threads, unread: projectUnread }) => (
              <DropdownMenuRadioItem
                key={project.id}
                value={project.id}
                title={project.directory}
                data-testid={`inbox-project-option-${project.id}`}
              >
                <ProjectIcon icon={project.icon} size="md" testId={`inbox-project-option-icon-${project.id}`} className="text-fg-muted" />
                <span className="min-w-0 truncate">{project.name}</span>
                <Counts threads={threads} unread={projectUnread} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected && (
        <button
          type="button"
          data-testid="inbox-project-filter-clear"
          aria-label="Show all projects"
          title="Show all projects"
          onClick={() => onChange(null)}
          className="absolute right-8 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
