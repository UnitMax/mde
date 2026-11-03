import { Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useInboxChanges } from '@/store/inbox-changes'

/** A gear at the end of the Inbox filters, with the Inbox's display settings. */
export function InboxSettingsMenu(): JSX.Element {
  const sidebarChanges = useInboxChanges((state) => state.sidebarChanges)
  const setSidebarChanges = useInboxChanges((state) => state.setSidebarChanges)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="inbox-settings"
          aria-label="Inbox settings"
          title="Inbox settings"
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-64">
        <DropdownMenuLabel>Thread list</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          data-testid="inbox-setting-changes"
          checked={sidebarChanges}
          onCheckedChange={(checked) => setSidebarChanges(checked === true)}
        >
          <span className="min-w-0">
            <span className="block">Git changes</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">
              Each thread&rsquo;s uncommitted changes, with the files on hover. Reads Git for the threads in view.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
