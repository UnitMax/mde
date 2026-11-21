import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, ArrowLeft, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { ChatMessageView } from '@/components/inbox/ChatMessageView'
import { TurnDuration, WorkingFor } from '@/components/inbox/ChatTurnTime'
import { CompactChatContext } from '@/components/inbox/chat-ui'
import { ChatFileSourceContext } from '@/components/inbox/mcp-context'
import { ThreadListToggle } from '@/components/inbox/ThreadListToggle'
import { useSubagentConversation } from '@/components/inbox/use-subagent-conversation'
import { attachSubagentReports, turnStats } from '@/lib/chat'
import { createFileLookup, type ChatFileSource } from '@/lib/chat-file-links'
import { compactPlans, type RenderBlock } from '@/lib/chat-tools'
import { hoverScrollbar } from '@/lib/hover-scrollbar'
import { optionsKey, useInboxChat } from '@/store/inbox-chat'
import { useInboxView } from '@/store/inbox-view'
import { SubagentOpenContext, useSubagentNav, type SubagentCrumb } from '@/store/subagent-nav'
import { useWorkspace } from '@/store/workspace'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

/** Something on the page takes Escape for itself: a field being typed in, or a dialog or menu that is open. */
function escapeTakenElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return true
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

/**
 * The way back up: the thread, then each subagent opened on the way to this one. Every level but the last is a link
 * back to it.
 */
function SubagentTrail({ thread, trail }: { thread: InboxThread; trail: readonly SubagentCrumb[] }): JSX.Element {
  const goTo = useSubagentNav((state) => state.goTo)
  const back = useSubagentNav((state) => state.back)
  const threadTitle = thread.customTitle ?? thread.title
  const parent = trail.length > 1 ? trail[trail.length - 2]!.label : threadTitle
  return (
    <header className="shrink-0 border-b border-line pl-3 pr-5" data-testid="subagent-view-header">
      <div className="flex h-11 min-w-0 items-center gap-2">
        <ThreadListToggle className="-mr-0.5" />
        <button
          type="button"
          onClick={() => back(thread.id)}
          title={`Back to ${parent} (Esc)`}
          aria-label={`Back to ${parent}`}
          data-testid="subagent-view-back"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
        </button>
        <nav aria-label="Subagent trail" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => goTo(thread.id, 0)}
            className="min-w-0 max-w-[16rem] shrink truncate rounded px-1 text-fg-muted transition-colors hover:text-fg"
            data-testid="subagent-trail-thread"
          >
            {threadTitle}
          </button>
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1
            const text = crumb.title ? `${crumb.label}: ${crumb.title}` : crumb.label
            return (
              <Fragment key={crumb.sessionId}>
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                {last ? (
                  <span aria-current="page" title={text} className="min-w-0 truncate px-1 font-semibold text-fg" data-testid="subagent-trail-current">
                    {text}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => goTo(thread.id, index + 1)}
                    title={text}
                    className="min-w-0 max-w-[12rem] shrink truncate rounded px-1 text-fg-muted transition-colors hover:text-fg"
                  >
                    {crumb.label}
                  </button>
                )}
              </Fragment>
            )
          })}
        </nav>
        <span className="shrink-0 text-xs text-fg-subtle" title="A subagent works for its thread's agent; its conversation is shown as it is and cannot be written to.">
          Read only
        </span>
      </div>
    </header>
  )
}

/**
 * A subagent's whole conversation, in place of its thread's: the task it was given, every step it took and its
 * answer, drawn as a thread is, but only to be read. Its own subagents open the same way, deeper down the trail.
 */
