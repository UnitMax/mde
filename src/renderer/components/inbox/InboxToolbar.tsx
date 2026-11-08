import { useEffect, useRef, type RefObject } from 'react'
import { Layers, ListFilter, PenSquare, Search, X } from 'lucide-react'
import type { InboxFolder } from '@shared/types'
import { InboxProjectsButton } from '@/components/inbox/InboxProjectsButton'
import { InboxSettingsMenu } from '@/components/inbox/InboxSettingsMenu'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { INBOX_FILTERS, type InboxFilter, type InboxProjectSummary } from '@/lib/inbox'
import { cn } from '@/lib/utils'

/** The value of the "All projects" row; a project's own value is its folder ID. */
const ALL = ''

const BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg'

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

/** What a button that narrows the list shows when it does: a small chip with a way back. */
function ActiveFilter({
  testId,
  label,
  clearLabel,
  clearTestId,
  title,
  icon,
  onClear,
}: {
  testId: string
  label: string
  clearLabel: string
  clearTestId?: string
  title?: string
  icon?: JSX.Element
  onClear: () => void
}): JSX.Element {
  return (
    <span
      data-testid={testId}
      title={title}
      className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded border border-accent/50 bg-accent/10 pl-1.5 pr-0.5 text-[11px] text-fg"
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        data-testid={clearTestId}
        aria-label={clearLabel}
        title={clearLabel}
        onClick={onClear}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </span>
  )
}

/**
 * The controls at the top of the Inbox tab: New thread, search and the filters as small buttons, with the projects
 * and the Inbox settings at the other end. Search opens a field under the row, and stays open while it has text;
 * the filter button opens a menu of what to show (all, unread, parked) and which project. A narrowed list is never
 * left unexplained: while a filter is on, its chip sits under the row with an X to take it off.
 */
export function InboxToolbar({
  newThreadActive,
  onNewThread,
  query,
  onQueryChange,
  searchOpen,
  onSearchOpenChange,
  searchRef,
  filter,
  onFilterChange,
  summaries,
  project,
  total,
  unread,
  onProjectChange,
}: {
  /** The new-thread page is the one showing. */
  newThreadActive: boolean
  onNewThread: () => void
  query: string
  onQueryChange: (query: string) => void
  searchOpen: boolean
  onSearchOpenChange: (open: boolean) => void
  searchRef: RefObject<HTMLInputElement>
  filter: InboxFilter
  onFilterChange: (filter: InboxFilter) => void
  summaries: readonly InboxProjectSummary[]
  /** The project the Inbox is narrowed to. */
  project: InboxFolder | null
  /** Threads in the Inbox across all projects, and the unread ones among them. */
  total: number
  unread: number
  onProjectChange: (projectId: string | null) => void
}): JSX.Element {
  const searching = searchOpen || query !== ''
  const narrowed = filter !== 'all' || project !== null
  const filterLabel = INBOX_FILTERS.find((option) => option.id === filter)?.label ?? ''
  // The field takes the caret when it is opened from the button, not when it is there because of what was typed.
  const wasSearching = useRef(searching)
  useEffect(() => {
    if (searching && !wasSearching.current) searchRef.current?.focus()
    wasSearching.current = searching
  }, [searching, searchRef])

  return (
    <>
      <div className="flex items-center gap-0.5 px-1 pt-0.5">
        <button
          type="button"
          data-testid="inbox-new-thread-button"
          aria-label="New thread"
          title="New thread (Ctrl+N)"
          aria-current={newThreadActive || undefined}
          onClick={onNewThread}
          className={cn(BUTTON, newThreadActive && 'bg-active text-fg')}
        >
          <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="inbox-search-button"
          aria-label="Search threads"
          title="Search threads"
          aria-expanded={searching}
          onClick={() => {
            if (searching) {
              onQueryChange('')
              onSearchOpenChange(false)
            } else {
              onSearchOpenChange(true)
            }
          }}
          className={cn(BUTTON, searching && 'bg-active text-fg')}
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="inbox-filter-button"
              data-active={narrowed || undefined}
              aria-label="Filter threads"
              title="Filter threads"
              className={cn(BUTTON, 'relative data-[state=open]:bg-active data-[state=open]:text-fg', narrowed && 'text-accent')}
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
              {narrowed && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            // Never taller than the room below it; a long list of projects scrolls.
            className="max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
          >
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter} onValueChange={(value) => onFilterChange(value as InboxFilter)} aria-label="Inbox filter">
              {INBOX_FILTERS.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} data-testid={`inbox-filter-option-${option.id}`}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {(summaries.length > 1 || project) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Project</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={project?.id ?? ALL} onValueChange={(value) => onProjectChange(value === ALL ? null : value)}>
                  <DropdownMenuRadioItem value={ALL} data-testid="inbox-project-option-all">
                    <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 truncate">All projects</span>
                    <Counts threads={total} unread={unread} />
                  </DropdownMenuRadioItem>
                  {summaries.map(({ project: item, threads, unread: projectUnread }) => (
                    <DropdownMenuRadioItem
                      key={item.id}
                      value={item.id}
                      title={item.directory}
                      data-testid={`inbox-project-option-${item.id}`}
                    >
                      <ProjectIcon icon={item.icon} size="md" testId={`inbox-project-option-icon-${item.id}`} className="text-fg-muted" />
                      <span className="min-w-0 truncate">{item.name}</span>
                      <Counts threads={threads} unread={projectUnread} />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex shrink-0 items-center">
          <InboxProjectsButton />
          <InboxSettingsMenu />
        </div>
      </div>
      {searching && (
        <div className="relative px-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            ref={searchRef}
            aria-label="Search inbox"
            placeholder="Search threads"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              // The first Escape clears what was typed, the next puts the field away.
              if (query) onQueryChange('')
              else onSearchOpenChange(false)
            }}
            className="h-7 pl-7 pr-7 text-xs"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                onQueryChange('')
                searchRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {narrowed && (
        <div data-testid="inbox-active-filters" className="flex min-w-0 flex-wrap items-center gap-1 px-1">
          {filter !== 'all' && (
            <ActiveFilter
              testId="inbox-status-filter"
              label={filterLabel}
              clearLabel="Show all threads"
              onClear={() => onFilterChange('all')}
            />
          )}
          {project && (
            <ActiveFilter
              testId="inbox-project-filter"
              label={project.name}
              title={project.directory}
              clearLabel="Show all projects"
              clearTestId="inbox-project-filter-clear"
              icon={<ProjectIcon icon={project.icon} size="md" testId="inbox-project-filter-icon" />}
              onClear={() => onProjectChange(null)}
            />
          )}
        </div>
      )}
    </>
  )
}
