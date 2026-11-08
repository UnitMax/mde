import type { HTMLAttributes, ReactNode } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { InboxStatusChip } from '@/lib/inbox'
import { cn } from '@/lib/utils'

/** What leads the label: a spinner while working, a beating dot where the person is wanted, a mark for how it ended. */
export type StatusGlyph = 'spinner' | 'pulse' | 'check' | 'cross' | 'none'

/**
 * What state a thread is in, as a glyph and a label with no box around them (see `.status-mark` in index.css), so
 * that a list of them stays calm. The glyph tells the states apart without the color. Where the person is wanted
 * (`accent`) it is the strongest, in the state's color and a heavier weight; "Done" is the quietest, being what a
 * thread normally is.
 */
export function StatusMark({
  tone,
  glyph = 'none',
  className,
  children,
  ...props
}: {
  tone: InboxStatusChip['tone']
  glyph?: StatusGlyph
  children: ReactNode
} & HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span data-tone={tone} className={cn('status-mark', className)} {...props}>
      {glyph === 'spinner' && <LoaderCircle aria-hidden="true" className="status-mark-glyph animate-spin motion-reduce:animate-none" />}
      {glyph === 'pulse' && <span aria-hidden="true" className="status-pulse" />}
      {glyph === 'check' && <Check aria-hidden="true" strokeWidth={3} className="status-mark-glyph" />}
      {glyph === 'cross' && <X aria-hidden="true" strokeWidth={3} className="status-mark-glyph" />}
      {children}
    </span>
  )
}

/** The glyph for a thread's status. */
export function statusGlyph(status: 'idle' | 'working' | 'attention' | 'completed' | 'error'): StatusGlyph {
  switch (status) {
    case 'working': return 'spinner'
    case 'attention': return 'pulse'
    case 'completed': return 'check'
    case 'error': return 'cross'
    default: return 'none'
  }
}
