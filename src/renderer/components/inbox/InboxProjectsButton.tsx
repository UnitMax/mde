import { useState } from 'react'
import { FolderCog } from 'lucide-react'
import { InboxProjectsDialog } from '@/components/inbox/InboxProjectsDialog'

/** A folder with a cog next to the Inbox settings, which opens the project manager. */
export function InboxProjectsButton(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-testid="inbox-projects-button"
        aria-label="Projects"
        title="Projects"
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <FolderCog className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <InboxProjectsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