export function SubagentView({ thread, trail }: { thread: InboxThread; trail: readonly SubagentCrumb[] }): JSX.Element {
  const crumb = trail[trail.length - 1]!
  const conversation = useSubagentConversation(thread.id, crumb.sessionId)
  const { running, loadOlder, refresh } = conversation
  const messages = useMemo(() => attachSubagentReports(conversation.messages), [conversation.messages])
  const options = useInboxChat((state) => state.options[optionsKey({ threadId: thread.id })])
  const models = options?.status === 'ready' ? options.value.models : undefined
  const open = useSubagentNav((state) => state.open)
  const back = useSubagentNav((state) => state.back)
  const openSubagent = useCallback((next: SubagentCrumb) => open(thread.id, next), [open, thread.id])
  const parentName = trail.length > 1 ? trail[trail.length - 2]!.label : (thread.customTitle ?? thread.title)

  const removed = thread.worktreeRemovedAt !== undefined
  const fileSource = useMemo<ChatFileSource | null>(() => removed ? null : {
    directory: thread.directory,
    exists: createFileLookup((path) => window.api.files.list({ sessionId: thread.id, path })),
    open: ({ path }) => useWorkspace.getState().openFile(thread.id, path),
  }, [removed, thread.directory, thread.id])

  const [codeFamily, setCodeFamily] = useState(() => getTerminalSettings().codeFamily)
  useEffect(() => subscribeTerminalSettings(() => setCodeFamily(getTerminalSettings().codeFamily)), [])

  // Escape goes back up the trail, unless something on the page takes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || escapeTakenElsewhere(event)) return
      event.preventDefault()
      back(thread.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, thread.id])

  const lastAssistantId = useMemo(() => [...messages].reverse().find((message) => message.kind === 'assistant')?.id, [messages])
  const compact = useInboxView((view) => view.compactChat)
  const showText = useInboxView((view) => view.compactText)
  const showSubagents = useInboxView((view) => view.compactSubagents)
  const lastPlans = useRef<ReadonlyMap<string, RenderBlock[]>>()
  const plans = useMemo(() => {
    const next = compact ? compactPlans(messages, running ? lastAssistantId : undefined, lastPlans.current, { showText, showSubagents }) : undefined
    lastPlans.current = next
    return next
  }, [compact, showText, showSubagents, messages, running, lastAssistantId])
  const turns = useMemo(() => turnStats(messages, running), [messages, running])

  // Opens at the end, where the answer is, and stays there while the subagent works, unless scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => { stick.current = true }, [crumb.sessionId])
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [messages, running])
  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
  }, [])

  return (
    <ChatFileSourceContext.Provider value={fileSource}>
    <SubagentOpenContext.Provider value={openSubagent}>
    <div
      className="@container flex min-h-0 flex-1 flex-col"
      data-testid="subagent-view"
      data-session={crumb.sessionId}
      style={{ '--inbox-code-font': codeViewerFontFamily(codeFamily) } as CSSProperties}
    >
      <SubagentTrail thread={thread} trail={trail} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        {...hoverScrollbar}
        className="hover-scrollbar chat-selectable min-h-0 flex-1 overflow-y-auto"
        data-testid="subagent-transcript"
        data-chat-scroller=""
      >
        <div className="chat-flow mx-auto w-full max-w-3xl px-6 py-5">
          {conversation.older && (
            <button
              type="button"
              className="self-center text-xs text-accent hover:underline disabled:opacity-50"
              disabled={conversation.loadingOlder}
              onClick={() => { stick.current = false; void loadOlder() }}
              data-testid="subagent-show-earlier"
            >
              {conversation.loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {conversation.loading && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-fg-subtle">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading the subagent’s conversation…
            </div>
          ) : messages.length === 0 && !conversation.error ? (
            <p className="py-10 text-center text-xs text-fg-subtle">No messages yet.</p>
          ) : null}
          <CompactChatContext.Provider value={compact}>
            {messages.map((message) => {
              const took = turns.finished.get(message.id)
              return (
                <Fragment key={message.id}>
                  <ChatMessageView
                    message={message}
                    directory={thread.directory}
                    models={models}
                    working={running && message.id === lastAssistantId}
                    plan={plans?.get(message.id)}
                  />
                  {took !== undefined && <TurnDuration ms={took.ms} tokensPerSecond={took.tokensPerSecond} />}
                </Fragment>
              )
            })}
          </CompactChatContext.Provider>
          {running && <WorkingFor since={turns.openSince} />}
          {conversation.error && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{conversation.error}</span>
              <button type="button" className="flex items-center gap-1 text-accent hover:underline" onClick={refresh}>
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-5 pt-2">
        <p className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2.5 text-xs text-fg-subtle" data-testid="subagent-read-only">
          <span className="min-w-0 truncate">A subagent’s conversation can only be read.</span>
          <button type="button" onClick={() => back(thread.id)} className="min-w-0 truncate whitespace-nowrap text-accent hover:underline">
            Back to {parentName}
          </button>
        </p>
      </div>
    </div>
    </SubagentOpenContext.Provider>
    </ChatFileSourceContext.Provider>
  )
}
