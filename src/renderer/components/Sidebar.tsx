import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  ChevronRight,
  Check,
  Copy,
  GripVertical,
  ListTodo,
  MoreHorizontal,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  Pencil,
  Plus,
  RotateCcw,
  Smile,
  Trash2
} from 'lucide-react'
import type {
  Session,
  TodoProject
} from '@shared/types'
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import {
  useWorkspace,
  type WorkspaceView
} from '@/store/workspace'
import {
  DEFAULT_SESSION_COLOR,
  SESSION_COLORS,
  sessionColorHex
} from '@shared/session-colors'
import { SESSION_ICONS, sessionIconOption } from '@shared/session-icons'
import { InboxPanel } from '@/components/InboxPanel'

function customSessionColor(color: Session['color']): Session['color'] {
  return color && color !== DEFAULT_SESSION_COLOR ? color : undefined
}

function sessionBackgroundStyle(color: Session['color']): { backgroundColor: string } | undefined {
  const customColor = customSessionColor(color)
  return customColor ? { backgroundColor: sessionColorHex(customColor) } : undefined
}

function sessionEnvironmentLabel(session: Session): string {
  return session.kind === 'wsl' ? `WSL · ${session.distro ?? 'Distribution unavailable'}` : 'Native'
}

function SessionEnvironment({ session }: { session: Session }): JSX.Element {
  const Icon = session.kind === 'wsl' ? Terminal : Monitor
  return (
    <div
      data-testid="session-environment"
      className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-fg-subtle"
      title={sessionEnvironmentLabel(session)}
    >
      <span className="inline-flex shrink-0 items-center gap-1 rounded border border-line-strong bg-bg/30 px-1 py-0.5 text-[10px] font-medium text-fg-muted">
        <Icon className="h-2.5 w-2.5" aria-hidden="true" />
        {session.kind === 'wsl' ? 'WSL' : 'Native'}
      </span>
      {session.kind === 'wsl' && <span className="min-w-0 truncate">{session.distro ?? 'Distribution unavailable'}</span>}
    </div>
  )
}

interface SessionRowProps {
  session: Session
  selected: boolean
  onSelect: () => void
  dragging: boolean
  dragDisabled: boolean
  dropPosition: 'before' | 'after' | null
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
}

