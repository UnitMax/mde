import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A chip of the strip under the message box: small and flat, and it opens a menu. */
export const barTrigger =
  'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-fg-muted transition-colors ' +
  'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover data-[state=open]:text-fg'

/**
 * The strip tucked under the new-thread message box, which holds the choices about how a thread starts
 * without crowding the box's own toolbar: how it is shown (GUI or Terminal) and, in a Git folder, where it runs.
 */
export function ComposerBar({
  testId,
  className,
  children,
}: {
  testId: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={cn(
        '-mt-1.5 mx-5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-b-xl border border-t-0 border-line bg-elevated/50 px-1.5 pb-1 pt-2',
        className,
      )}
    >
      {children}
    </div>
  )
}
