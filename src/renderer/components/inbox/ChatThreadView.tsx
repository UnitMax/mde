import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ChatMessage, InboxThread, OpenCodeModelRef } from '@shared/types'
import { ChatComposer } from '@/components/inbox/ChatComposer'
import { McpChip } from '@/components/inbox/McpChip'
import { McpServerNamesContext } from '@/components/inbox/mcp-context'
import { ChatMessageView } from '@/components/inbox/ChatMessageView'
import { ChatPendingView } from '@/components/inbox/ChatPendingView'
import { PermissionCard, QuestionCard } from '@/components/inbox/ChatRequestCards'
import { ChatRevertBanner } from '@/components/inbox/ChatRevertBanner'
import { ChatRevertDialog } from '@/components/inbox/ChatRevertDialog'
import { ChatTranscriptMenu } from '@/components/inbox/ChatTranscriptMenu'
import { TurnDuration, WorkingFor } from '@/components/inbox/ChatTurnTime'
import { contextUsage, findModel, hideReverted, initialChoice, mergeLive, revertedMessageCount, turnStats } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { mcpKey } from '@/lib/mcp'
import { optionsKey, useInboxChat, type ChatThreadState } from '@/store/inbox-chat'
import { useInboxMcp, type McpPlace } from '@/store/inbox-mcp'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

const NO_SERVERS: readonly string[] = []

/** Within this distance of the bottom, new content keeps the view pinned to it. */
const STICK_THRESHOLD_PX = 80

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
  const draftReload = useInboxChat((store) => store.draftReloads[thread.id])
  const clearDraftReload = useInboxChat((store) => store.clearDraftReload)
  const replyPermission = useInboxChat((store) => store.replyPermission)
  const replyForm = useInboxChat((store) => store.replyForm)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
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
  const forkFrom = useCallback((message: UserMessage) => {
    if (forking.current) return
    forking.current = true
    setFork({ pending: true, error: null })
    forkThread(thread.id, { messageId: message.id, text: message.text }).then(
      () => {
        forking.current = false
        setFork({ pending: false, error: null })
      },
      (error: unknown) => {
        forking.current = false
        setFork({ pending: false, error: ipcErrorMessage(error, 'Could not fork the thread.') })
      },
    )
  }, [forkThread, thread.id])

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

  const running = state?.running ?? thread.status === 'working'
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

  return (
    <McpServerNamesContext.Provider value={mcpNames}>
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="chat-thread"
      style={{ '--inbox-code-font': codeViewerFontFamily(codeFamily) } as CSSProperties}
    >
      <ChatTranscriptMenu messages={messages} complete={!state?.older} transcriptRef={scrollRef} onCopyError={setCopyError}>
      <div ref={scrollRef} onScroll={onScroll} className="chat-selectable min-h-0 flex-1 overflow-y-auto" data-testid="chat-transcript">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5">
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
      <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-5 pt-2">
        <ChatComposer
          key={thread.id}
          draftKey={`thread:${thread.id}`}
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
