import type { ReactNode } from 'react'

/**
 * The tray tucked behind the top edge of the message box, which holds what is useful to have at hand while writing:
 * the background tasks that are running, the quick switch between favorite models. Each is a row that draws itself,
 * or nothing; the tray is only there while at least one of them is, and the rows are told apart by a hairline, so
 * that two of them are one tray and not two boxes stacked on the box.
 */
export function ComposerDock({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      data-testid="composer-dock"
      // The box overlaps the tray by 6px, hence the padding below the last row. A tray with no rows has no nodes in it.
      className="relative z-0 -mb-1.5 mx-5 divide-y divide-line/60 overflow-hidden rounded-t-xl border border-b-0 border-line bg-elevated/50 pb-1.5 empty:hidden"
    >
      {children}
    </div>
  )
}
