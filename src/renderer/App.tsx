import { useEffect, useMemo, useRef, useState } from 'react'
import { PictureInPicture2, Plus, Settings2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddSessionDialog } from '@/components/AddSessionDialog'
import { MiniInboxWindow } from '@/components/MiniInboxWindow'
import { FileTreePanel } from '@/components/FileTreePanel'
import { FileViewer } from '@/components/FileViewer'
import { InboxChangeViewer, InboxSidebar } from '@/components/inbox/InboxChanges'
import { NewTodoProjectDialog } from '@/components/NewTodoProjectDialog'
import { Sidebar } from '@/components/Sidebar'
import { SessionSwitcher } from '@/components/SessionSwitcher'
import { TerminalView } from '@/components/TerminalView'
import { TitleBar, TitleBarButton } from '@/components/TitleBar'
import { TodoProjectView } from '@/components/TodoProjectView'
import { InboxThreadView } from '@/components/InboxThreadView'
import { useInboxLock } from '@/components/InboxPanel'
import { inboxFileRoot } from '@/lib/inbox'
import { SettingsDialog } from '@/components/SettingsDialog'
import { OpenCodeConfigDialog } from '@/components/inbox/OpenCodeConfigDialog'
import { TodoSearch } from '@/components/TodoSearch'
import { TodoProjectSettingsDialog } from '@/components/TodoProjectSettingsDialog'
import { TodoTaskDialog } from '@/components/TodoTaskDialog'
import { isSessionSwitcherShortcut } from '@/lib/session-switcher'
import { isTodoSearchShortcut } from '@/lib/todo-search'
import { useWorkspace } from '@/store/workspace'
import { focusTerminalWhenReady } from '@/terminal/focus'
import { disposeRuntimeTerminal } from '@/terminal/dispose'
import {
  layoutReordered,
  layoutResized,
  layoutTitled
} from '@/terminal/layout-edits'
import {
  activeSessionTab,
  splitRuntimePane,
  createRuntimeLayout,
  persistRuntimeLayout,
  sessionTabs,
  terminalIdForPane
} from '@/terminal/tabs'
import {
  removeTerminalPane,
  terminalFocusTargetAfterRemoval,
  type SessionTerminalLayout,
  type TerminalSplitSide,
} from '@/terminal/layout'
import type { PersistedTerminalLayout, Session, TodoTask } from '@shared/types'
import type { TerminalDirectoryRequest } from '@shared/ipc'
import { fileRootKey } from '@/lib/file-root'
import { useInboxChat } from '@/store/inbox-chat'
import { useInboxTerminal } from '@/store/inbox-terminal'

type RuntimeLayouts = Record<string, Record<string, SessionTerminalLayout>>

function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Terminal className="h-6 w-6 text-fg-subtle" />
      <div>
        <p className="text-[13px] text-fg-muted">No session selected</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Pick a session in the sidebar, or create one to group your terminals.
        </p>
      </div>
      <Button size="sm" onClick={onNewSession}>
        <Plus className="h-3.5 w-3.5" />
        New session
      </Button>
    </div>
  )
}

