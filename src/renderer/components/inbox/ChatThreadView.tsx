import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, FoldVertical, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ChatMessage, InboxThread, OpenCodeModelRef } from '@shared/types'
import { ChatAside } from '@/components/inbox/ChatAside'
import { ChatFindBar } from '@/components/inbox/ChatFindBar'
import { ChatBackgroundTasks } from '@/components/inbox/ChatBackgroundTasks'
import { ComposerDock } from '@/components/inbox/ComposerDock'
import { ModelQuickSwitch } from '@/components/inbox/ModelQuickSwitch'
import { ChatComposer, type ChatComposerHandle } from '@/components/inbox/ChatComposer'
import { ChatGoalCard, type GoalAction } from '@/components/inbox/ChatGoalCard'
import { McpChip } from '@/components/inbox/McpChip'
import { McpServerNamesContext } from '@/components/inbox/mcp-context'
import { ChatMessageView } from '@/components/inbox/ChatMessageView'
import { ChatPendingView } from '@/components/inbox/ChatPendingView'
import { ChatQuoteButton } from '@/components/inbox/ChatQuoteButton'
import { PermissionCard, QuestionCard } from '@/components/inbox/ChatRequestCards'
import { ChatRevertBanner } from '@/components/inbox/ChatRevertBanner'
import { ChatRevertDialog } from '@/components/inbox/ChatRevertDialog'
import { ChatScrollToBottom } from '@/components/inbox/ChatScrollToBottom'
import { ChatTimeline } from '@/components/inbox/ChatTimeline'
import { ChatTranscriptMenu } from '@/components/inbox/ChatTranscriptMenu'
import { CompactChatContext } from '@/components/inbox/chat-ui'
import { TurnDuration, WorkingFor } from '@/components/inbox/ChatTurnTime'
import { registerThreadInput } from '@/lib/inbox-thread-input'
import { scrollBehavior, TIMELINE_MIN_PROMPTS, timelineEntries } from '@/lib/chat-timeline'
import { compactPlans, type RenderBlock } from '@/lib/chat-tools'
import { cn } from '@/lib/utils'
import { compactionState, contextUsage, drawnStart, findModel, goalPhase, hideReverted, initialChoice, mergeLive, revertedMessageCount, sameModelRef, turnStats } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { mcpKey } from '@/lib/mcp'
import { slashCommands } from '@/lib/slash-commands'
import { useInboxAside } from '@/store/inbox-aside'
import { optionsKey, useInboxChat, type ChatThreadState } from '@/store/inbox-chat'
import { useInboxFind } from '@/store/inbox-find'
import { useInboxMcp, type McpPlace } from '@/store/inbox-mcp'
import { useInboxView } from '@/store/inbox-view'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

const NO_SERVERS: readonly string[] = []

/** Within this distance of the bottom, new content keeps the view pinned to it. */
const STICK_THRESHOLD_PX = 80

/**
 * How many of the newest messages are drawn when a thread opens, and how many more each step back adds.
 * Drawing a message costs a few milliseconds, so a long conversation drawn whole freezes the window.
 */
export const DRAWN_MESSAGES = 40

/** A prompt the timeline jumps to is left this far below the top edge, so that its bubble is not cut off. */
const JUMP_MARGIN_PX = 16

function lastAssistant(messages: ChatThreadState['messages'] | undefined): { agent: string; model: OpenCodeModelRef } | null {
  if (!messages) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.kind === 'assistant') return { agent: message.agent, model: message.model }
  }
  return null
}

type UserMessage = Extract<ChatMessage, { kind: 'user' }>

