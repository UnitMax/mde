import { useEffect, useMemo, useRef, useState } from 'react'
import { History, RefreshCw, Search } from 'lucide-react'
import type { OpenCodeResumeLaunch, OpenCodeSessionSummary, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { groupOpenCodeSessions, isCurrentSessionDirectory, sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { agentCommandSettingError } from '@/lib/agent-commands'
import { getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'
import { MAX_TERMINAL_COUNT } from '@/terminal/layout'

interface OpenCodeSessionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: Session
  sourceTerminalId: string
  currentDirectory?: string
  paneCount: number
  onSelect: (launch: OpenCodeResumeLaunch) => void
  onRestoreFocus: () => void
}

function MetadataDetails({ session }: { session: OpenCodeSessionSummary }): JSX.Element {
  const tokens = session.tokens
  return (
    <div className="shrink-0 space-y-1 border-t border-line px-2 pt-2 text-[11px] text-fg-muted" data-testid="opencode-session-details">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {session.model && <span>{session.model.providerId}/{session.model.id}{session.model.variant ? ` · ${session.model.variant}` : ''}</span>}
        {session.agent && <span>{session.agent}</span>}
        {session.changes && <span>{[
          session.changes.files === undefined ? null : `${session.changes.files} files`,
          session.changes.additions === undefined ? null : `+${session.changes.additions}`,
          session.changes.deletions === undefined ? null : `−${session.changes.deletions}`,
        ].filter(Boolean).join(' · ')}</span>}
        {session.parentId && <span>Subagent</span>}
        {session.archivedAt !== undefined && <span>Archived {sessionDate(session.archivedAt)}</span>}
      </div>
      <p>Created {sessionDate(session.createdAt)} · Updated {sessionDate(session.updatedAt)}</p>
      {tokens && (
        <p>
          {[
            ['Input', tokens.input], ['Output', tokens.output], ['Reasoning', tokens.reasoning],
            ['Cache read', tokens.cacheRead], ['Cache write', tokens.cacheWrite]
          ].filter(([, value]) => value !== undefined).map(([label, value]) => `${label}: ${value?.toLocaleString()}`).join(' · ')}
        </p>
      )}
      {session.cost !== undefined && <p>Reported cost: ${session.cost.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>}
      <p className="truncate font-mono text-[10px] text-fg-subtle" title={session.id}>{session.id}</p>
    </div>
  )
}

export function OpenCodeSessionsDialog({
  open, onOpenChange, session, sourceTerminalId, currentDirectory, paneCount, onSelect, onRestoreFocus
}: OpenCodeSessionsDialogProps): JSX.Element {
  const [settings, setSettings] = useState(() => getTerminalSettings())
  const [sessions, setSessions] = useState<OpenCodeSessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef(onRestoreFocus)
  const resumingRef = useRef(false)
  restoreFocusRef.current = onRestoreFocus
  const executable = settings.agents.opencode.executable.trim()
  const settingError = agentCommandSettingError({ executable, args: '' })
  const full = paneCount >= MAX_TERMINAL_COUNT
  const directory = currentDirectory ?? session.path
  const groups = useMemo(() => groupOpenCodeSessions(sessions, query, directory), [sessions, query, directory])
  const results = useMemo(() => groups.flatMap((group) => group.sessions), [groups])
  const selected = results[Math.min(activeIndex, Math.max(0, results.length - 1))]
  const canSelect = !full && !loading && !error && !settingError

  useEffect(() => subscribeTerminalSettings(() => setSettings(getTerminalSettings())), [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    resumingRef.current = false
  }, [open, session.id, sourceTerminalId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSessions([])
    setError(null)
    setLoading(true)
    if (settingError) {
      setError(settingError)
      setLoading(false)
      return
    }
    void window.api.opencodeSessions.list({ sessionId: session.id, sourceTerminalId, executable })
      .then((next) => {
        if (cancelled) return
        setSessions(next)
        setActiveIndex(0)
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(ipcErrorMessage(error, 'Could not read OpenCode session history.'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, session.id, sourceTerminalId, executable, settingError, refresh])

  useEffect(() => {
    if (!open || !selected) return
    resultsRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(selected.id)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [open, selected?.id])

  const choose = (item: OpenCodeSessionSummary | undefined): void => {
    if (!item || !canSelect) return
    resumingRef.current = true
    onSelect({ sourceTerminalId, opencodeSessionId: item.id, executable })
  }

  const move = (delta: number): void => {
    if (!results.length) return
    setActiveIndex((current) => (current + delta + results.length) % results.length)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-3rem)] max-w-4xl flex-col gap-2 p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!resumingRef.current) restoreFocusRef.current()
        }}
        onKeyDown={(event) => {
          if (event.isPropagationStopped() || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Enter' && event.target === inputRef.current) {
            event.preventDefault()
            choose(selected)
          }
        }}
      >
        <DialogHeader className="mb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />OpenCode sessions</DialogTitle>
          <DialogDescription>All directories in {session.distro} · Ctrl+Shift+O</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-fg-subtle" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              placeholder="Search sessions, directories, models…"
              aria-label="Search OpenCode sessions"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="opencode-session-results"
              aria-activedescendant={selected ? `opencode-result-${selected.id}` : undefined}
              className="pl-9"
            />
          </div>
          <Button size="icon-sm" variant="ghost" disabled={loading} onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh OpenCode sessions" title="Refresh sessions">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {full && <p role="status" className="text-xs text-fg-muted">This tab is full. No more terminals can be opened.</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex shrink-0 justify-between px-2 text-[10px] text-fg-subtle" aria-hidden="true">
          <span>Sessions <span className="tabular-nums">{results.length}</span></span>
          <span>Updated</span>
        </div>
        <div ref={resultsRef} id="opencode-session-results" role="listbox" aria-label="OpenCode sessions by directory" aria-busy={loading} className="min-h-0 max-h-[min(55vh,32rem)] overflow-y-auto">
          {loading ? <p role="status" className="py-8 text-center text-xs text-fg-subtle">Loading session history…</p>
            : !error && groups.length === 0 ? <p className="py-8 text-center text-xs text-fg-subtle">{sessions.length ? 'No matching sessions.' : 'No OpenCode sessions yet.'}</p>
              : groups.map((group) => (
                <div key={group.directory} role="group" aria-label={group.directory || 'Unknown directory'} className="pb-2">
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-elevated px-2 py-1 text-[11px] text-fg-muted">
                    <span className="min-w-0 truncate font-mono font-medium" title={group.directory}>{group.directory || 'Unknown directory'}</span>
                    <span className="shrink-0 tabular-nums text-fg-subtle">{group.sessions.length}</span>
                    {isCurrentSessionDirectory(group.directory, directory) && <span className="shrink-0 text-[10px] text-accent">Current directory</span>}
                  </div>
                  {group.sessions.map((item) => (
                    <button
                      key={item.id}
                      id={`opencode-result-${item.id}`}
                      data-session-id={item.id}
                      role="option"
                      aria-selected={selected?.id === item.id}
                      aria-disabled={!canSelect}
                      tabIndex={-1}
                      type="button"
                      className={`flex h-6 w-full items-center gap-2 rounded px-2 text-left text-fg ${selected?.id === item.id ? 'bg-active' : 'hover:bg-hover'}`}
                      onMouseEnter={() => setActiveIndex(results.findIndex((candidate) => candidate.id === item.id))}
                      onClick={() => choose(item)}
                    >
                      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full border ${selected?.id === item.id ? 'border-accent bg-accent' : 'border-fg-subtle'}`} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.title}>{item.title}</span>
                      <span className="hidden min-w-0 max-w-[30%] items-center gap-2 truncate text-[10px] text-fg-subtle sm:flex">
                        {item.model && <span className="truncate" title={`${item.model.providerId}/${item.model.id}`}>{item.model.id}</span>}
                        {item.agent && <span className="shrink-0">{item.agent}</span>}
                      </span>
                      {item.parentId && <span className="shrink-0 text-[10px] text-fg-subtle">Subagent</span>}
                      {item.archivedAt !== undefined && <span className="shrink-0 text-[10px] text-fg-subtle">Archived</span>}
                      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-fg-muted" title={`Updated ${sessionDate(item.updatedAt)}`}>{sessionAge(item.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ))}
        </div>
        {selected && <MetadataDetails session={selected} />}
        <p className="text-[10px] text-fg-subtle">
          {full ? '↑↓ to browse · Esc to close' : '↑↓ to navigate · Enter to open in a new terminal · Esc to close'}
        </p>
      </DialogContent>
    </Dialog>
  )
}
