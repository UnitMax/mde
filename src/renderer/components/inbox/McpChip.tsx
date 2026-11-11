import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LoaderCircle, Plug } from 'lucide-react'
import { MDE_MCP_SERVER_NAME } from '@shared/mde-mcp'
import type { ChatMcpServer, ChatMessage } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toolbarChip, useComposerSize } from '@/components/inbox/composer-toolbar'
import { atLeast } from '@/lib/composer-size'
import {
  callCountLabel,
  mcpAuthCommand,
  mcpCallCounts,
  mcpKey,
  mcpStatusLabel,
  mcpSummary,
  type McpTone,
  type McpUse,
} from '@/lib/mcp'
import { cn } from '@/lib/utils'
import { useInboxMcp, type McpPlace } from '@/store/inbox-mcp'
import { useWorkspace } from '@/store/workspace'

const TONE_DOT: Record<McpTone, string> = {
  danger: 'bg-danger',
  warn: 'bg-warn',
  busy: 'bg-accent motion-safe:animate-pulse',
  ok: 'bg-ok',
  idle: 'bg-fg-subtle',
}

const STATUS_DOT: Record<ChatMcpServer['status'], string> = {
  connected: 'bg-ok',
  connecting: 'bg-accent motion-safe:animate-pulse',
  disabled: 'bg-fg-subtle/60',
  failed: 'bg-danger',
  'needs-auth': 'bg-warn',
  unknown: 'bg-fg-subtle/60',
}

function Dot({ className }: { className: string }): JSX.Element {
  return <span aria-hidden="true" className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', className)} />
}

function Name({ server }: { server: ChatMcpServer }): JSX.Element {
  return (
    <span className="block truncate text-[13px] font-medium" title={server.title ? `${server.title} (${server.name})` : server.name}>
      {server.name}
    </span>
  )
}

/** One server of the list: a switch row, or a plain row for a server that only a sign-in can help. */
function Row({
  server,
  busy,
  error,
  use,
  complete,
  disabled,
  onToggle,
}: {
  server: ChatMcpServer
  busy: 'connecting' | 'disconnecting' | undefined
  error: string | undefined
  use: McpUse | undefined
  complete: boolean
  disabled: boolean
  onToggle: (enabled: boolean) => void
}): JSX.Element {
  const calls = use ? callCountLabel(use.calls, complete) : null
  if (server.status === 'needs-auth' || server.status === 'unknown') {
    return (
      <DropdownMenuItem
        // Not disabled: a disabled item is skipped by the keyboard, and the hint would never be read out.
        onSelect={(event) => event.preventDefault()}
        className="items-start py-2"
        data-testid={`chat-mcp-server-${server.name}`}
      >
        <Dot className={STATUS_DOT[server.status]} />
        <span className="min-w-0 flex-1">
          <Name server={server} />
          <span className="block text-[11px] text-fg-muted">
            {mcpStatusLabel(server.status)}{calls ? ` · ${calls}` : ''}
          </span>
          {server.status === 'needs-auth' ? (
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">
              Run <code className="inbox-code-font cursor-text select-text rounded bg-bg px-1 py-px">{mcpAuthCommand(server.name)}</code> in a
              terminal (in WSL on Windows).
            </span>
          ) : (
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">MDE does not know this server’s state, so it leaves it alone.</span>
          )}
        </span>
      </DropdownMenuItem>
    )
  }
  const connecting = busy === 'connecting' || (!busy && server.status === 'connecting')
  const on = busy ? busy === 'connecting' : server.status === 'connected' || server.status === 'connecting'
  const status = busy === 'disconnecting' ? 'Disconnecting…' : busy === 'connecting' ? 'Connecting…' : mcpStatusLabel(server.status)
  return (
    <DropdownMenuSwitchItem
      checked={on}
      disabled={disabled || Boolean(busy) || server.status === 'connecting'}
      onCheckedChange={onToggle}
      className="items-start py-2"
      data-testid={`chat-mcp-server-${server.name}`}
      trailing={busy || server.status === 'connecting'
        ? <LoaderCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted motion-safe:animate-spin" />
        : undefined}
    >
      <Dot className={busy ? STATUS_DOT.connecting : STATUS_DOT[server.status]} />
      <span className="min-w-0 flex-1">
        <Name server={server} />
        <span className={cn('block text-[11px]', server.status === 'failed' && !busy ? 'text-danger' : 'text-fg-muted')}>
          {status}{calls && !busy ? ` · ${calls}` : ''}
        </span>
        {server.status === 'failed' && !busy && server.error && (
          <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-muted" title={server.error}>{server.error}</span>
        )}
        {error && <span role="alert" className="mt-0.5 block text-[11px] leading-snug text-danger">{error}</span>}
        {connecting && <span className="sr-only">Please wait</span>}
      </span>
    </DropdownMenuSwitchItem>
  )
}

