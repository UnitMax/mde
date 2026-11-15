import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The strip along the bottom of a sidebar panel, the same height whatever it holds: the panel's own buttons on the
 * left, and `actions` (such as collapsing the sidebar) at the right end.
 */
export function SidebarFooter({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }): JSX.Element {
  return (
    <div data-testid="sidebar-footer" className={cn('flex h-9 shrink-0 items-center gap-1 border-t border-line px-2', className)}>
      {children}
      {actions && (
        // Set off from the panel's own buttons by a short rule, so that the two groups read apart.
        <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">{actions}</div>
      )}
    </div>
  )
}
