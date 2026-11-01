import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react'
import type { InboxThread, OpenCodeModelRef } from '@shared/types'
import { ChatComposer } from '@/components/inbox/ChatComposer'
import { ChatMessageView } from '@/components/inbox/ChatMessageView'
import { PermissionCard, QuestionCard } from '@/components/inbox/ChatRequestCards'
import { contextUsage, findModel, initialChoice, mergeLive } from '@/lib/chat'
import { optionsKey, useInboxChat, type ChatThreadState } from '@/store/inbox-chat'

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
  const replyPermission = useInboxChat((store) => store.replyPermission)
  const replyForm = useInboxChat((store) => store.replyForm)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<OpenCodeModelRef | null>(null)

  useEffect(() => openThread(thread.id), [openThread, thread.id])
  useEffect(() => {
    void loadOptions({ threadId: thread.id })
  }, [loadOptions, thread.id])

  const latest = useMemo(() => lastAssistant(state?.messages), [state?.messages])
  const messages = useMemo(
    () => (state ? mergeLive(state.messages, state.live, latest ?? (thread.model ? { agent: 'build', model: thread.model } : undefined)) : []),
    [state, latest, thread.model],
  )

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
    () => contextUsage({ messages: state?.messages ?? [], usage: state?.usage ?? null, model: findModel(ready?.models ?? [], model) }),
    [state?.messages, state?.usage, ready?.models, model],
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
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [messages, requests])

  const running = state?.running ?? thread.status === 'working'
  const streaming = (() => {
    const last = messages[messages.length - 1]
    return last?.kind === 'assistant' && !last.completed
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-thread">
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
          {messages.map((message) => (
            <ChatMessageView key={message.id} message={message} directory={thread.directory} />
          ))}
          {running && !streaming && (
            <div className="flex items-center gap-2 px-1.5 text-[12px] text-fg-subtle" data-testid="chat-working">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Working…
            </div>
          )}
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
      <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-5 pt-2">
        <ChatComposer
          options={options}
          agent={agent}
          model={model}
          onAgentChange={setAgent}
          onModelChange={setModel}
          onRetryOptions={() => void loadOptions({ threadId: thread.id }, true)}
          running={running}
          context={context}
          onStop={() => void interrupt(thread.id)}
          onSend={async (text) => {
            stickRef.current = true
            await send(thread.id, text, {
              ...(agent && agent !== latest?.agent ? { agent } : {}),
              ...(model && (model.id !== latest?.model.id || model.providerId !== latest?.model.providerId) ? { model } : {}),
            })
          }}
        />
      </div>
    </div>
  )
}
