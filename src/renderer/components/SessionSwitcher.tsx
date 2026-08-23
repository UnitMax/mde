import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { PtyStatus } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { searchSessions, type SessionSearchMatch } from '@/lib/session-switcher'
import { useWorkspace } from '@/store/workspace'

interface SessionSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function HighlightedText({ value, positions }: { value: string; positions?: number[] }): JSX.Element {
  const matched = new Set(positions ?? [])
  return (
    <>
      {value.split('').map((character, index) => (
        <span key={`${character}-${index}`} className={matched.has(index) ? 'text-accent' : undefined}>
          {character}
        </span>
      ))}
    </>
  )
}

function SessionStatus({ status }: { status: PtyStatus }): JSX.Element {
  const style: Record<PtyStatus, { dot: string; label: string }> = {
    none: { dot: 'bg-fg-subtle', label: 'No shell running' },
    running: { dot: 'bg-ok', label: 'Shell running' },
    exited: { dot: 'bg-danger', label: 'Shell exited' }
  }
  const indicator = style[status]
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', indicator.dot)}
      data-status={status}
      aria-label={indicator.label}
      title={indicator.label}
    />
  )
}

function SessionResult({
  result,
  active,
  status,
  id,
  onSelect,
  onHover
}: {
  result: SessionSearchMatch
  active: boolean
  status: PtyStatus
  id: string
  onSelect: () => void
  onHover: () => void
}): JSX.Element {
  const { session, project } = result.item
  const location = session.kind === 'wsl' ? `${session.distro ?? 'WSL'} · ${session.path}` : session.path
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      data-testid="session-switcher-result"
      className={cn(
        'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left transition-colors',
        active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <SessionStatus status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          <HighlightedText value={session.name} positions={result.matches.name} />
        </span>
        <span className="block truncate text-[11px] text-fg-subtle" title={location}>
          {project && <HighlightedText value={project.name} positions={result.matches.project} />}
          {project && ' · '}
          <HighlightedText
            value={location}
            positions={result.matches.path ?? result.matches.distro}
          />
        </span>
      </span>
    </button>
  )
}

export function SessionSwitcher({ open, onOpenChange }: SessionSwitcherProps): JSX.Element {
  const projects = useWorkspace((state) => state.projects)
  const sessions = useWorkspace((state) => state.sessions)
  const statuses = useWorkspace((state) => state.statuses)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectSession = useWorkspace((state) => state.selectSession)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]))
    return sessions.map((session, order) => ({
      session,
      project: projectById.get(session.projectId),
      order
    }))
  }, [projects, sessions])
  const results = useMemo(() => searchSessions(items, query), [items, query])
  const resultKey = results.map((result) => result.item.session.id).join('\0')
  const selectedResultIndex = results.findIndex((result) => result.item.session.id === selectedSessionId)

  useEffect(() => {
    if (!open) return
    setActiveIndex(query.trim() ? 0 : Math.max(0, selectedResultIndex))
  }, [open, query, resultKey, selectedResultIndex])

  const close = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setQuery('')
      setActiveIndex(0)
    }
    onOpenChange(nextOpen)
  }

  const choose = (result: SessionSearchMatch | undefined): void => {
    if (!result) return
    selectSession(result.item.session.id)
    close(false)
  }

  const moveActive = (delta: number): void => {
    if (results.length === 0) return
    setActiveIndex((current) => (current + delta + results.length) % results.length)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-xl p-3"
        animated={false}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader className="mb-2 px-1">
          <DialogTitle className="sr-only">Switch session</DialogTitle>
          <DialogDescription className="sr-only">
            Search workspace sessions and press Enter to switch to the highlighted session.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <Input
            ref={inputRef}
            autoFocus
            data-testid="session-switcher-input"
            aria-label="Search sessions"
            aria-controls="session-switcher-results"
            aria-activedescendant={results[activeIndex] ? `session-switcher-${results[activeIndex].item.session.id}` : undefined}
            placeholder="Search sessions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveActive(1)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveActive(-1)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(results[activeIndex])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close(false)
              }
            }}
            className="h-10 pl-9 pr-10 text-sm"
          />
          <kbd className="pointer-events-none absolute right-3 top-3 rounded border border-line-strong px-1.5 text-[10px] leading-4 text-fg-subtle">
            Esc
          </kbd>
        </div>

        <div
          id="session-switcher-results"
          role="listbox"
          aria-label="Workspace sessions"
          className="mt-2 max-h-[min(65vh,24rem)] overflow-y-auto"
        >
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-fg-subtle">
              {sessions.length === 0 ? 'No sessions yet.' : 'No matching sessions.'}
            </p>
          ) : (
            results.map((result, index) => (
              <div key={result.item.session.id}>
                <SessionResult
                  result={result}
                  active={index === activeIndex}
                  status={statuses[result.item.session.id] ?? 'none'}
                  id={`session-switcher-${result.item.session.id}`}
                  onSelect={() => choose(result)}
                  onHover={() => setActiveIndex(index)}
                />
              </div>
            ))
          )}
        </div>
        <p className="mt-2 px-1 text-[10px] text-fg-subtle">
          ↑↓ to navigate · Enter to switch · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  )
}
