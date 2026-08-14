import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Project, PtyStatus, Session } from '@shared/types'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const STATUS_STYLE: Record<PtyStatus, { dot: string; label: string }> = {
  none: { dot: 'bg-fg-subtle', label: 'No shell running' },
  running: { dot: 'bg-ok', label: 'Shell running' },
  exited: { dot: 'bg-danger', label: 'Shell exited' }
}

function StatusDot({ status }: { status: PtyStatus }): JSX.Element {
  const style = STATUS_STYLE[status]
  return (
    <span
      data-testid="session-status"
      data-status={status}
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)}
      title={style.label}
    />
  )
}

interface SessionRowProps {
  session: Session
  status: PtyStatus
  selected: boolean
  onSelect: () => void
}

function SessionRow({ session, status, selected, onSelect }: SessionRowProps): JSX.Element {
  const renameSession = useWorkspace((state) => state.renameSession)
  const moveSession = useWorkspace((state) => state.moveSession)
  const removeSession = useWorkspace((state) => state.removeSession)
  const revealSession = useWorkspace((state) => state.revealSession)
  const projects = useWorkspace((state) => state.projects)

  const rowRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(session.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [moving, setMoving] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState(session.projectId)

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== session.name) void renameSession(session.id, name)
    else setDraftName(session.name)
  }

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

  const move = async (): Promise<void> => {
    if (!targetProjectId || targetProjectId === session.projectId) {
      setMoving(false)
      return
    }
    await moveSession(session.id, targetProjectId)
    setMoving(false)
  }

  const location = session.kind === 'wsl' ? `${session.distro ?? 'WSL'} · ${session.path}` : session.path

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={rowRef}
            role="button"
            tabIndex={0}
            data-testid="session-row"
            onClick={onSelect}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect()
              }
            }}
            className={cn(
              'group ml-3 flex w-[calc(100%-0.75rem)] cursor-default items-center gap-2 rounded px-2 py-1.5 text-left',
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
                      setDraftName(session.name)
                      setRenaming(false)
                    }
                    event.stopPropagation()
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="h-5 w-full rounded-sm border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
                />
              ) : (
                <div data-testid="session-name" className="truncate text-[13px] leading-tight">
                  {session.name}
                </div>
              )}
              <div className="truncate text-[11px] leading-tight text-fg-subtle" title={location}>
                {location}
              </div>
            </div>

            <button
              type="button"
              onClick={openMenuFromButton}
              title="Session actions"
              className={cn(
                'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity',
                'hover:bg-elevated hover:text-fg focus:opacity-100 group-hover:opacity-100'
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem
            onSelect={() => {
              setDraftName(session.name)
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void revealSession(session.id)}>
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal in file manager
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setTargetProjectId(session.projectId)
              setMoving(true)
            }}
          >
            <Folder className="h-3.5 w-3.5" />
            Move to project
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove session
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move session</DialogTitle>
            <DialogDescription>Choose the project label for “{session.name}”.</DialogDescription>
          </DialogHeader>
          <Select value={targetProjectId} onValueChange={setTargetProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={targetProjectId === session.projectId}
              onClick={() => void move()}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{session.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The session and its terminal process are removed from mde. Nothing on disk is deleted.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeSession(session.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface ProjectGroupProps {
  project: Project
  sessions: Session[]
  statuses: Record<string, PtyStatus>
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: (projectId: string) => void
}

function ProjectGroup({
  project,
  sessions,
  statuses,
  selectedSessionId,
  onSelectSession,
  onNewSession
}: ProjectGroupProps): JSX.Element {
  const renameProject = useWorkspace((state) => state.renameProject)
  const removeProject = useWorkspace((state) => state.removeProject)
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== project.name) void renameProject(project.id, name)
    else setDraftName(project.name)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group flex w-full items-center gap-1 rounded px-2 py-1 text-left text-fg-muted hover:bg-hover hover:text-fg">
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
                className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => setCollapsed((value) => !value)}
                title={collapsed ? 'Expand project' : 'Collapse project'}
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[13px] font-medium">{project.name}</span>
                <span className="text-[11px] text-fg-subtle">{sessions.length}</span>
              </button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0 opacity-0 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onNewSession(project.id)
              }}
              title="New session in this project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem
            onSelect={() => {
              setDraftName(project.name)
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename project
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove project
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {!collapsed &&
        sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            status={statuses[session.id] ?? 'none'}
            selected={session.id === selectedSessionId}
            onSelect={() => onSelectSession(session.id)}
          />
        ))}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the project label, all of its sessions, and their terminal processes.
            Nothing on disk is deleted.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeProject(project.id)}>
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SidebarProps {
  onNewProject: () => void
  onNewSession: (projectId?: string) => void
}

export function Sidebar({ onNewProject, onNewSession }: SidebarProps): JSX.Element {
  const projects = useWorkspace((state) => state.projects)
  const sessions = useWorkspace((state) => state.sessions)
  const statuses = useWorkspace((state) => state.statuses)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectSession = useWorkspace((state) => state.selectSession)
  const collapsed = useWorkspace((state) => state.sidebarCollapsed)
  const toggleSidebar = useWorkspace((state) => state.toggleSidebar)

  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-panel py-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Expand sidebar">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-2 flex w-full flex-col items-center gap-1 overflow-y-auto">
          {projects.map((project) => {
            const projectSessions = sessions.filter((session) => session.projectId === project.id)
            return projectSessions.length > 0 ? (
              projectSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => selectSession(session.id)}
                  title={`${project.name} · ${session.name}`}
                  className={cn(
                    'relative flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase',
                    session.id === selectedSessionId
                      ? 'bg-active text-fg'
                      : 'text-fg-muted hover:bg-hover hover:text-fg'
                  )}
                >
                  {session.name.slice(0, 2)}
                  <span
                    className={cn(
                      'absolute -bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel',
                      STATUS_STYLE[statuses[session.id] ?? 'none'].dot
                    )}
                  />
                </button>
              ))
            ) : (
              <button
                key={project.id}
                type="button"
                onClick={() => onNewSession(project.id)}
                title={`${project.name} · New session`}
                className="flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase text-fg-muted hover:bg-hover hover:text-fg"
              >
                {project.name.slice(0, 2)}
              </button>
            )
          })}
        </div>
        <div className="mt-auto flex flex-col gap-1">
          <Button variant="ghost" size="icon" onClick={() => onNewSession()} title="New session">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNewProject} title="New project">
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
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

      <div className="flex items-center px-3 pb-1 pt-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onNewProject}
          title="New project"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-fg-subtle">No projects yet.</p>
        ) : (
          projects.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              sessions={sessions.filter((session) => session.projectId === project.id)}
              statuses={statuses}
              selectedSessionId={selectedSessionId}
              onSelectSession={selectSession}
              onNewSession={(projectId) => onNewSession(projectId)}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => onNewSession()}>
          <Plus className="h-3.5 w-3.5" />
          New session
        </Button>
      </div>
    </aside>
  )
}
