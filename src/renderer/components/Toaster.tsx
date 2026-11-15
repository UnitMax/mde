import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  AlarmClock,
  Bot,
  CheckCircle2,
  CircleAlert,
  MessageCircleQuestion,
  Send,
  ShieldQuestion,
  SquareTerminal,
  TerminalSquare,
  X,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToasts, type Toast, type ToastIcon } from '@/store/toasts'

const ICONS: Record<ToastIcon, LucideIcon> = {
  done: CheckCircle2,
  input: MessageCircleQuestion,
  permission: ShieldQuestion,
  failed: CircleAlert,
  woke: AlarmClock,
  background: Send,
  'agent-thread': Bot,
  'agent-terminal': SquareTerminal,
  approval: TerminalSquare,
  error: CircleAlert
}

function ToastCard({ toast }: { toast: Toast }): JSX.Element {
  const dismiss = useToasts((state) => state.dismiss)
  const Icon = ICONS[toast.icon]
  const open = (): void => {
    toast.onOpen?.()
    dismiss(toast.id)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    dismiss(toast.id)
  }

  return (
    <div className="mde-toast-slot" data-leaving={toast.leaving || undefined}>
      <div className="min-h-0 overflow-hidden">
        <div className="pt-2">
          <div
            role="status"
            className="mde-toast group relative overflow-hidden rounded-lg border border-line-strong bg-elevated"
            data-tone={toast.tone}
            data-testid="toast"
            onKeyDown={onKeyDown}
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 py-2.5 pl-3 pr-9 text-left outline-none focus-visible:bg-hover"
              onClick={open}
              disabled={!toast.onOpen}
              data-testid="toast-open"
              title={toast.onOpen ? 'Go there' : undefined}
            >
              <span className="mde-toast-icon mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mde-toast-label block text-[11px] font-medium leading-4">{toast.label}</span>
                <span
                  className={cn(
                    'block truncate text-[13px] font-medium leading-5 text-fg',
                    toast.icon === 'approval' && 'font-mono text-[12px]'
                  )}
                  data-testid="toast-title"
                >
                  {toast.title}
                </span>
                {toast.detail && (
                  <span className="block truncate text-[11.5px] leading-4 text-fg-subtle" data-testid="toast-detail">
                    {toast.detail}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-fg-subtle opacity-0 outline-none transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              title="Dismiss (Esc)"
              data-testid="toast-dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {!toast.leaving && (
              <span
                className="mde-toast-countdown"
                style={{ animationDuration: `${toast.duration}ms` }}
                onAnimationEnd={() => dismiss(toast.id)}
                data-testid="toast-countdown"
                aria-hidden
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The toasts, in the bottom-right corner over everything. Their time runs only while MDE is the window in use and
 * the pointer or keyboard is not on them, so one is never missed by looking away.
 */
export function Toaster(): JSX.Element | null {
  const toasts = useToasts((state) => state.toasts)
  const [focused, setFocused] = useState(() => typeof document === 'undefined' || document.hasFocus())

  useEffect(() => {
    const update = (): void => setFocused(document.hasFocus())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])

  if (toasts.length === 0) return null
  return (
    <section
      aria-label="Notifications"
      className="mde-toasts pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col"
      data-paused={focused ? undefined : ''}
      data-testid="toaster"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </section>
  )
}