/**
 * The MCP servers OpenCode has for this folder or thread, as a plug in the composer's toolbar: how many are
 * connected, and a dot for the worst state. Opening it lists them with a switch each, like the OpenCode TUI's list.
 * A switch connects or disconnects the server for the running OpenCode; nothing in OpenCode's configuration changes.
 * Nothing is shown while OpenCode has no MCP server for the place.
 */
export function McpChip({
  place,
  running = false,
  readOnly = false,
  messages,
  complete = true,
}: {
  place: McpPlace
  /** The agent is working: a change applies from its next step. */
  running?: boolean
  /** The list is the folder's, not the one the thread will run in, so it is shown but not switched. */
  readOnly?: boolean
  /** The conversation, to count each server's calls. */
  messages?: readonly ChatMessage[]
  /** False when older messages that are not loaded may hold more calls. */
  complete?: boolean
}): JSX.Element | null {
  const size = useComposerSize()
  const key = mcpKey(place.target, place.directory)
  const entry = useInboxMcp((state) => state.entries[key])
  const watch = useInboxMcp((state) => state.watch)
  const load = useInboxMcp((state) => state.load)
  const setEnabled = useInboxMcp((state) => state.setEnabled)
  const openSettings = useWorkspace((state) => state.openSettings)
  const [announcement, setAnnouncement] = useState('')
  // The place is rebuilt on every render; what it points at only changes with these.
  useEffect(() => watch(place), [watch, key, place.request.folderId, place.request.threadId]) // eslint-disable-line react-hooks/exhaustive-deps
  const names = entry?.names
  const counts = useMemo(() => (messages && names ? mcpCallCounts(messages, names) : null), [messages, names])
  const servers = entry?.servers ?? []
  const busy = entry?.busy ?? {}
  // A server being switched counts as connecting, whatever the list still says.
  const summary = useMemo(
    () => mcpSummary(servers.map((server) => (busy[server.name] ? { ...server, status: 'connecting' as const } : server))),
    [servers, busy],
  )
  if (!entry || servers.length === 0) return null
  const counted = atLeast(size, 'medium')
  const alert = summary.tone === 'danger' || summary.tone === 'warn'
  const Icon = alert ? AlertTriangle : Plug
  const toggle = (server: string, enabled: boolean): void => {
    void setEnabled(place, server, enabled).then(() => {
      const now = useInboxMcp.getState().entries[key]?.servers.find((item) => item.name === server)
      setAnnouncement(now ? `${server}: ${mcpStatusLabel(now.status)}` : '')
    })
  }
  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) void load(place, true) }}>
        <DropdownMenuTrigger asChild>
          {/* The plug wears the worst state as a badge, so it shows at any width; the count joins it when there is room. */}
          <button
            type="button"
            aria-label={summary.description}
            title={summary.description}
            data-testid="chat-mcp-chip"
            data-tone={summary.tone}
            className={cn(toolbarChip, 'shrink-0', counted ? 'px-2' : 'w-7 justify-center px-0')}
          >
            <span className="relative flex">
              <Icon aria-hidden="true" className={cn('h-4 w-4', summary.tone === 'danger' && 'text-danger', summary.tone === 'warn' && 'text-warn')} />
              <span aria-hidden="true" className={cn('absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full ring-[1.5px] ring-elevated', TONE_DOT[summary.tone])} />
            </span>
            {counted && <span className="tabular-nums">{summary.label}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-80 p-1" data-testid="chat-mcp-menu">
          <DropdownMenuLabel>MCP servers</DropdownMenuLabel>
          <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
            {servers.map((server) => (
              <Row
                key={server.name}
                server={server}
                busy={busy[server.name]}
                error={entry.rowError[server.name]}
                use={counts?.get(server.name)}
                complete={complete}
                disabled={readOnly}
                onToggle={(enabled) => toggle(server.name, enabled)}
              />
            ))}
          </div>
          {!servers.some((server) => server.name === MDE_MCP_SERVER_NAME) && (
            <DropdownMenuItem data-testid="chat-mcp-install-mde" onSelect={() => openSettings('opencode')} className="text-[12px] text-fg-muted">
              Let agents start threads: install the MDE MCP…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-fg-muted">
            Changes last until OpenCode restarts. Your configuration is not changed.
            {running && ' The agent is working; changes apply from its next step.'}
            {readOnly && ' A new worktree loads its own servers; this list is the folder’s.'}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">{announcement}</span>
    </>
  )
}
