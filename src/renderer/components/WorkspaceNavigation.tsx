import { TitleBarButton } from '@/components/TitleBar'
import { countUnreadInboxThreads } from '@/lib/inbox'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const sections = [
  { id: 'sessions' as const, label: 'Sessions' },
  { id: 'todo' as const, label: 'To Do' },
  { id: 'inbox' as const, label: 'Inbox' },
]

export function WorkspaceNavigation(): JSX.Element {
  const active = useWorkspace((state) => state.activeWorkspaceView)
  const select = useWorkspace((state) => state.setWorkspaceView)
  const unread = useWorkspace((state) => countUnreadInboxThreads(state.inboxThreads))

  return (
    <nav aria-label="Workspace sections" className="app-no-drag flex min-w-0 items-center gap-1 overflow-x-auto">
      {sections.map((section) => {
        const count = section.id === 'inbox' ? unread : 0
        const unreadLabel = `${count} unread Inbox thread${count === 1 ? '' : 's'}`
        return (
          <TitleBarButton
            key={section.id}
            aria-label={count ? `${section.label}, ${unreadLabel}` : section.label}
            aria-pressed={active === section.id}
            onClick={() => select(section.id)}
            className={cn('shrink-0 text-[12px]', active === section.id && 'bg-active text-fg')}
          >
            {section.label}
            {count > 0 && (
              <span data-testid="inbox-unread-count" title={unreadLabel} className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-accent-fg">
                {count}
              </span>
            )}
          </TitleBarButton>
        )
      })}
    </nav>
  )
}
