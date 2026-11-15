import { useMemo } from 'react'
import { AlertCircle, Code, FilePen, FileSearch, FolderOutput, Globe, LoaderCircle, Plug, ShieldCheck, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { relativeCommitTime } from '@/lib/git-graph'
import { mcpKey } from '@/lib/mcp'
import { groupSavedPermissions, savedPermissionPattern, type SavedPermissionKind } from '@/lib/saved-permissions'
import { cn } from '@/lib/utils'
import { useInboxMcp } from '@/store/inbox-mcp'
import { useInboxSavedPermissions } from '@/store/inbox-saved-permissions'

const NO_SERVERS: string[] = []
const KIND_ICONS: Record<SavedPermissionKind, LucideIcon> = {
  shell: SquareTerminal,
  edit: FilePen,
  read: FileSearch,
  outside: FolderOutput,
  web: Globe,
  mcp: Plug,
  code: Code,
  other: ShieldCheck,
}

/**
 * The "Always allow" approvals OpenCode saved for the project the thread works in, grouped by tool, each with the
 * pattern it allows. Removing one makes OpenCode ask again the next time, in every thread of the project.
 */
export function InboxSavedPermissions({ thread }: { thread: InboxThread }): JSX.Element {
  const entry = useInboxSavedPermissions((state) => state.entries[thread.id])
  const servers = useInboxMcp((store) => store.entries[mcpKey(thread.target, thread.directory)]?.names) ?? NO_SERVERS
  const groups = useMemo(() => groupSavedPermissions(entry?.permissions ?? [], servers), [entry?.permissions, servers])
  const remove = (id: string): void => void useInboxSavedPermissions.getState().remove(thread.id, id)
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-saved-permissions">
      <p className="shrink-0 border-b border-line px-3 py-2 text-[11.5px] leading-snug text-fg-subtle">
        OpenCode does these without asking, in every thread of this project. Remove one to be asked again.
      </p>
      {entry?.error && (
        <p role="alert" className="flex shrink-0 items-start gap-1.5 border-b border-line bg-danger/10 px-3 py-2 text-[11.5px] leading-snug text-danger">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{entry.error}</span>
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!entry?.loaded && <p role="status" className="px-3 py-2 text-[12px] text-fg-subtle">Loading…</p>}
        {entry?.loaded && groups.length === 0 && !entry.error && (
          <p className="px-3 py-2 text-[12px] text-fg-subtle">Nothing is allowed always any more.</p>
        )}
        {groups.map((group) => {
          const Icon = KIND_ICONS[group.kind]
          return (
            <section key={group.action} aria-label={group.server ? `${group.server}: ${group.label}` : group.label} className="px-1.5 pb-1.5 pt-1" data-testid={`inbox-saved-group-${group.action}`}>
              <h3 className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-[11.5px] font-medium text-fg-muted" title={group.action}>
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                {group.server && (
                  <span className="shrink-0 rounded bg-fg/10 px-1 text-[10.5px] leading-4 text-fg-muted">{group.server}</span>
                )}
                <span className="min-w-0 truncate">{group.label}</span>
                <span className="ml-auto shrink-0 tabular-nums text-fg-subtle">{group.permissions.length}</span>
              </h3>
              <ul className="flex flex-col">
                {group.permissions.map((permission) => {
                  const pattern = savedPermissionPattern(permission.resource)
                  const removing = Boolean(entry?.removing[permission.id])
                  const saved = permission.created > 0 ? `Saved ${relativeCommitTime(permission.created / 1000)}` : 'Saved'
                  return (
                    <li
                      key={permission.id}
                      data-testid={`inbox-saved-permission-${permission.id}`}
                      className={cn('group/saved flex min-h-7 min-w-0 items-center gap-1 rounded-md pl-[1.6rem] pr-0.5 hover:bg-hover', removing && 'opacity-50')}
                      title={`${pattern.anything ? 'Anything' : permission.resource}\n${saved}`}
                    >
                      <span
                        className={cn(
                          'min-w-0 flex-1 break-all py-1 text-[11.5px] leading-snug',
                          pattern.anything ? 'text-fg-muted italic' : 'inbox-code-font text-fg',
                        )}
                      >
                        {pattern.text}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove: always allow ${group.label.toLowerCase()} ${pattern.anything ? '(anything)' : permission.resource}`}
                        title="Remove (OpenCode asks again)"
                        data-testid={`inbox-saved-permission-remove-${permission.id}`}
                        disabled={removing}
                        onClick={() => remove(permission.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-60 transition hover:bg-danger/15 hover:text-danger hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover/saved:opacity-100 disabled:pointer-events-none"
                      >
                        {removing ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <X aria-hidden className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
