import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { TodoProject, TodoTask } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { HighlightedText } from '@/components/HighlightedText'
import { cn } from '@/lib/utils'
import {
  buildTodoSearchItems,
  listedTodoMatches,
  searchTodoTasks,
  todoDescriptionSnippet,
  type TodoSearchMatch
} from '@/lib/todo-search'

interface TodoSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: TodoProject
  tasks: TodoTask[]
  onSelectTask: (task: TodoTask) => void
}

function TodoSearchResult({
  result,
  active,
  id,
  onSelect,
  onHover
}: {
  result: TodoSearchMatch
  active: boolean
  id: string
  onSelect: () => void
  onHover: () => void
}): JSX.Element {
  const { task, identifier, columnName } = result.item
  const snippet = result.matches.description
    ? todoDescriptionSnippet(result.matches.description)
    : null
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      data-testid="todo-search-result"
      className={cn(
        'flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors',
        active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <span className="mt-0.5 shrink-0 font-mono text-[10px] leading-4 text-fg-subtle">
        <HighlightedText value={identifier} positions={result.matches.identifier} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          <HighlightedText value={task.title} positions={result.matches.title} />
        </span>
        <span className="block truncate text-[11px] text-fg-subtle">
          {snippet ? (
            <HighlightedText value={snippet.text} positions={snippet.positions} />
          ) : (
            columnName
          )}
        </span>
      </span>
      {snippet && (
        <span className="mt-0.5 shrink-0 text-[10px] leading-4 text-fg-subtle">{columnName}</span>
      )}
    </button>
  )
}

export function TodoSearch({
  open,
  onOpenChange,
  project,
  tasks,
  onSelectTask
}: TodoSearchProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // Done tasks are left out until "Include done" in the footer is ticked; it is unticked again the next time the search opens.
  const [includeDone, setIncludeDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => buildTodoSearchItems(project, tasks), [project, tasks])
  const matches = useMemo(() => searchTodoTasks(items, query), [items, query])
  const results = useMemo(() => listedTodoMatches(matches, includeDone), [matches, includeDone])
  const hiddenDone = matches.length - results.length
  const resultKey = results.map((result) => result.item.task.id).join('\0')

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
  }, [open, query, resultKey])

  const activeId = results[activeIndex]?.item.task.id
  useEffect(() => {
    if (!open || !activeId) return
    document.getElementById(`todo-search-${activeId}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeId])

  const close = (nextOpen: boolean): void => {
    if (!nextOpen) {
      setQuery('')
      setActiveIndex(0)
      setIncludeDone(false)
    }
    onOpenChange(nextOpen)
  }

  const choose = (result: TodoSearchMatch | undefined): void => {
    if (!result) return
    close(false)
    onSelectTask(result.item.task)
  }

  const moveActive = (delta: number): void => {
    if (results.length === 0) return
    setActiveIndex((current) => (current + delta + results.length) % results.length)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-xl p-3"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader className="mb-2 px-1">
          <DialogTitle className="sr-only">Search tasks</DialogTitle>
          <DialogDescription className="sr-only">
            Search the tasks of {project.name} and press Enter to open the highlighted task.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <Input
            ref={inputRef}
            autoFocus
            data-testid="todo-search-input"
            aria-label="Search tasks"
            aria-controls="todo-search-results"
            aria-activedescendant={results[activeIndex] ? `todo-search-${results[activeIndex].item.task.id}` : undefined}
            placeholder={`Search tasks in ${project.name}`}
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
          id="todo-search-results"
          role="listbox"
          aria-label="Tasks"
          className="mt-2 max-h-[min(65vh,24rem)] overflow-y-auto"
        >
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-fg-subtle">
              {items.length === 0
                ? 'No tasks yet.'
                : hiddenDone === 0
                  ? 'No matching tasks.'
                  : query.trim()
                    ? `No matching open tasks. ${hiddenDone} done ${hiddenDone === 1 ? 'task matches' : 'tasks match'}.`
                    : 'No open tasks.'}
            </p>
          ) : (
            results.map((result, index) => (
              <TodoSearchResult
                key={result.item.task.id}
                result={result}
                active={index === activeIndex}
                id={`todo-search-${result.item.task.id}`}
                onSelect={() => choose(result)}
                onHover={() => setActiveIndex(index)}
              />
            ))
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10px] text-fg-subtle">
          <span>↑↓ to navigate · Enter to open · Esc to close</span>
          <button
            type="button"
            role="checkbox"
            aria-checked={includeDone}
            data-testid="todo-search-done"
            title="Also search tasks in the Done column"
            onClick={() => {
              setIncludeDone((current) => !current)
              inputRef.current?.focus()
            }}
            className={cn(
              '-my-0.5 -mr-1 flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              includeDone && 'text-fg-muted'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-3 w-3 items-center justify-center rounded-sm border',
                includeDone ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong'
              )}
            >
              {includeDone && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </span>
            Include done
            {hiddenDone > 0 && <span data-testid="todo-search-hidden">({hiddenDone})</span>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