function SessionRow({
  session,
  selected,
  onSelect,
  dragging,
  dragDisabled,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: SessionRowProps): JSX.Element {
  const renameSession = useWorkspace((state) => state.renameSession)
  const duplicateSession = useWorkspace((state) => state.duplicateSession)
  const setSessionColor = useWorkspace((state) => state.setSessionColor)
  const removeSession = useWorkspace((state) => state.removeSession)

  const rowRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(session.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const startRename = (): void => {
    setDraftName(session.name)
    setRenaming(true)
  }

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

  const sessionColor = session.color ?? DEFAULT_SESSION_COLOR
  const customColor = customSessionColor(session.color)
  const backgroundStyle = sessionBackgroundStyle(session.color)
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
            onDragOver={onDragOver}
            onDrop={onDrop}
            onKeyDown={(event) => {
              if (event.key === 'F2' && event.target === event.currentTarget) {
                event.preventDefault()
                startRename()
                return
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect()
              }
            }}
            className={cn(
              'group relative flex w-full cursor-default items-center gap-2 rounded-md py-2 pl-4 pr-2 text-left',
              customColor
                ? 'text-fg transition-[filter] hover:brightness-110'
                : selected
                  ? 'bg-active text-fg'
                  : 'text-fg-muted hover:bg-hover hover:text-fg',
              dragging && 'opacity-60',
              dropPosition === 'before' && 'border-t-2 border-accent',
              dropPosition === 'after' && 'border-b-2 border-accent'
            )}
            style={backgroundStyle}
          >
            <button
              type="button"
              draggable={!dragDisabled}
              disabled={dragDisabled}
              aria-label={`Drag to reorder ${session.name}`}
              title="Drag to reorder"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', session.id)
                onDragStart()
              }}
              onDragEnd={(event) => {
                event.stopPropagation()
                onDragEnd()
              }}
              className={cn(
                'absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded text-fg-subtle opacity-0 transition-opacity',
                'pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100',
                'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                'focus:pointer-events-auto focus:opacity-100 hover:text-fg',
                dragging && 'pointer-events-auto opacity-100',
                dragDisabled
                  ? 'pointer-events-none cursor-default opacity-50'
                  : 'cursor-grab active:cursor-grabbing'
              )}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
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
                <div data-testid="session-name" className="truncate text-[13px] font-medium leading-tight">
                  {session.name}
                </div>
              )}
              <SessionEnvironment session={session} />
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
            onSelect={startRename}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void duplicateSession(session.id)}>
            <Copy className="h-3.5 w-3.5" />
            Duplicate session
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              {/* The same 14px box as the icons of the items above, so the labels line up. */}
              <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <span
                  className="h-3 w-3 rounded-full border border-fg/20"
                  style={{ backgroundColor: sessionColorHex(sessionColor) }}
                />
              </span>
              <span className="flex-1">Session color</span>
              <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" />
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {SESSION_COLORS.map((option) => (
                <ContextMenuItem
                  key={option.id}
                  onSelect={() => void setSessionColor(session.id, option.id)}
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full border border-fg/20"
                    style={{ backgroundColor: option.hex }}
                  />
                  <span className="flex-1">{option.label}</span>
                  {sessionColor === option.id && <Check className="h-3.5 w-3.5" />}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove session
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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

interface SessionDropTarget {
  sessionId: string
  position: 'before' | 'after'
}

interface SessionListProps {
  sessions: Session[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}

function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
}: SessionListProps): JSX.Element {
  const reorderSession = useWorkspace((state) => state.reorderSession)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<SessionDropTarget | null>(null)
  const [reordering, setReordering] = useState(false)

  const resetDragState = (): void => {
    setDraggingSessionId(null)
    setDropTarget(null)
  }

  const handleDragStart = (sessionId: string): void => {
    if (reordering) return
    setDraggingSessionId(sessionId)
    setDropTarget(null)
  }

  const handleDragEnd = (): void => {
    resetDragState()
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, sessionId: string): void => {
    if (!draggingSessionId || reordering || sessionId === draggingSessionId) {
      if (sessionId === draggingSessionId) setDropTarget(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((current) =>
      current?.sessionId === sessionId && current.position === position
        ? current
        : { sessionId, position }
    )
  }

  const commitDrop = async (
    sourceId: string,
    targetId: string,
    position: 'before' | 'after'
  ): Promise<void> => {
    const source = sessions.find((session) => session.id === sourceId)
    const remaining = sessions.filter((session) => session.id !== sourceId)
    const targetIndex = remaining.findIndex((session) => session.id === targetId)
    if (!source || targetIndex < 0) {
      resetDragState()
      return
    }

    const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1
    const beforeId = remaining[insertionIndex]?.id ?? null
    const nextOrder = [...remaining]
    nextOrder.splice(insertionIndex, 0, source)
    if (nextOrder.every((session, index) => session.id === sessions[index]?.id)) {
      resetDragState()
      return
    }

    setReordering(true)
    resetDragState()
    try {
      await reorderSession(sourceId, beforeId)
    } finally {
      setReordering(false)
    }
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string): void => {
    event.preventDefault()
    if (reordering) {
      resetDragState()
      return
    }

    const sourceId = draggingSessionId ?? event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) {
      resetDragState()
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    void commitDrop(sourceId, targetId, position)
  }

  return (
    <div className="space-y-1">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          selected={session.id === selectedSessionId}
          onSelect={() => onSelectSession(session.id)}
          dragging={session.id === draggingSessionId}
          dragDisabled={reordering}
          dropPosition={
            dropTarget?.sessionId === session.id ? dropTarget.position : null
          }
          onDragStart={() => handleDragStart(session.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(event) => handleDragOver(event, session.id)}
          onDrop={(event) => handleDrop(event, session.id)}
        />
      ))}
    </div>
  )
}

function TodoProjectRow({
  project,
  selected,
  onSelect
}: {
  project: TodoProject
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const renameTodoProject = useWorkspace((state) => state.renameTodoProject)
  const removeTodoProject = useWorkspace((state) => state.removeTodoProject)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useEffect(() => setDraftName(project.name), [project.name])

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== project.name) void renameTodoProject(project.id, name)
    else setDraftName(project.name)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'flex w-full items-center rounded px-2 py-1 text-[13px]',
              selected
                ? 'bg-active text-fg'
                : 'text-fg-muted hover:bg-hover hover:text-fg'
            )}
          >
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
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={onSelect}
              >
                <ListTodo className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{project.name}</span>
              </button>
            )}
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

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the To Do project and all of its tasks. Terminal sessions and files are unaffected.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeTodoProject(project.id)}>
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SidebarCreateActionsProps {
  activeSection: WorkspaceView
  collapsed: boolean
  onNewSession: () => void
  onNewTodoTask: () => void
  todoTaskAvailable: boolean
}

function SidebarCreateActions({
  activeSection,
  collapsed,
  onNewSession,
  onNewTodoTask,
  todoTaskAvailable
}: SidebarCreateActionsProps): JSX.Element {
  if (activeSection === 'todo') {
    return (
      <div title={todoTaskAvailable ? 'New task' : 'Select a To Do project first'}>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!todoTaskAvailable}
          onClick={onNewTodoTask}
          title="New task"
          aria-label="New task"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New task</span>
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="secondary"
      size={collapsed ? 'icon' : 'sm'}
      className={cn(!collapsed && 'w-full')}
      onClick={onNewSession}
      title="New session"
      aria-label="New session"
    >
      <Plus className="h-3.5 w-3.5" />
      {!collapsed && <span>New session</span>}
    </Button>
  )
}

interface SidebarProps {
  onNewTodoProject: () => void
  onNewTodoTask: () => void
  onNewSession: () => void
}

