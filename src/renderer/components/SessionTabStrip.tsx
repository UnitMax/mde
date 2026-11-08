import { useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'
import { Plus, X } from 'lucide-react'
import type { Session, SessionTab } from '@shared/types'
import { scrollBehavior } from '@/lib/chat-timeline'
import { cn } from '@/lib/utils'
import { sessionTabs } from '@/terminal/tabs'

/** Width of the fade where tabs run off the end of the strip; a tab brought into view clears it. */
const EDGE_FADE_PX = 24

interface Overflow {
  start: boolean
  end: boolean
}

/** Fades the end of the strip that has more tabs beyond it. */
function overflowMask({ start, end }: Overflow): string | undefined {
  if (!start && !end) return undefined
  const from = start ? `transparent, #000 ${EDGE_FADE_PX}px` : '#000, #000'
  const to = end ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent` : '#000, #000'
  return `linear-gradient(to right, ${from}, ${to})`
}

export interface SessionTabStripProps {
  session: Session
  activeTab: SessionTab
  onSelect: (tabId: string) => void
  onAdd: () => void
  onRenameStart: () => void
  onRename: (tabId: string, name: string) => void
  onClose: (tabId: string) => void
}

/**
 * The strip of a session's terminal tabs above its panes. A tab is a quiet pill; the one being shown
 * is lifted off the bar. Closing a tab is
 * offered only while the pointer or focus is on it (and always on the tab being shown), in a slot the
 * tab keeps for it, so that no tab changes width as the pointer crosses the strip. When there are more
 * tabs than fit they scroll sideways (wheel included) under a fade, and the tab being shown is kept in
 * view.
 */
export function SessionTabStrip({
  session,
  activeTab,
  onSelect,
  onAdd,
  onRenameStart,
  onRename,
  onClose
}: SessionTabStripProps): JSX.Element {
  const tabs = sessionTabs(session)
  const closable = tabs.length > 1
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [overflow, setOverflow] = useState<Overflow>({ start: false, end: false })
  const shown = useRef<Overflow>({ start: false, end: false })
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingTabId) return
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renamingTabId])

  // Which ends have more tabs beyond them. Renaming and adding change the content without changing the
  // strip's own size, so this is read after every render as well as on scrolling and resizing.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = (): void => {
      const start = list.scrollLeft > 1
      const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1
      // Only a change is reported: this runs after every render, and updating state that is already right
      // keeps React rendering again for as long as the strip is being laid out.
      if (shown.current.start !== start || shown.current.end !== end) {
        shown.current = { start, end }
        setOverflow({ start, end })
      }
    }
    measure()
    list.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(list)
    return () => {
      list.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  })

  // The tab being shown stays in view, clear of the fade: a new tab at the far end, or one picked from elsewhere.
  useLayoutEffect(() => {
    const list = listRef.current
    const tab = selectedRef.current
    if (!list || !tab) return
    const left = tab.offsetLeft - EDGE_FADE_PX
    const right = tab.offsetLeft + tab.offsetWidth + EDGE_FADE_PX
    const target = left < list.scrollLeft
      ? Math.max(0, left)
      : right > list.scrollLeft + list.clientWidth
        ? right - list.clientWidth
        : list.scrollLeft
    if (Math.abs(target - list.scrollLeft) >= 1) list.scrollTo({ left: target, behavior: scrollBehavior() })
  }, [activeTab.id, tabs.length])

  const beginRename = (tab: SessionTab): void => {
    onRenameStart()
    setRenamingTabId(tab.id)
    setDraftName(tab.name)
  }

  const commitRename = (): void => {
    if (!renamingTabId) return
    const name = draftName.trim()
    if (name) onRename(renamingTabId, name)
    setRenamingTabId(null)
  }

  // A mouse wheel turns the strip sideways; a trackpad's own sideways swipe is left to the browser.
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const list = listRef.current
    if (!list || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    list.scrollLeft += event.deltaY
  }

  const mask = overflowMask(overflow)

  return (
    <div className="fancy-glass flex h-9 shrink-0 items-center gap-1 border-b border-line bg-panel px-2" data-testid="session-tab-strip">
      <div
        ref={listRef}
        role="tablist"
        aria-label={`${session.name} terminal tabs`}
        onWheel={onWheel}
        data-overflow={overflow.start && overflow.end ? 'both' : overflow.start ? 'start' : overflow.end ? 'end' : 'none'}
        className="relative flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeTab.id
          const renaming = tab.id === renamingTabId
          return (
            <div
              key={tab.id}
              ref={selected ? selectedRef : undefined}
              data-selected={selected ? 'true' : 'false'}
              className={cn(
                'group relative flex h-7 min-w-[7.5rem] max-w-[12rem] items-center rounded-md transition-colors',
                // The ring goes round the whole tab (inside it, so the list does not clip it), not just its name.
                'has-[[role=tab]:focus-visible]:outline-2 has-[[role=tab]:focus-visible]:-outline-offset-2 has-[[role=tab]:focus-visible]:outline-accent',
                selected
                  ? 'bg-elevated text-fg ring-1 ring-inset ring-line-strong'
                  : 'text-fg-muted hover:bg-hover hover:text-fg active:bg-active'
              )}
            >
              {renaming ? (
                <input
                  ref={renameInputRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') setRenamingTabId(null)
                    event.stopPropagation()
                  }}
                  aria-label={`Rename ${tab.name}`}
                  data-testid="session-tab-rename-input"
                  className="mx-1 h-5 w-full min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1.5 text-xs text-fg outline-none"
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-testid={`session-tab-${tab.id}`}
                  onClick={() => onSelect(tab.id)}
                  onMouseDown={(event) => {
                    if (event.detail > 1) event.preventDefault()
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!selected) onSelect(tab.id)
                    beginRename(tab)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'F2') {
                      event.preventDefault()
                      beginRename(tab)
                    }
                  }}
                  className={cn('h-full min-w-0 flex-1 truncate rounded-md pl-3 text-left text-xs focus-visible:outline-none', !closable && 'pr-3')}
                  title={`${tab.name} · Double-click or press F2 to rename`}
                >
                  {tab.name}
                </button>
              )}
              {closable && (
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  title={`Close ${tab.name}`}
                  data-testid={`session-tab-close-${tab.id}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(tab.id)
                  }}
                  className={cn(
                    'mx-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-[opacity,background-color,color]',
                    'hover:bg-active hover:text-fg focus-visible:opacity-100',
                    selected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                  )}
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onAdd}
        title="New terminal tab"
        aria-label="New terminal tab"
        data-testid="session-tab-add"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-active"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
