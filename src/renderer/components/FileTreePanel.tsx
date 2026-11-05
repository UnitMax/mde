import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ChevronRight,
  Code,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw
} from 'lucide-react'
import { FILE_TREE_DROP_TYPE } from '@/terminal/drop'
import type { Session } from '@shared/types'
import type { FileRoot } from '@shared/ipc'
import { fileRootKey } from '@/lib/file-root'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'
import { cn } from '@/lib/utils'
import { ipcErrorMessage } from '@/lib/ipc-error'
import {
  parentPath,
  visibleFileTreeRows,
  type FileTreeDirectoryState,
  type FileTreeEntryRow,
  type FileTreeRow
} from '@/lib/file-tree'

const INDENT_PX = 12
const BASE_PADDING_PX = 8

function rowPadding(depth: number): number {
  return BASE_PADDING_PX + depth * INDENT_PX
}

function EntryIcon({ row }: { row: FileTreeEntryRow }): JSX.Element {
  if (row.kind === 'directory') {
    const Icon = row.expanded ? FolderOpen : Folder
    return <Icon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
  }
  if (row.kind === 'symlink') {
    return <FileSymlink className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
}

function statusText(row: Exclude<FileTreeRow, FileTreeEntryRow>): string {
  if (row.type === 'loading') return 'Loading…'
  if (row.type === 'empty') return 'Empty folder'
  if (row.type === 'truncated') return 'More entries not shown'
  return row.message ?? 'Could not list folder.'
}

function FileTree({
  session,
  root,
  onCollapse,
  browseOnly,
  heading,
  fill
}: {
  session: Session
  root: FileRoot
  onCollapse: () => void
  browseOnly: boolean
  heading?: ReactNode
  fill: boolean
}): JSX.Element {
  const [cache, setCache] = useState<Map<string, FileTreeDirectoryState>>(() => new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const treeRef = useRef<HTMLDivElement>(null)
  const terminalReady = useWorkspace((state) => !root.terminalId || (state.statuses[root.terminalId] ?? 'none') !== 'none')
  const rootId = fileRootKey(root)
  const openFilePath = useWorkspace((state) => state.openFiles[rootId])
  const openFile = useWorkspace((state) => state.openFile)
  const revealSession = useWorkspace((state) => state.revealSession)
  const openSessionInVsCode = useWorkspace((state) => state.openSessionInVsCode)
  const isWindows = useWorkspace((state) => state.platform?.isWindows === true)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  // Main only hands WSL folders to VS Code, matching the terminal header button.
  const canOpenInVsCode = !browseOnly && isWindows && wslAvailable && session.kind === 'wsl' && Boolean(session.distro)

  const load = useCallback(
    async (path: string): Promise<void> => {
      const requestGeneration = generation.current
      setCache((current) => new Map(current).set(path, { status: 'loading' }))
      if (!terminalReady) return
      let next: FileTreeDirectoryState
      try {
        const response = await window.api.files.list({ ...root, path })
        next = { status: 'ready', entries: response.entries, truncated: response.truncated }
      } catch (error) {
        next = { status: 'error', error: ipcErrorMessage(error, 'Could not list folder.') }
      }
      if (generation.current !== requestGeneration) return
      setCache((current) => new Map(current).set(path, next))
    },
    [root, terminalReady]
  )

  const refresh = useCallback((): void => {
    generation.current += 1
    setCache(new Map())
    void load('')
    for (const path of expandedRef.current) void load(path)
  }, [load])

  useEffect(() => {
    void load('')
    return () => {
      generation.current += 1
    }
  }, [load])

  const endDrag = (): void => {
    dragPreviewRef.current?.remove()
    dragPreviewRef.current = null
    setDraggedPath(null)
  }

  useEffect(() => {
    return () => { dragPreviewRef.current?.remove() }
  }, [])

  const rows = useMemo(() => visibleFileTreeRows(cache, expanded), [cache, expanded])
  const entryRows = useMemo(
    () => rows.filter((row): row is FileTreeEntryRow => row.type === 'entry'),
    [rows]
  )
  const tabStopPath =
    entryRows.find((row) => row.path === focusedPath)?.path ?? entryRows[0]?.path ?? null

  const setDirectoryExpanded = (path: string, open: boolean): void => {
    if (open === expanded.has(path)) return
    const next = new Set(expanded)
    if (open) {
      next.add(path)
      const state = cache.get(path)
      if (!state || state.status === 'error') void load(path)
    } else {
      next.delete(path)
    }
    setExpanded(next)
  }

  const focusRow = (path: string): void => {
    setFocusedPath(path)
    const element = treeRef.current?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(path)}"]`
    )
    element?.focus()
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: FileTreeEntryRow): void => {
    const index = entryRows.findIndex((candidate) => candidate.path === row.path)
    const isDirectory = row.kind === 'directory'
    let handled = true

    if (event.key === 'ArrowDown') {
      const next = entryRows[index + 1]
      if (next) focusRow(next.path)
    } else if (event.key === 'ArrowUp') {
      const previous = entryRows[index - 1]
      if (previous) focusRow(previous.path)
    } else if (event.key === 'ArrowRight') {
      if (isDirectory && !row.expanded) setDirectoryExpanded(row.path, true)
      else if (isDirectory) {
        const child = entryRows[index + 1]
        if (child && parentPath(child.path) === row.path) focusRow(child.path)
      }
    } else if (event.key === 'ArrowLeft') {
      if (isDirectory && row.expanded) setDirectoryExpanded(row.path, false)
      else {
        const parent = parentPath(row.path)
        if (parent !== null) focusRow(parent)
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (isDirectory) setDirectoryExpanded(row.path, !row.expanded)
      else openFile(rootId, row.path)
    } else {
      handled = false
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <aside
      data-testid="file-tree-panel"
      className={cn(
        'flex h-full min-h-0 flex-col border-l border-line bg-panel',
        fill ? 'w-full min-w-0' : 'w-[260px] shrink-0'
      )}
    >
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        {heading ?? (
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-muted" title={root.directory ?? session.path}>
            Files
          </span>
        )}
        {canOpenInVsCode && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => void (root.terminalId ? window.api.paths.openTerminalInVsCode(root.terminalId) : openSessionInVsCode(session.id))}
            title="Open folder in VS Code"
            aria-label="Open folder in VS Code"
          >
            <Code className="h-3.5 w-3.5" />
          </Button>
        )}
        {!browseOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => void (root.terminalId ? window.api.paths.revealTerminal(root.terminalId) : revealSession(session.id))}
            title="Open folder in File Explorer"
            aria-label="Open folder in File Explorer"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={refresh}
          title="Refresh files"
          aria-label="Refresh files"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onCollapse}
          title="Collapse files"
          aria-label="Collapse files"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      {root.directory && (
        <div data-testid="terminal-file-root" className="truncate px-3 pb-2 font-mono text-[10px] text-fg-subtle" title={root.directory}>
          {root.directory}
        </div>
      )}
      <div
        ref={treeRef}
        role="tree"
        aria-label={`Files in ${root.directory ?? session.path}`}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 text-[12px]"
      >
        {rows.map((row) => {
          if (row.type !== 'entry') {
            return (
              <div
                key={`${row.type}:${row.path}`}
                role="none"
                className={cn(
                  'truncate py-1 pr-2 text-[11px]',
                  row.type === 'error' ? 'text-danger' : 'text-fg-subtle'
                )}
                style={{ paddingLeft: rowPadding(row.depth) + 16 }}
                title={row.type === 'error' ? row.message : undefined}
              >
                {statusText(row)}
              </div>
            )
          }

          const isDirectory = row.kind === 'directory'
          const isOpen = !isDirectory && row.path === openFilePath
          return (
            <div
              key={row.path}
              role="treeitem"
              data-path={row.path}
              draggable
              aria-level={row.depth + 1}
              aria-expanded={isDirectory ? row.expanded : undefined}
              aria-selected={isDirectory ? undefined : isOpen}
              tabIndex={row.path === tabStopPath ? 0 : -1}
              className={cn(
                'flex cursor-default items-center gap-1 rounded py-[3px] pr-2 text-fg-muted hover:bg-hover hover:text-fg focus:bg-active focus:text-fg focus:outline-none',
                isOpen && 'bg-active text-fg',
                draggedPath === row.path && 'opacity-40'
              )}
              style={{ paddingLeft: rowPadding(row.depth) }}
              title={row.path}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData(FILE_TREE_DROP_TYPE, JSON.stringify({
                  ...root,
                  path: row.path,
                }))
                const preview = document.createElement('div')
                preview.className = 'file-tree-drag-preview'
                preview.style.left = `${event.clientX}px`
                preview.style.top = `${event.clientY}px`
                const icon = event.currentTarget.querySelectorAll('svg')[1]?.cloneNode(true)
                if (icon) preview.append(icon)
                const label = document.createElement('span')
                label.textContent = row.name
                preview.append(label)
                document.body.append(preview)
                dragPreviewRef.current = preview
                event.dataTransfer.setDragImage(preview, 18, 18)
                // Chromium captures the drag image after this event finishes.
                window.setTimeout(() => preview.remove(), 0)
                setDraggedPath(row.path)
              }}
              onDragEnd={endDrag}
              onFocus={() => setFocusedPath(row.path)}
              onClick={() => {
                if (isDirectory) setDirectoryExpanded(row.path, !row.expanded)
                else openFile(rootId, row.path)
              }}
              onKeyDown={(event) => onRowKeyDown(event, row)}
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 shrink-0 text-fg-subtle transition-transform',
                  !isDirectory && 'invisible',
                  row.expanded && 'rotate-90'
                )}
                aria-hidden="true"
              />
              <EntryIcon row={row} />
              <span className="truncate">{row.name}</span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/**
 * Files of a live terminal root or an Inbox folder. `browseOnly` is for Inbox folders:
 * the tree and viewer work, but opening the folder in VS Code or the file manager does not.
 */
export function FileTreePanel({
  session,
  root: requestedRoot,
  browseOnly = false,
  heading,
  fill = false
}: {
  session: Session
  root?: FileRoot
  browseOnly?: boolean
  /** Replaces the "Files" title in the header, for a host that offers other tabs beside the files. */
  heading?: ReactNode
  /** Takes the width of its container instead of its own 260px, for a host whose sidebar can be resized. */
  fill?: boolean
}): JSX.Element {
  const root = useMemo<FileRoot>(
    () => requestedRoot?.terminalId
      ? { terminalId: requestedRoot.terminalId, directory: requestedRoot.directory }
      : { sessionId: session.id },
    [requestedRoot?.terminalId, requestedRoot?.directory, session.id]
  )
  const collapsed = useWorkspace((state) => state.fileTreeCollapsed)
  const toggleFileTree = useWorkspace((state) => state.toggleFileTree)

  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 w-11 shrink-0 flex-col items-center border-l border-line bg-panel py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFileTree}
          title="Expand files"
          aria-label="Expand files"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </aside>
    )
  }

  return <FileTree key={fileRootKey(root)} session={session} root={root} onCollapse={toggleFileTree} browseOnly={browseOnly} heading={heading} fill={fill} />
}
