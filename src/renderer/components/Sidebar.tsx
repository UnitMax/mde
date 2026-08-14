import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  FolderOpen,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Project, PtyStatus } from '@shared/types'
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useProjects } from '@/store/projects'

const STATUS_STYLE: Record<PtyStatus, { dot: string; label: string }> = {
  none: { dot: 'bg-fg-subtle', label: 'No shell running' },
  running: { dot: 'bg-ok', label: 'Shell running' },
  exited: { dot: 'bg-danger', label: 'Shell exited' }
}

function StatusDot({ status }: { status: PtyStatus }): JSX.Element {
  const style = STATUS_STYLE[status]
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} title={style.label} />
}

interface ProjectRowProps {
  project: Project
  status: PtyStatus
  selected: boolean
  onSelect: () => void
}

function ProjectRow({ project, status, selected, onSelect }: ProjectRowProps): JSX.Element {
  const renameProject = useProjects((state) => state.renameProject)
  const removeProject = useProjects((state) => state.removeProject)
  const revealProject = useProjects((state) => state.revealProject)

  const rowRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== project.name) void renameProject(project.id, name)
    else setDraftName(project.name)
  }

  // Lets the hover "…" button open the very same menu as a right-click.
  const openMenuFromButton = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    rowRef.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left,
        clientY: rect.bottom
      })
    )
  }

  const subtitle = project.kind === 'wsl' ? (project.distro ?? 'WSL') : 'Local'

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={rowRef}
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect()
              }
            }}
            className={cn(
              'group flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left',
              selected ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
            )}
          >
            <StatusDot status={status} />

            <div className="min-w-0 flex-1">
              {renaming ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') {
                      setDraftName(project.name)
                      setRenaming(false)
                    }
                    event.stopPropagation()
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="h-5 w-full rounded-sm border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
                />
              ) : (
                <div className="truncate text-[13px] leading-tight">{project.name}</div>
              )}
              <div className="truncate text-[11px] leading-tight text-fg-subtle" title={project.path}>
                {subtitle}
              </div>
            </div>

            <button
              type="button"
              onClick={openMenuFromButton}
              title="Project actions"
              className={cn(
                'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity',
                'hover:bg-elevated hover:text-fg focus:opacity-100 group-hover:opacity-100'
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>

        {/* Radix would pull focus back to the row on close, stealing it from
            the rename input and from the remove confirmation. */}
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem
            onSelect={() => {
              setDraftName(project.name)
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void revealProject(project.id)}>
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal in file manager
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The project is removed from mde and its terminal session is killed. Nothing on disk is
            deleted.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeProject(project.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SidebarProps {
  onNewProject: () => void
}

export function Sidebar({ onNewProject }: SidebarProps): JSX.Element {
  const projects = useProjects((state) => state.projects)
  const statuses = useProjects((state) => state.statuses)
  const selectedId = useProjects((state) => state.selectedId)
  const select = useProjects((state) => state.select)
  const collapsed = useProjects((state) => state.sidebarCollapsed)
  const toggleSidebar = useProjects((state) => state.toggleSidebar)

  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-panel py-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Expand sidebar">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-2 flex w-full flex-col items-center gap-1 overflow-y-auto">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => select(project.id)}
              title={`${project.name} — ${project.kind === 'wsl' ? (project.distro ?? 'WSL') : 'Local'}`}
              className={cn(
                'relative flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase',
                project.id === selectedId
                  ? 'bg-active text-fg'
                  : 'text-fg-muted hover:bg-hover hover:text-fg'
              )}
            >
              {project.name.slice(0, 2)}
              <span
                className={cn(
                  'absolute -bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel',
                  STATUS_STYLE[statuses[project.id] ?? 'none'].dot
                )}
              />
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="mt-auto" onClick={onNewProject} title="New project">
          <Plus className="h-4 w-4" />
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[13px] font-semibold tracking-tight text-fg">mde</span>
        <span className="text-[11px] text-fg-subtle">agentic dev environment</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={toggleSidebar}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        Projects
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-fg-subtle">No projects yet.</p>
        ) : (
          projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              status={statuses[project.id] ?? 'none'}
              selected={project.id === selectedId}
              onSelect={() => select(project.id)}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <Button variant="secondary" size="sm" className="w-full" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
          New project
        </Button>
      </div>
    </aside>
  )
}
