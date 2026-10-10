import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { OpenCodeTuiAttentionReason, OpenCodeTuiStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  openCodeStatusIconLayout,
  openCodeStatusLabel
} from '@/lib/opencode-tui-status'

const STATUS_DOT_CLASS: Record<OpenCodeTuiStatus, string> = {
  idle: 'bg-fg-subtle',
  working: 'text-accent',
  attention: 'text-accent',
  completed: 'bg-ok',
  error: 'bg-danger'
}

export function OpenCodeStatusIcon({
  status,
  attentionReason,
  className,
  testId = 'opencode-status'
}: {
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  className?: string
  testId?: string
}): JSX.Element {
  const label = openCodeStatusLabel(status, attentionReason)
  const { slotClassName, glyphClassName } = openCodeStatusIconLayout(status)
  const sharedProps = {
    'aria-label': label,
    'data-status': status,
    'data-testid': testId,
    title: label
  }

  if (status === 'working' || status === 'attention') {
    const Icon = status === 'attention' ? CircleAlert : LoaderCircle
    return (
      <span className={slotClassName}>
        <Icon
          {...sharedProps}
          className={cn(
            glyphClassName,
            'shrink-0 text-accent',
            status === 'working' && 'animate-spin',
            className
          )}
        />
      </span>
    )
  }

  return (
    <span className={slotClassName}>
      <span
        {...sharedProps}
        className={cn(glyphClassName, 'shrink-0 rounded-full', STATUS_DOT_CLASS[status], className)}
      />
    </span>
  )
}
