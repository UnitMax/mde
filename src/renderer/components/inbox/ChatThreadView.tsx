import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, FoldVertical, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ChatMessage, InboxThread, OpenCodeModelRef } from '@shared/types'
import { ChatAside } from '@/components/inbox/ChatAside'
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
import { TurnDuration, WorkingFor } from '@/components/inbox/ChatTurnTime'
import { scrollBehavior, TIMELINE_MIN_PROMPTS, timelineEntries } from '@/lib/chat-timeline'
import { cn } from '@/lib/utils'
import { compactionState, contextUsage, findModel, goalPhase, hideReverted, initialChoice, mergeLive, revertedMessageCount, turnStats } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { mcpKey } from '@/lib/mcp'
import { slashCommands } from '@/lib/slash-commands'
import { useInboxAside } from '@/store/inbox-aside'
import { optionsKey, useInboxChat, type ChatThreadState } from '@/store/inbox-chat'
import { useInboxMcp, type McpPlace } from '@/store/inbox-mcp'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

const NO_SERVERS: readonly string[] = []

/** Within this distance of the bottom, new content keeps the view pinned to it. */
const STICK_THRESHOLD_PX = 80

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
  const composerSlot = useRef<HTMLDivElement>(null)
  const composer = useRef<ChatComposerHandle>(null)
  // Text selected in the conversation goes into the message box as a quote, from the button by the selection or the right-click menu.
  const quote = useCallback((text: string) => composer.current?.quote(text), [])
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

  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX
    setAway(!stickRef.current)
    if (element.scrollTop < 40 && state?.older && !state.loadingOlder) {
      const before = element.scrollHeight
      void loadOlder(thread.id).then(() => {
        // Keep the reader's place when older messages are added above.
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - before
        })
      })
    }
  }, [state?.older, state?.loadingOlder, loadOlder, thread.id])

  const requests = state?.requests
  const pending = state?.pending
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [messages, requests, pending])

  const prompts = useMemo(() => timelineEntries(messages), [messages])
  // In a narrow pane the timeline's rail would touch the text, so the conversation and the composer both leave room for it.
  const railGutter = prompts.length >= TIMELINE_MIN_PROMPTS && '@max-[50rem]:pr-9'
  const jumpToPrompt = useCallback((id: string) => {
    const scroller = scrollRef.current
    const target = scroller && Array.from(scroller.querySelectorAll<HTMLElement>('[data-chat-message]')).find((element) => element.dataset.chatMessage === id)
    if (!scroller || !target) return
    const wanted = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - JUMP_MARGIN_PX
    const last = scroller.scrollHeight - scroller.clientHeight
    const top = Math.min(Math.max(wanted, 0), last)
    // Landing near the end follows new messages again; anywhere else leaves the view where it is put.
    if (Math.abs(top - scroller.scrollTop) < 1) return
    stickRef.current = last - top < STICK_THRESHOLD_PX
    scroller.scrollTo({ top, behavior: scrollBehavior() })
  }, [])
  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    stickRef.current = true
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: scrollBehavior() })
  }, [])

  // The cards above the box (a side question, the goal) take room from the conversation, and they change height as they
  // go, so a conversation that is following its end keeps doing so when the room it has changes.
  useEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (stickRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
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
      ...(model && (model.id !== latest?.model.id || model.providerId !== latest?.model.providerId) ? { model } : {}),
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
  const turns = useMemo(() => turnStats(messages), [messages])
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
      className="@container flex min-h-0 flex-1 flex-col"
      data-testid="chat-thread"
      style={{ '--inbox-code-font': codeViewerFontFamily(codeFamily) } as CSSProperties}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatTranscriptMenu messages={messages} complete={!state?.older} transcriptRef={scrollRef} onCopyError={setCopyError} onQuote={quote}>
      <div ref={scrollRef} onScroll={onScroll} className="chat-selectable min-h-0 flex-1 overflow-y-auto" data-testid="chat-transcript">
        <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5', railGutter)}>
          {state?.older && (
            <button
              type="button"
              className="self-center text-xs text-accent hover:underline disabled:opacity-50"
              disabled={state.loadingOlder}
              onClick={() => void loadOlder(thread.id)}
            >
              {state.loadingOlder ? 'Loading…' : 'Load earlier messages'}
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
          {messages.map((message) => {
            const took = turns.finished.get(message.id)
            return (
              <Fragment key={message.id}>
                <ChatMessageView
                  message={message}
                  directory={thread.directory}
                  onRevert={message.kind === 'user' ? askRevert : undefined}
                  onFork={message.kind === 'user' ? forkFrom : undefined}
                />
                {took !== undefined && <TurnDuration ms={took.ms} tokensPerSecond={took.tokensPerSecond} />}
              </Fragment>
            )
          })}
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
      </div>
      <div ref={composerSlot} className={cn('mx-auto w-full max-w-3xl shrink-0 px-6 pb-5 pt-2', railGutter)}>
        {goal && <ChatGoalCard key={goal.id} goal={goal} phase={phase} running={running} onAction={(action) => setGoal(thread.id, { action })} />}
        {aside && <ChatAside aside={aside} onDismiss={closeAside} onRetry={() => void askAside(thread.id, aside.question)} />}
        <ChatComposer
          ref={composer}
          key={thread.id}
          draftKey={`thread:${thread.id}`}
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
              ...(model && (model.id !== latest?.model.id || model.providerId !== latest?.model.providerId) ? { model } : {}),
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