export function Sidebar({
  onNewTodoProject,
  onNewTodoTask,
  onNewSession,
}: SidebarProps): JSX.Element {
  const todoProjects = useWorkspace((state) => state.todoProjects)
  const sessions = useWorkspace((state) => state.sessions)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectedTodoProjectId = useWorkspace((state) => state.selectedTodoProjectId)
  const selectSession = useWorkspace((state) => state.selectSession)
  const selectTodoProject = useWorkspace((state) => state.selectTodoProject)
  const setSessionIcon = useWorkspace((state) => state.setSessionIcon)
  const collapsed = useWorkspace((state) => state.sidebarCollapsed)
  const toggleSidebar = useWorkspace((state) => state.toggleSidebar)
  const activeSection = useWorkspace((state) => state.activeWorkspaceView)

  const sessionList = sessions.length === 0 ? (
    <p className="px-2 py-1 text-xs text-fg-subtle">No sessions yet.</p>
  ) : (
    <SessionList
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      onSelectSession={selectSession}
    />
  )

  if (collapsed && activeSection === 'sessions') {
    return (
      <aside className="fancy-glass flex h-full min-h-0 w-11 shrink-0 flex-col items-center overflow-hidden border-r border-line bg-panel py-2">
        <div className="mt-2 min-h-0 w-full flex-1 overflow-y-auto">
          {activeSection === 'sessions' && (
            <div className="flex flex-col items-center gap-1">
              {sessions.map((session) => {
                const customColor = customSessionColor(session.color)
                return (
                  <ContextMenu key={session.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${session.name} · ${sessionEnvironmentLabel(session)}`}
                        title={`${session.name} · ${sessionEnvironmentLabel(session)}`}
                        onClick={() => selectSession(session.id)}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase',
                          customColor
                            ? 'text-fg transition-[filter] hover:brightness-110'
                            : session.id === selectedSessionId
                              ? 'bg-active text-fg'
                              : 'text-fg-muted hover:bg-hover hover:text-fg'
                        )}
                        style={sessionBackgroundStyle(session.color)}
                      >
                        <span data-testid="collapsed-session-label">
                          {sessionIconOption(session.icon)?.emoji ?? session.name.slice(0, 2)}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Smile className="h-3.5 w-3.5" />
                          <span className="flex-1">Change icon</span>
                          <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" />
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {SESSION_ICONS.map((option) => (
                            <ContextMenuItem
                              key={option.id}
                              onSelect={() => void setSessionIcon(session.id, option.id)}
                            >
                              <span
                                className="w-5 text-center text-base leading-none"
                                role="img"
                                aria-label={option.label}
                              >
                                {option.emoji}
                              </span>
                              <span className="flex-1">{option.label}</span>
                              {session.icon === option.id && <Check className="h-3.5 w-3.5" />}
                            </ContextMenuItem>
                          ))}
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => void setSessionIcon(session.id, null)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span className="flex-1">Use initials</span>
                            {!session.icon && <Check className="h-3.5 w-3.5" />}
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
        <div className="mt-auto flex shrink-0 flex-col items-center gap-1">
          <SidebarCreateActions
            activeSection={activeSection}
            collapsed
            onNewSession={() => onNewSession()}
            onNewTodoTask={onNewTodoTask}
            todoTaskAvailable={selectedTodoProjectId !== null}
          />
          <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Expand sidebar" aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="fancy-glass flex w-[260px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="min-h-0 flex-1 px-2 pb-2 pt-3">
        <div
          id="sidebar-section-sessions"
          className={cn('h-full min-h-0 flex-col', activeSection === 'sessions' ? 'flex' : 'hidden')}
        >
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="sidebar-sessions-scroll">
            {sessionList}
          </div>
        </div>

        <div
          id="sidebar-section-todo"
          className="h-full min-h-0 overflow-y-auto"
          hidden={activeSection !== 'todo'}
        >
          <div className="flex items-center px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-muted">
              To Do projects
            </span>
            <span className="mr-1 text-[11px] text-fg-subtle">{todoProjects.length}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={onNewTodoProject}
              title="New To Do project"
              aria-label="New To Do project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {todoProjects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-subtle">No To Do projects yet.</p>
          ) : (
            todoProjects.map((project) => (
              <TodoProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedTodoProjectId}
                onSelect={() => selectTodoProject(project.id)}
              />
            ))
          )}
        </div>

        <div
          id="sidebar-section-inbox"
          className="h-full min-h-0"
          hidden={activeSection !== 'inbox'}
        >
          {activeSection === 'inbox' && <InboxPanel />}
        </div>
      </div>

      {activeSection !== 'inbox' && <div className="flex shrink-0 items-center gap-1 border-t border-line p-2">
        <div className="min-w-0 flex-1">
          <SidebarCreateActions
            activeSection={activeSection}
            collapsed={false}
            onNewSession={onNewSession}
            onNewTodoTask={onNewTodoTask}
            todoTaskAvailable={selectedTodoProjectId !== null}
          />
        </div>
        {activeSection === 'sessions' && (
          <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} title="Collapse sidebar" aria-label="Collapse sidebar">
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>}
    </aside>
  )
}
