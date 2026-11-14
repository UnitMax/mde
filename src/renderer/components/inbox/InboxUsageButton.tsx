import { useState } from 'react'
import { ChartColumn } from 'lucide-react'
import type { InboxFolder } from '@shared/types'
import { InboxUsageDialog } from '@/components/inbox/InboxUsageDialog'

/** A small chart next to the projects button, which opens OpenCode's usage overview. */
export function InboxUsageButton({ project }: { project: InboxFolder | null }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-testid="inbox-usage-button"
        aria-label="Usage"
        title="Usage"
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <ChartColumn className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <InboxUsageDialog open={open} onOpenChange={setOpen} project={project} />
    </>
  )
}
