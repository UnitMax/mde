import { Check, CircleDashed, LoaderCircle, X } from 'lucide-react'
import type { ChatToolStatus } from '@shared/types'

/** The mark in front of a tool call: waiting, working, done or failed. */
export function ToolIcon({ status }: { status: ChatToolStatus }): JSX.Element {
  if (status === 'completed') return <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
  if (status === 'error') return <X className="h-3.5 w-3.5 shrink-0 text-danger" />
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
}