/** The conversation of one thread with its composer. */
export function ChatThreadView({ thread }: { thread: InboxThread }): JSX.Element {
  const openThread = useInboxChat((state) => state.openThread)
  const state = useInboxChat((store) => store.threads[thread.id])
  const options = useInboxChat((store) => store.options[optionsKey({ threadId: thread.id })])
  const remembered = useInboxChat((store) => store.composer)
  const loadOptions = useInboxChat((store) => store.loadOptions)
  const loadOlder = useInboxChat((store) => store.loadOlder)
  const refresh = useInboxChat((store) => store.refresh)
  const send = useInboxChat((store) => store.send)
  const interrupt = useInboxChat((store) => store.interrupt)
  const discardPending = useInboxChat((store) => store.discardPending)
  const setPendingDelivery = useInboxChat((store) => store.setPendingDelivery)
  const redo = useInboxChat((store) => store.redo)
  const revertTo = useInboxChat((store) => store.revert)
  const forkThread = useInboxChat((store) => store.forkThread)
  const compactThread = useInboxChat((store) => store.compactThread)
  const setGoal = useInboxChat((store) => store.setGoal)
  const draftReload = useInboxChat((store) => store.draftReloads[thread.id])
  const clearDraftReload = useInboxChat((store) => store.clearDraftReload)
  const replyPermission = useInboxChat((store) => store.replyPermission)
  const replyForm = useInboxChat((store) => store.replyForm)
  const aside = useInboxAside((store) => store.asides[thread.id])
  const askAside = useInboxAside((store) => store.ask)
  const dismissAside = useInboxAside((store) => store.dismiss)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const composerSlot = useRef<HTMLDivElement>(null)
  const composer = useRef<ChatComposerHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The search bar (Ctrl+F). Asking again while it is open gives its field the focus; a selection in the conversation becomes the query.
  const [find, setFind] = useState<{ query: string; signal: number; target?: string } | null>(null)
  useEffect(() => setFind(null), [thread.id])
  // A result of the search over all threads opens this thread with its search bar on the message that was found.
  const findRequest = useInboxFind((store) => store.request)
  const clearFindRequest = useInboxFind((store) => store.clear)
  useEffect(() => {
    if (!findRequest || findRequest.threadId !== thread.id) return
    clearFindRequest()
    setFind((current) => ({ query: findRequest.query, signal: (current?.signal ?? 0) + 1, target: findRequest.messageId }))
  }, [findRequest, clearFindRequest, thread.id])
  // Text selected in the conversation goes into the message box as a quote, from the button by the selection or the right-click menu.
  const quote = useCallback((text: string) => composer.current?.quote(text), [])
  // Text sent from the Inbox terminal's right-click menu arrives the same way.
  useEffect(() => registerThreadInput(thread.id, quote), [thread.id, quote])
  const stickRef = useRef(true)
  // Whether the view is scrolled up from the newest message, which is when the way back is offered.
  const [away, setAway] = useState(false)
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<OpenCodeModelRef | null>(null)
  const [codeFamily, setCodeFamily] = useState(() => getTerminalSettings().codeFamily)
  // The message the person asked to revert to, while the dialog about it is open.
  const [revertTarget, setRevertTarget] = useState<UserMessage | null>(null)
  const askRevert = useCallback((message: UserMessage) => setRevertTarget(message), [])
  useEffect(() => setRevertTarget(null), [thread.id])
  // Forking from a message makes a request that can fail; the failure is told here, in this thread.
  const [fork, setFork] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const forking = useRef(false)
  useEffect(() => {
    forking.current = false
    setFork({ pending: false, error: null })
  }, [thread.id])
  // Makes the fork and shows that it is being made; a failure goes back to whoever asked, to tell where it was asked.
  const runFork = useCallback(async (input?: { messageId: string; text: string }, options?: { focus?: boolean }): Promise<void> => {
    forking.current = true
    setFork({ pending: true, error: null })
    try {
      await forkThread(thread.id, input, options)
    } finally {
      forking.current = false
      setFork({ pending: false, error: null })
    }
  }, [forkThread, thread.id])
  const forkFrom = useCallback((message: UserMessage) => {
    if (forking.current) return
    runFork({ messageId: message.id, text: message.text }).catch((error: unknown) => {
      setFork({ pending: false, error: ipcErrorMessage(error, 'Could not fork the thread.') })
    })
  }, [runFork])
  // `/fork`: the whole conversation, and the caret goes on in the new thread's box. A failure is told under
  // the box, which gets the command back.
  const forkAll = useCallback(async (): Promise<void> => {
    if (forking.current) throw new Error('A fork is still being made.')
    await runFork(undefined, { focus: true })
  }, [runFork])

  // A copy from the right-click menu can fail (a conversation past the clipboard limit); the failure is told here.
  const [copyError, setCopyError] = useState<string | null>(null)
  useEffect(() => setCopyError(null), [thread.id])

  useEffect(() => subscribeTerminalSettings(() => setCodeFamily(getTerminalSettings().codeFamily)), [])

  useEffect(() => openThread(thread.id), [openThread, thread.id])
  useEffect(() => {
    void loadOptions({ threadId: thread.id })
  }, [loadOptions, thread.id])

  // A staged revert hides the end of the conversation. The hidden messages stay loaded, so a redo shows them at once.
  const revert = state?.revert ?? null
  const shown = useMemo(() => hideReverted(state?.messages ?? [], revert), [state?.messages, revert])
  const revertedCount = useMemo(() => revertedMessageCount(state?.messages ?? [], revert), [state?.messages, revert])
  const revertHides = useMemo(
    () => (revertTarget ? shown.filter((message) => message.kind === 'user' && message.id >= revertTarget.id).length : 0),
    [shown, revertTarget],
  )
  const latest = useMemo(() => lastAssistant(shown), [shown])
  const messages = useMemo(
    () => (state ? mergeLive(shown, state.live, latest ?? (thread.model ? { agent: 'build', model: thread.model } : undefined)) : []),
    [state, shown, latest, thread.model],
  )

  // A revert can reach back past the newest pages. Load back to the first message it leaves in view,
  // which also makes the count of hidden messages complete. A failed page stops the loading.
  const olderToLoad = revert !== null && shown.length === 0 && Boolean(state?.older) && !state?.loadingOlder && !state?.error
  useEffect(() => {
    if (olderToLoad) void loadOlder(thread.id)
  }, [olderToLoad, loadOlder, thread.id])

  // The composer starts with what the thread last used, so a follow-up does not switch anything by accident.
  const ready = options?.status === 'ready' ? options.value : null
  useEffect(() => {
    if (!ready) return
    const fallback = initialChoice(ready, remembered)
    setAgent((current) => current ?? latest?.agent ?? fallback.agent)
    setModel((current) => current ?? latest?.model ?? thread.model ?? fallback.model)
  }, [ready, latest, remembered, thread.model])

  // The window is the chosen model's, so picking another model shows right away whether the thread still fits.
  const context = useMemo(
    () => contextUsage({ messages: shown, usage: state?.usage ?? null, model: findModel(ready?.models ?? [], model) }),
    [shown, state?.usage, ready?.models, model],
  )

  // Only the end of the conversation is drawn, from the message `drawnFrom` names; earlier messages are added
  // above when they are asked for (scrolling to the top, the timeline, the search). The start is a message and
  // not a count, so that new messages at the end take nothing away at the top.
  const [drawnFrom, setDrawnFrom] = useState<string | null>(null)
  const first = useMemo(() => drawnStart(messages, drawnFrom, DRAWN_MESSAGES), [messages, drawnFrom])
  // Named as soon as there is a message, so that a short conversation growing past the count loses nothing at its top.
  if (drawnFrom === null && messages.length > 0) setDrawnFrom(messages[first]!.id)
  const drawn = useMemo(() => (first === 0 ? messages : messages.slice(first)), [messages, first])
  const drawnFirstId = drawn[0]?.id
  // Where the topmost drawn message was on screen before messages were added above it, to put it back there.
  const keepPlace = useRef<{ id: string; top: number } | null>(null)
  const notePlace = useCallback(() => {
    const top = scrollRef.current?.querySelector<HTMLElement>('[data-chat-message]')
    keepPlace.current = top ? { id: top.dataset.chatMessage!, top: top.getBoundingClientRect().top } : null
  }, [])
  const canLoadOlder = Boolean(state?.older) && !state?.loadingOlder
  /** Shows more of the conversation above: what is loaded and not drawn first, then an older page. */
  const showEarlier = useCallback(() => {
    if (first > 0) {
      notePlace()
      setDrawnFrom(messages[Math.max(0, first - DRAWN_MESSAGES)]!.id)
      return
    }
    if (!canLoadOlder) return
    void loadOlder(thread.id).then(() => {
      const loaded = useInboxChat.getState().threads[thread.id]?.messages[0]
      if (!loaded) return
      notePlace()
      setDrawnFrom(loaded.id)
    })
  }, [first, messages, canLoadOlder, loadOlder, notePlace, thread.id])

  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX
    setAway(!stickRef.current)
    if (element.scrollTop < 40 && (first > 0 || canLoadOlder)) showEarlier()
  }, [first, canLoadOlder, showEarlier])

  // Ctrl+F (Cmd+F on a Mac) searches this conversation, from the message box or anywhere else in the thread's pane.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'f' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return
      const root = rootRef.current
      const active = document.activeElement
      if (!root || (active && active !== document.body && !root.contains(active))) return
      event.preventDefault()
      event.stopPropagation()
      const selected = window.getSelection()
      const text = selected && !selected.isCollapsed && scrollRef.current?.contains(selected.anchorNode) ? selected.toString().trim() : ''
      setFind((current) => ({ query: text && !text.includes('\n') && text.length <= 200 ? text : '', signal: (current?.signal ?? 0) + 1 }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
  const closeFind = useCallback(() => {
    setFind(null)
    requestAnimationFrame(() => composerSlot.current?.querySelector<HTMLElement>('[data-testid="chat-input"] .cm-content')?.focus())
  }, [])
  const requests = state?.requests
  const pending = state?.pending
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [messages, requests, pending])

  const prompts = useMemo(() => timelineEntries(messages), [messages])
  // In a narrow pane the timeline's rail would touch the text, so the conversation and the composer both leave room for it.
  const railGutter = prompts.length >= TIMELINE_MIN_PROMPTS && '@max-[50rem]:pr-9'
  // A prompt the timeline names that is not drawn yet: it is drawn first, and jumped to once it is there.
  const jumpAfterDraw = useRef<string | null>(null)
  const jumpToPrompt = useCallback((id: string) => {
    const scroller = scrollRef.current
    const target = scroller && Array.from(scroller.querySelectorAll<HTMLElement>('[data-chat-message]')).find((element) => element.dataset.chatMessage === id)
    if (scroller && !target && first > 0 && messages.findIndex((message) => message.id === id) < first && jumpAfterDraw.current !== id) {
      jumpAfterDraw.current = id
      keepPlace.current = null
      setDrawnFrom(id)
      return
    }
    jumpAfterDraw.current = null
    if (!scroller || !target) return
    const wanted = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - JUMP_MARGIN_PX
    const last = scroller.scrollHeight - scroller.clientHeight
    const top = Math.min(Math.max(wanted, 0), last)
    // Landing near the end follows new messages again; anywhere else leaves the view where it is put.
    if (Math.abs(top - scroller.scrollTop) < 1) return
    stickRef.current = last - top < STICK_THRESHOLD_PX
    scroller.scrollTo({ top, behavior: scrollBehavior() })
  }, [first, messages])
  // Messages were added above: the one that was topmost stays where it was, or the view stays at the end it was
  // following. Then, while what is drawn does not fill the pane twice over (a compact conversation folds many
  // messages into one line), more is drawn, so that there is always something above to scroll to.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const kept = keepPlace.current
    keepPlace.current = null
    const anchor = kept && Array.from(element.querySelectorAll<HTMLElement>('[data-chat-message]')).find((item) => item.dataset.chatMessage === kept.id)
    if (kept && anchor) element.scrollTop += anchor.getBoundingClientRect().top - kept.top
    else if (stickRef.current) element.scrollTop = element.scrollHeight
    const jump = jumpAfterDraw.current
    if (jump) {
      jumpToPrompt(jump)
      jumpAfterDraw.current = null
      return
    }
    if (first > 0 && element.scrollHeight < element.clientHeight * 2) showEarlier()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawnFirstId])
  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    stickRef.current = true
    // Already at the end there is no scroll to report it, so the button is put away here as well.
    setAway(false)
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: scrollBehavior() })
  }, [])

  // The cards above the box (a side question, the goal) take room from the conversation, and they change height as they
  // go, so a conversation that is following its end keeps doing so when the room it has changes.
  useEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    // Only the room it has in height counts: opening a step can make the scrollbar appear, which narrows the conversation
    // and also resizes it, and following the end then would throw the view to the bottom.
    let height = element.clientHeight
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === height) return
      height = element.clientHeight
      if (stickRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    // The conversation itself changes height too (a folded step opening or closing). Closing one while scrolled up can leave
    // the view at the end without a scroll event, so the place is measured again, or the button would be stuck on screen.
    const content = contentRef.current
    const contentObserver = content
      ? new ResizeObserver(() => {
          if (stickRef.current) return
          const near = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX
          if (!near) return
          stickRef.current = true
          setAway(false)
        })
      : null
    if (content) contentObserver?.observe(content)
    return () => {
      observer.disconnect()
      contentObserver?.disconnect()
    }
  }, [])
  // The side question takes room from the conversation, so a conversation that is following its end keeps doing so.
  const asideId = aside?.id
  const asideStatus = aside?.status
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [asideId, asideStatus])
  // Closed from inside itself (Escape, a button reached by keyboard), the caret goes back to the box instead of nowhere.
  const closeAside = useCallback(() => {
    const inside = document.activeElement?.closest('[data-testid="chat-aside"]') != null
    dismissAside(thread.id)
    if (inside) requestAnimationFrame(() => composerSlot.current?.querySelector<HTMLElement>('[data-testid="chat-input"] .cm-content')?.focus())
  }, [dismissAside, thread.id])

  const running = state?.running ?? thread.status === 'working'
  // Only the newest step of the agent can be live; one before it that never finished was cut short.
  const lastAssistantId = useMemo(() => [...messages].reverse().find((message) => message.kind === 'assistant')?.id, [messages])
  // The compact layout folds the activity of the agent's steps together, across steps. A step whose layout did not
  // change keeps the one it had, so that streaming a new step does not draw all the earlier ones again.
  const compact = useInboxView((view) => view.compactChat)
  const lastPlans = useRef<ReadonlyMap<string, RenderBlock[]>>()
  const plans = useMemo(() => {
    const next = compact ? compactPlans(messages, running ? lastAssistantId : undefined, lastPlans.current) : undefined
    lastPlans.current = next
    return next
  }, [compact, messages, running, lastAssistantId])

  // Compacting summarizes the conversation to free up context. OpenCode does it in the background and writes it
  // into the conversation as a note, so this only asks, and refuses what would make a second, failing note:
  // one already going or waiting for the agent, nothing finished to summarize, or nothing since the last one.
  const compaction = useMemo(() => compactionState(shown, { running, held: state?.compactionHeld ?? false }), [shown, running, state?.compactionHeld])
  const requestingCompaction = useRef(false)
  const compactAll = useCallback(async (): Promise<void> => {
    if (requestingCompaction.current) throw new Error('A compaction is already being asked for.')
    if (compaction === 'running') throw new Error('The conversation is already being compacted.')
    if (compaction === 'held') throw new Error('A compaction is already waiting for the agent to finish.')
    if (!context) throw new Error('There is nothing to compact yet.')
    if (context.compacted) throw new Error('The conversation was just compacted. It has nothing new to compact yet.')
    requestingCompaction.current = true
    try {
      await compactThread(thread.id)
    } finally {
      requestingCompaction.current = false
    }
  }, [compaction, compactThread, context, thread.id])
  // From the context menu there is no box to give the failure back to, so it is told here, in the thread.
  const [compactError, setCompactError] = useState<string | null>(null)
  useEffect(() => setCompactError(null), [thread.id])
  const compactFromMenu = useCallback(() => {
    setCompactError(null)
    compactAll().catch((error: unknown) => setCompactError(ipcErrorMessage(error, 'Could not compact the conversation.')))
  }, [compactAll])
  const compactMenu = useMemo(() => ({ state: compaction, onRun: compactFromMenu }), [compaction, compactFromMenu])
  // The goal (`/goal`) is OpenCode's; the card above the box shows it and offers pause, resume and clear. A goal set from
  // the box starts the agent with the agent and model the box shows, as a message would.
  const goal = state?.goal ?? null
  const asking = (requests?.permissions.length ?? 0) + (requests?.forms.length ?? 0) > 0
  const phase = goalPhase(messages, { running, asking })
  const changeGoal = useCallback((change: { action: 'set'; objective: string } | { action: GoalAction }): Promise<void> => {
    if (change.action !== 'set') return setGoal(thread.id, { action: change.action })
    return setGoal(thread.id, {
      action: 'set',
      objective: change.objective,
      ...(agent && agent !== latest?.agent ? { agent } : {}),
      ...(model && !sameModelRef(model, latest?.model) ? { model } : {}),
    })
  }, [agent, latest?.agent, latest?.model, model, setGoal, thread.id])
  const commands = useMemo(
    () => slashCommands({ ask: (question) => askAside(thread.id, question), fork: forkAll, compact: compactAll, goal: changeGoal }),
    [askAside, forkAll, compactAll, changeGoal, thread.id],
  )
  // The MCP servers of the folder the thread runs in; the chip in the composer keeps this list current.
  const mcpPlace = useMemo<McpPlace>(
    () => ({ request: { threadId: thread.id }, target: thread.target, directory: thread.directory }),
    [thread.id, thread.target, thread.directory],
  )
  const mcpNames = useInboxMcp((store) => store.entries[mcpKey(thread.target, thread.directory)]?.names) ?? NO_SERVERS
  // The time under each turn comes from the service's clock; the count for the turn in progress prefers
  // this computer's own, which the sidebar's pill also counts from, so a clock that is off cannot skew it.
  const turns = useMemo(() => turnStats(messages, running), [messages, running])
  const busySince = thread.status === 'working' || thread.status === 'attention' ? thread.workingSince : undefined

  const previousMessage = useCallback(async (beforeId?: string): Promise<{ id: string; text: string } | null> => {
    for (;;) {
      const current = useInboxChat.getState().threads[thread.id]
      if (!current) return null
      const history = [...hideReverted(current.messages, current.revert), ...current.pending.map((held) => held.message)]
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index]!
        if (message.kind === 'user' && message.text.trim() && (!beforeId || message.id < beforeId)) {
          return { id: message.id, text: message.text }
        }
      }
      if (!current.older || current.loadingOlder) return null
      const cursor = current.older
      await loadOlder(thread.id)
      // A failed read keeps its cursor; do not retry it in a loop.
      if (useInboxChat.getState().threads[thread.id]?.older === cursor) return null
    }
  }, [loadOlder, thread.id])

  return (
    <McpServerNamesContext.Provider value={mcpNames}>
    <div
      ref={rootRef}
      className="@container flex min-h-0 flex-1 flex-col"
      data-testid="chat-thread"
      style={{ '--inbox-code-font': codeViewerFontFamily(codeFamily) } as CSSProperties}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatTranscriptMenu messages={messages} complete={!state?.older} transcriptRef={scrollRef} onCopyError={setCopyError} onQuote={quote}>
      <div ref={scrollRef} onScroll={onScroll} className="chat-selectable min-h-0 flex-1 overflow-y-auto" data-testid="chat-transcript">
        <div ref={contentRef} className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5', railGutter)}>
          {(first > 0 || state?.older) && (
            <button
              type="button"
              className="self-center text-xs text-accent hover:underline disabled:opacity-50"
              disabled={first === 0 && state?.loadingOlder}
              onClick={showEarlier}
              data-testid="chat-show-earlier"
            >
              {first === 0 && state?.loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {!state || (state.loading && state.messages.length === 0) ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-fg-subtle">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading conversation…
            </div>
          ) : state.messages.length === 0 && messages.length === 0 && !state.error ? (
            <p className="py-10 text-center text-xs text-fg-subtle">No messages yet.</p>
          ) : null}
          <CompactChatContext.Provider value={compact}>
            {drawn.map((message) => {
              const took = turns.finished.get(message.id)
              return (
                <Fragment key={message.id}>
                  <ChatMessageView
                    message={message}
                    directory={thread.directory}
                    models={ready?.models}
                    working={running && message.id === lastAssistantId}
                    plan={plans?.get(message.id)}
                    onRevert={message.kind === 'user' ? askRevert : undefined}
                    onFork={message.kind === 'user' ? forkFrom : undefined}
                  />
                  {took !== undefined && <TurnDuration ms={took.ms} tokensPerSecond={took.tokensPerSecond} />}
                </Fragment>
              )
            })}
          </CompactChatContext.Provider>
          {/* Held for the agent: where the conversation will put them once it takes them up. */}
          {pending?.map((held) => (
            <ChatPendingView
              key={held.id}
              pending={held}
              running={running}
              onDiscard={(id) => void discardPending(thread.id, id)}
              onSetDelivery={(id, delivery) => void setPendingDelivery(thread.id, id, delivery)}
            />
          ))}
          {revert && <ChatRevertBanner revert={revert} messages={revertedCount} directory={thread.directory} onRedo={() => redo(thread.id)} />}
          {running && <WorkingFor since={busySince ?? turns.openSince} />}
          {requests?.permissions.map((permission) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              onReply={(decision) => replyPermission(thread.id, permission.id, decision)}
            />
          ))}
          {requests?.forms.map((form) => (
            <QuestionCard key={form.id} form={form} onReply={(answer) => replyForm(thread.id, form.id, answer)} />
          ))}
          {thread.sendError && <p role="alert" className="text-xs text-danger">{thread.sendError}</p>}
          {state?.notice && <p role="alert" className="text-xs text-danger" data-testid="chat-notice">{state.notice}</p>}
          {fork.pending && (
            <p role="status" className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="chat-fork-status">
              <LoaderCircle aria-hidden className="h-3 w-3 animate-spin text-accent motion-reduce:animate-none" />
              Forking thread…
            </p>
          )}
          {fork.error && <p role="alert" className="text-xs text-danger" data-testid="chat-fork-error">{fork.error}</p>}
          {compaction === 'held' && (
            <p role="status" className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="chat-compaction-held">
              <FoldVertical aria-hidden className="h-3 w-3 text-accent" />
              Compaction is waiting for the agent. It starts when the agent finishes.
            </p>
          )}
          {compactError && <p role="alert" className="text-xs text-danger" data-testid="chat-compact-error">{compactError}</p>}
          {copyError && <p role="alert" className="text-xs text-danger" data-testid="chat-copy-error">{copyError}</p>}
          {state?.error && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{state.error}</span>
              <button type="button" className="flex items-center gap-1 text-accent hover:underline" onClick={() => void refresh(thread.id)}>
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
      </ChatTranscriptMenu>
      <ChatTimeline entries={prompts} scrollRef={scrollRef} onJump={jumpToPrompt} />
      <ChatQuoteButton transcriptRef={scrollRef} onQuote={quote} />
      {away && <ChatScrollToBottom onClick={scrollToBottom} />}
      {find && (
        <ChatFindBar
          scrollRef={scrollRef}
          seed={find.query}
          target={find.target}
          focusSignal={find.signal}
          moreToLoad={first > 0 || (Boolean(state?.older) && !state?.error)}
          loadingMore={first === 0 && Boolean(state?.loadingOlder)}
          onLoadMore={showEarlier}
          onClose={closeFind}
        />
      )}
      </div>
      <div ref={composerSlot} className={cn('mx-auto w-full max-w-3xl shrink-0 px-6 pb-5 pt-2', railGutter)}>
        {goal && <ChatGoalCard key={goal.id} goal={goal} phase={phase} running={running} onAction={(action) => setGoal(thread.id, { action })} />}
        {aside && <ChatAside aside={aside} onDismiss={closeAside} onRetry={() => void askAside(thread.id, aside.question)} />}
        <ComposerDock>
          <ChatBackgroundTasks key={`background:${thread.id}`} threadId={thread.id} />
          {ready && <ModelQuickSwitch models={ready.models} value={model} onChange={setModel} />}
        </ComposerDock>
        <ChatComposer
          ref={composer}
          key={thread.id}
          draftKey={`thread:${thread.id}`}
          fileScope={{ threadId: thread.id }}
          onPreviousMessage={previousMessage}
          draftReload={draftReload}
          onDraftReloaded={(id) => clearDraftReload(thread.id, id)}
          options={options}
          agent={agent}
          model={model}
          onAgentChange={setAgent}
          onModelChange={setModel}
          onRetryOptions={() => void loadOptions({ threadId: thread.id }, true)}
          running={running}
          context={context}
          compact={compactMenu}
          commands={commands}
          onEscape={() => {
            if (!aside) return false
            closeAside()
            return true
          }}
          extraPickers={<McpChip place={mcpPlace} running={running} messages={shown} complete={!state?.older} />}
          onStop={() => void interrupt(thread.id)}
          onSend={async (text, attachments) => {
            stickRef.current = true
            await send(thread.id, text, {
              ...attachments,
              ...(agent && agent !== latest?.agent ? { agent } : {}),
              ...(model && !sameModelRef(model, latest?.model) ? { model } : {}),
            })
          }}
        />
      </div>
      <ChatRevertDialog
        message={revertTarget}
        hidden={revertHides}
        running={running}
        onCancel={() => setRevertTarget(null)}
        onConfirm={async ({ files }) => {
          if (!revertTarget) return
          await revertTo(thread.id, { messageId: revertTarget.id, text: revertTarget.text, files })
          stickRef.current = true
          setRevertTarget(null)
        }}
      />
    </div>
    </McpServerNamesContext.Provider>
  )
}