export function App(): JSX.Element {
  const init = useWorkspace((state) => state.init)
  const ready = useWorkspace((state) => state.ready)
  const sessions = useWorkspace((state) => state.sessions)
  const todoProjects = useWorkspace((state) => state.todoProjects)
  const todoTasks = useWorkspace((state) => state.todoTasks)
  const windowMode = useWorkspace((state) => state.windowMode)
  const setWindowMode = useWorkspace((state) => state.setWindowMode)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const openFiles = useWorkspace((state) => state.openFiles)
  const openFileAction = useWorkspace((state) => state.openFile)
  const openSettings = useWorkspace((state) => state.openSettings)
  const opencodeConfigOpen = useWorkspace((state) => state.opencodeConfigDialog.open)
  const closeFileAction = useWorkspace((state) => state.closeFile)
  const selectedTodoProjectId = useWorkspace((state) => state.selectedTodoProjectId)
  const activeWorkspaceView = useWorkspace((state) => state.activeWorkspaceView)
  const selectSession = useWorkspace((state) => state.selectSession)
  const addTabAction = useWorkspace((state) => state.addTab)
  const selectTabAction = useWorkspace((state) => state.selectTab)
  const renameTabAction = useWorkspace((state) => state.renameTab)
  const updateTabLayoutAction = useWorkspace((state) => state.updateTabLayout)
  const removeTabAction = useWorkspace((state) => state.removeTab)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newTodoProjectOpen, setNewTodoProjectOpen] = useState(false)
  const [todoProjectSettingsOpen, setTodoProjectSettingsOpen] = useState(false)
  const [todoTaskDialogOpen, setTodoTaskDialogOpen] = useState(false)
  const [todoTaskDialogTaskId, setTodoTaskDialogTaskId] = useState<string | null>(null)
  const [todoTaskDialogColumnId, setTodoTaskDialogColumnId] = useState<string | null>(null)
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [todoSearchOpen, setTodoSearchOpen] = useState(false)
  const [terminalLayouts, setTerminalLayouts] = useState<RuntimeLayouts>({})
  const [pendingTerminalFocus, setPendingTerminalFocus] = useState<{
    sessionId: string
    tabId: string
    terminalId: string
  } | null>(null)
  const terminalFocusRequestId = useRef(0)
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null)
  const focusedTerminalIdRef = useRef<string | null>(null)
  const terminalLayoutsRef = useRef<RuntimeLayouts>({})
  const sessionsRef = useRef(sessions)
  const pendingLayoutPersistence = useRef<Record<string, PersistedTerminalLayout>>({})
  const layoutPersistenceTimers = useRef<Record<string, number>>({})

  useEffect(() => {
    terminalLayoutsRef.current = terminalLayouts
  }, [terminalLayouts])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => useInboxChat.getState().init(), [])
  useEffect(() => useInboxTerminal.getState().init(), [])

  useEffect(() => {
    void init()
  }, [init])

  const flushLayoutPersistence = (key: string): void => {
    const layout = pendingLayoutPersistence.current[key]
    if (!layout) return
    delete pendingLayoutPersistence.current[key]
    const timer = layoutPersistenceTimers.current[key]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete layoutPersistenceTimers.current[key]
    }
    const separator = key.indexOf('|')
    if (separator < 0) return
    const sessionId = key.slice(0, separator)
    const tabId = key.slice(separator + 1)
    void updateTabLayoutAction(sessionId, tabId, layout)
  }

  const queueLayoutPersistence = (
    sessionId: string,
    tabId: string,
    layout: SessionTerminalLayout,
    immediate = false
  ): void => {
    const key = `${sessionId}|${tabId}`
    pendingLayoutPersistence.current[key] = persistRuntimeLayout(layout)
    if (immediate) {
      flushLayoutPersistence(key)
      return
    }

    const currentTimer = layoutPersistenceTimers.current[key]
    if (currentTimer !== undefined) window.clearTimeout(currentTimer)
    layoutPersistenceTimers.current[key] = window.setTimeout(() => {
      flushLayoutPersistence(key)
    }, 180)
  }

  useEffect(() => {
    return () => {
      Object.keys(pendingLayoutPersistence.current).forEach(flushLayoutPersistence)
    }
  }, [])

  const setRuntimeLayout = (
    sessionId: string,
    tabId: string,
    layout: SessionTerminalLayout
  ): void => {
    const next: RuntimeLayouts = {
      ...terminalLayoutsRef.current,
      [sessionId]: {
        ...(terminalLayoutsRef.current[sessionId] ?? {}),
        [tabId]: layout
      }
    }
    terminalLayoutsRef.current = next
    setTerminalLayouts(next)
  }

  const layoutForTab = (session: Session, tabId: string): SessionTerminalLayout => {
    const tab = sessionTabs(session).find((candidate) => candidate.id === tabId) ?? activeSessionTab(session)
    return terminalLayoutsRef.current[session.id]?.[tabId] ?? createRuntimeLayout(session.id, tab)
  }

  const focusTerminalAfterPaneRemoval = (
    sessionId: string,
    tabId: string,
    previous: SessionTerminalLayout,
    removedTerminalIds: string[],
    next: SessionTerminalLayout
  ): void => {
    const terminalId = terminalFocusTargetAfterRemoval(
      previous.panes,
      removedTerminalIds,
      focusedTerminalIdRef.current
    )
    if (!terminalId || !next.panes.some((pane) => pane.terminalId === terminalId)) return

    const current = useWorkspace.getState()
    const session = current.sessions.find((candidate) => candidate.id === sessionId)
    if (
      current.activeWorkspaceView !== 'sessions' ||
      current.selectedSessionId !== sessionId ||
      !session ||
      activeSessionTab(session).id !== tabId
    ) {
      return
    }

    focusedTerminalIdRef.current = terminalId
    setFocusedTerminalId(terminalId)
    terminalFocusRequestId.current += 1
    setPendingTerminalFocus({ sessionId, tabId, terminalId })
  }

  useEffect(() => {
    const activeSessionIds = new Set(sessions.map((session) => session.id))
    const next: RuntimeLayouts = {}

    Object.entries(terminalLayoutsRef.current).forEach(([sessionId, layouts]) => {
      if (activeSessionIds.has(sessionId)) return
      Object.values(layouts).forEach((layout) => {
        layout.panes.forEach((pane) => disposeRuntimeTerminal(pane.terminalId))
      })
    })

    sessions.forEach((session) => {
      const existing = terminalLayoutsRef.current[session.id] ?? {}
      const validTabIds = new Set(sessionTabs(session).map((tab) => tab.id))
      Object.entries(existing).forEach(([tabId, layout]) => {
        if (!validTabIds.has(tabId)) {
          layout.panes.forEach((pane) => disposeRuntimeTerminal(pane.terminalId))
        }
      })
      next[session.id] = {}
      sessionTabs(session).forEach((tab) => {
        next[session.id]![tab.id] = existing[tab.id] ?? createRuntimeLayout(session.id, tab)
      })
    })

    terminalLayoutsRef.current = next
    setTerminalLayouts(next)
  }, [sessions])

  useEffect(() => {
    const unsubscribe = window.api.pty.onExit((info) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === info.sessionId)
      if (!session) return
      const layouts = terminalLayoutsRef.current[session.id]
      const tabId = Object.entries(layouts ?? {}).find(([, layout]) =>
        layout.panes.some((pane) => pane.terminalId === info.terminalId)
      )?.[0]
      if (!tabId) return
      const layout = layouts?.[tabId]
      if (!layout) return
      const pane = layout.panes.find((candidate) => candidate.terminalId === info.terminalId)
      if (!pane) return

      if (layout.panes.length === 1) {
        setRuntimeLayout(session.id, tabId, {
          ...layout,
          panes: layout.panes.map((candidate) =>
            candidate.terminalId === info.terminalId ? { ...candidate, exited: true } : candidate
          )
        })
        return
      }

      const next = removeTerminalPane(layout, info.terminalId)
      if (!next) return
      disposeRuntimeTerminal(info.terminalId)
      setRuntimeLayout(session.id, tabId, next)
      queueLayoutPersistence(session.id, tabId, next, true)
      focusTerminalAfterPaneRemoval(session.id, tabId, layout, [info.terminalId], next)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!pendingTerminalFocus) return
    const selected = sessionsRef.current.find((session) => session.id === pendingTerminalFocus.sessionId)
    if (
      !selected ||
      selectedSessionId !== pendingTerminalFocus.sessionId ||
      activeSessionTab(selected).id !== pendingTerminalFocus.tabId
    ) {
      return
    }

    return focusTerminalWhenReady(pendingTerminalFocus.terminalId, {
      done: () => setPendingTerminalFocus(null)
    })
  }, [pendingTerminalFocus, selectedSessionId, sessions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isSessionSwitcherShortcut(event) ||
        sessionSwitcherOpen ||
        todoSearchOpen ||
        newSessionOpen ||
        newTodoProjectOpen ||
        todoProjectSettingsOpen ||
        todoTaskDialogOpen ||
        opencodeConfigOpen
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSessionSwitcherOpen(true)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    newSessionOpen,
    newTodoProjectOpen,
    opencodeConfigOpen,
    sessionSwitcherOpen,
    todoProjectSettingsOpen,
    todoSearchOpen,
    todoTaskDialogOpen
  ])

  const todoSearchAvailable = activeWorkspaceView === 'todo' && selectedTodoProjectId !== null
  useEffect(() => {
    if (!todoSearchAvailable) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isTodoSearchShortcut(event) ||
        todoSearchOpen ||
        sessionSwitcherOpen ||
        newSessionOpen ||
        newTodoProjectOpen ||
        todoProjectSettingsOpen ||
        todoTaskDialogOpen ||
        opencodeConfigOpen
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setTodoSearchOpen(true)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    newSessionOpen,
    newTodoProjectOpen,
    opencodeConfigOpen,
    sessionSwitcherOpen,
    todoProjectSettingsOpen,
    todoSearchAvailable,
    todoSearchOpen,
    todoTaskDialogOpen
  ])

  const selected = sessions.find((session) => session.id === selectedSessionId) ?? null
  const selectedTodoProject =
    todoProjects.find((project) => project.id === selectedTodoProjectId) ?? null
  const selectedTodoTasks = selectedTodoProject
    ? todoTasks.filter((task) => task.todoProjectId === selectedTodoProject.id)
    : []
  const selectedTodoTask =
    todoTasks.find((task) => task.id === todoTaskDialogTaskId) ?? null
  const activeTab = selected ? activeSessionTab(selected) : null

  const openNewSession = (): void => {
    setNewSessionOpen(true)
  }

  const openNewTodoTask = (columnId?: string): void => {
    if (!selectedTodoProject) return
    const defaultColumnId = columnId ?? selectedTodoProject.columns[0]?.id
    if (!defaultColumnId) return
    setTodoTaskDialogTaskId(null)
    setTodoTaskDialogColumnId(defaultColumnId)
    setTodoTaskDialogOpen(true)
  }

  const openTodoTask = (task: TodoTask): void => {
    setTodoTaskDialogTaskId(task.id)
    setTodoTaskDialogColumnId(task.columnId)
    setTodoTaskDialogOpen(true)
  }

  useEffect(() => {
    setTodoSearchOpen(false)
    setTodoTaskDialogOpen(false)
    setTodoTaskDialogTaskId(null)
    setTodoTaskDialogColumnId(null)
  }, [selectedTodoProjectId])

  const cancelTerminalFocus = (): void => {
    terminalFocusRequestId.current += 1
    setPendingTerminalFocus(null)
  }

  const focusTerminal = (
    sessionId: string,
    tabId: string,
    terminalId: string
  ): void => {
    terminalFocusRequestId.current += 1
    focusedTerminalIdRef.current = terminalId
    setFocusedTerminalId(terminalId)
    selectSession(sessionId)
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session && activeSessionTab(session).id !== tabId) void selectTabAction(sessionId, tabId)
    setPendingTerminalFocus({
      sessionId,
      tabId,
      terminalId,
    })
  }

  const selectTab = (sessionId: string, tabId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || !sessionTabs(session).some((tab) => tab.id === tabId)) return
    const focusRequestId = ++terminalFocusRequestId.current
    void selectTabAction(sessionId, tabId).then((updated) => {
      if (!updated || terminalFocusRequestId.current !== focusRequestId) return
      const tab = activeSessionTab(updated)
      const pane = tab.layout.panes[0]
      if (pane) {
        setPendingTerminalFocus({
          sessionId,
          tabId: tab.id,
          terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
        })
      }
    })
  }

  const addTab = (sessionId: string): void => {
    const focusRequestId = ++terminalFocusRequestId.current
    void addTabAction(sessionId).then((updated) => {
      if (!updated || terminalFocusRequestId.current !== focusRequestId) return
      const tab = activeSessionTab(updated)
      const pane = tab.layout.panes[0]
      if (pane) {
        setPendingTerminalFocus({
          sessionId,
          tabId: tab.id,
          terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
        })
      }
    })
  }

  const renameTab = (sessionId: string, tabId: string, name: string): void => {
    void renameTabAction(sessionId, tabId, name)
  }

  const renameTerminalPane = (
    sessionId: string,
    tabId: string,
    terminalId: string,
    title: string | null
  ): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return

    const next = layoutTitled(layoutForTab(session, tabId), terminalId, title)
    if (!next) return

    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const closeTab = (sessionId: string, tabId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || sessionTabs(session).length <= 1) return
    const focusRequestId = ++terminalFocusRequestId.current
    void removeTabAction(sessionId, tabId).then((updated) => {
      if (!updated) return
      terminalLayoutsRef.current[sessionId]?.[tabId]?.panes.forEach((pane) => {
        disposeRuntimeTerminal(pane.terminalId)
      })
      if (
        updated.id === selectedSessionId &&
        terminalFocusRequestId.current === focusRequestId
      ) {
        const tab = activeSessionTab(updated)
        const pane = tab.layout.panes[0]
        if (pane) {
          setPendingTerminalFocus({
            sessionId,
            tabId: tab.id,
            terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
          })
        }
      }
    })
  }

  const splitTerminalPane = (sessionId: string, tabId: string, terminalId: string, side: TerminalSplitSide): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const next = splitRuntimePane(sessionId, tabId, existing, terminalId, side)
    if (!next) return
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
    const added = next.panes.find((pane) => !existing.panes.includes(pane))
    if (added) setPendingTerminalFocus({ sessionId, tabId, terminalId: added.terminalId })
  }

  const closeTerminalPane = (sessionId: string, tabId: string, terminalId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const next = removeTerminalPane(existing, terminalId)
    if (!next) return
    disposeRuntimeTerminal(terminalId)
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
    focusTerminalAfterPaneRemoval(sessionId, tabId, existing, [terminalId], next)
  }

  const resizeTerminalLayout = (
    sessionId: string,
    tabId: string,
    splitId: string,
    ratio: number
  ): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const next = layoutResized(layoutForTab(session, tabId), splitId, ratio)
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next)
  }

  const reorderTerminalPanes = (sessionId: string, tabId: string, terminalIds: readonly string[]): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const next = layoutReordered(layoutForTab(session, tabId), terminalIds)
    if (!next) return
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  // The Inbox shows the files of the open thread's folder, or of the folder the new thread starts in.
  const inboxLock = useInboxLock()
  const inboxThreads = useWorkspace((state) => state.inboxThreads)
  const selectedInboxThreadId = useWorkspace((state) => state.selectedInboxThreadId)
  const inboxFolders = useInboxChat((state) => state.folders)
  const inboxComposerFolderId = useInboxChat((state) => state.composer.folderId)
  const inboxRoot = useMemo(() => {
    if (activeWorkspaceView !== 'inbox' || inboxLock) return null
    const thread = inboxThreads.find((item) => item.id === selectedInboxThreadId)
    if (thread) return inboxFileRoot(thread)
    const folder = inboxFolders.find((item) => item.id === inboxComposerFolderId) ?? inboxFolders[0]
    return folder ? inboxFileRoot(folder) : null
  }, [activeWorkspaceView, inboxLock, inboxThreads, selectedInboxThreadId, inboxFolders, inboxComposerFolderId])
  const inboxOpenFilePath = inboxRoot ? openFiles[inboxRoot.id] : undefined

  const closeOpenFile = (sessionId: string, rootId = sessionId): void => {
    closeFileAction(rootId)
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    // Hand focus back to the terminal the viewer covered.
    const tabId = activeSessionTab(session).id
    const { panes } = layoutForTab(session, tabId)
    const terminalId = panes.some((pane) => pane.terminalId === focusedTerminalIdRef.current)
      ? focusedTerminalIdRef.current
      : panes[0]?.terminalId
    if (!terminalId) return
    terminalFocusRequestId.current += 1
    setPendingTerminalFocus({ sessionId, tabId, terminalId })
  }

  const layoutForSession = selected && activeTab
    ? layoutForTab(selected, activeTab.id)
    : undefined
  const activeTerminalId = layoutForSession?.panes.find((pane) => pane.terminalId === focusedTerminalId)?.terminalId
    ?? layoutForSession?.panes[0]?.terminalId
  const terminalDirectory = useWorkspace((state) => activeTerminalId ? state.terminalDirectories[activeTerminalId] : undefined)
  const terminalFileRoot = useMemo<TerminalDirectoryRequest | null>(
    () => selected && activeTerminalId && terminalDirectory
      ? { terminalId: activeTerminalId, directory: terminalDirectory }
      : null,
    [activeTerminalId, terminalDirectory, selected?.id]
  )
  const terminalFileRootId = terminalFileRoot ? fileRootKey(terminalFileRoot) : null
  const openFilePath = terminalFileRootId ? openFiles[terminalFileRootId] : undefined
  const terminalLayoutsForSidebar = terminalLayouts

  // The main process has already shrunk the window. Terminals are not mounted here,
  // so nothing resizes their PTYs; they stay alive and reattach when restored.
  if (windowMode === 'mini') {
    return (
      <MiniInboxWindow
        threads={inboxThreads}
        folders={inboxFolders}
        onRestore={() => void setWindowMode('normal')}
        onOpenThread={(threadId) => {
          void setWindowMode('normal').then(() => {
            if (useWorkspace.getState().inboxThreads.some((thread) => thread.id === threadId)) {
              useWorkspace.getState().selectInboxThread(threadId)
            }
          })
        }}
      />
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      <TitleBar
        icon={<Terminal className="h-3.5 w-3.5 shrink-0 text-accent" />}
        title="mde"
      >
        <TitleBarButton
          data-testid="mini-window-open"
          onClick={() => void setWindowMode('mini')}
          title="Mini Inbox window (F12)"
          aria-label="Open the mini Inbox window"
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton
          data-testid="settings-open"
          onClick={() => openSettings()}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </TitleBarButton>
      </TitleBar>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          onNewTodoProject={() => setNewTodoProjectOpen(true)}
          onNewTodoTask={() => openNewTodoTask()}
          onNewSession={openNewSession}
          terminalLayouts={terminalLayoutsForSidebar}
          onFocusTerminal={focusTerminal}
        />

        <main className="relative h-full min-w-0 flex-1">
          {!ready ? null : activeWorkspaceView === 'inbox' ? (
            <>
              <InboxThreadView />
              {selectedInboxThreadId && <InboxChangeViewer threadId={selectedInboxThreadId} />}
              {inboxRoot && inboxOpenFilePath !== undefined && (
                <FileViewer
                  key={`viewer:${inboxRoot.id}`}
                  session={inboxRoot}
                  path={inboxOpenFilePath}
                  onOpenFile={(path) => openFileAction(inboxRoot.id, path)}
                  onClose={() => closeFileAction(inboxRoot.id)}
                />
              )}
            </>
          ) : activeWorkspaceView === 'todo' ? (
            <TodoProjectView
              project={selectedTodoProject}
              tasks={selectedTodoTasks}
              onNewTask={openNewTodoTask}
              onEditTask={openTodoTask}
              onOpenSettings={() => setTodoProjectSettingsOpen(true)}
            />
          ) : selected && activeTab && layoutForSession ? (
            <>
              <TerminalView
                key={selected.id}
                session={selected}
                activeTab={activeTab}
                terminalLayout={layoutForSession}
                onSelectTab={(tabId) => selectTab(selected.id, tabId)}
                onAddTab={() => addTab(selected.id)}
                onTabRenameStart={cancelTerminalFocus}
                onRenameTab={(tabId, name) => renameTab(selected.id, tabId, name)}
                onCloseTab={(tabId) => closeTab(selected.id, tabId)}
                onSplitPane={(terminalId, side) => splitTerminalPane(selected.id, activeTab.id, terminalId, side)}
                onLayoutResize={(splitId, ratio) => resizeTerminalLayout(selected.id, activeTab.id, splitId, ratio)}
                onPaneOrderChange={(terminalIds) => reorderTerminalPanes(selected.id, activeTab.id, terminalIds)}
                onClosePane={(terminalId) => closeTerminalPane(selected.id, activeTab.id, terminalId)}
                onPaneFocus={(terminalId) => {
                  focusedTerminalIdRef.current = terminalId
                  setFocusedTerminalId(terminalId)
                }}
                onPaneTitleChange={(terminalId, title) =>
                  renameTerminalPane(selected.id, activeTab.id, terminalId, title)
                }
              />
              {openFilePath !== undefined && terminalFileRoot && terminalFileRootId && (
                // Layered over the terminals so they stay mounted at their size. Its key must differ
                // from the terminal view's: siblings that share one leave the previous session's
                // terminals mounted after a switch.
                <FileViewer
                  key={`viewer:${terminalFileRootId}`}
                  session={selected}
                  root={terminalFileRoot}
                  path={openFilePath}
                  onOpenFile={(path) => openFileAction(terminalFileRootId, path)}
                  onClose={() => closeOpenFile(selected.id, terminalFileRootId)}
                />
              )}
            </>
          ) : (
            <EmptyState onNewSession={() => openNewSession()} />
          )}
        </main>

        {ready && activeWorkspaceView === 'sessions' && selected && <FileTreePanel session={selected} root={terminalFileRoot} />}
        {ready && inboxRoot && <InboxSidebar session={inboxRoot} threadId={selectedInboxThreadId ?? undefined} />}

        <SettingsDialog terminalIds={layoutForSession?.panes.map((pane) => pane.terminalId) ?? []} />
        <OpenCodeConfigDialog />

        <AddSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
        />
        <NewTodoProjectDialog
          open={newTodoProjectOpen}
          onOpenChange={setNewTodoProjectOpen}
        />
        {selectedTodoProject && (
          <>
            <TodoProjectSettingsDialog
              project={selectedTodoProject}
              open={todoProjectSettingsOpen}
              onOpenChange={setTodoProjectSettingsOpen}
            />
            <TodoTaskDialog
              project={selectedTodoProject}
              task={selectedTodoTask}
              defaultColumnId={
                todoTaskDialogColumnId ?? selectedTodoProject.columns[0]?.id ?? 'todo'
              }
              open={todoTaskDialogOpen}
              onOpenChange={setTodoTaskDialogOpen}
            />
            <TodoSearch
              open={todoSearchOpen && activeWorkspaceView === 'todo'}
              onOpenChange={setTodoSearchOpen}
              project={selectedTodoProject}
              tasks={selectedTodoTasks}
              onSelectTask={openTodoTask}
            />
          </>
        )}
        <SessionSwitcher open={sessionSwitcherOpen} onOpenChange={setSessionSwitcherOpen} />
      </div>
    </div>
  )
}
