import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { OpenCodeConfigTarget } from '@shared/opencode-config'
import type { MdeMcpStatus, MdeMcpTerminalCommands, MdeMcpTerminalSettings } from '@shared/mde-mcp'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useWorkspace } from '@/store/workspace'

const STATE_TEXT: Record<MdeMcpStatus['state'], string> = {
  missing: 'Not installed.',
  installed: 'Installed. Agents can start threads with tools.mde.create_thread and open terminals with tools.mde.open_terminal.',
  outdated: 'Installed for another copy of MDE, or changed by hand. Update it to point at this one.',
}

/**
 * Settings → OpenCode: adds the MDE MCP to OpenCode's configuration (`mcp.servers.mde`), so that agents can
 * start Inbox threads. One target at a time: this computer, or on Windows the WSL distro OpenCode runs in.
 */
export function MdeMcpSettings(): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const wsl = Boolean(platform?.isWindows)
  const [distro, setDistro] = useState('')
  const [status, setStatus] = useState<MdeMcpStatus | null>(null)
  const [busy, setBusy] = useState<'load' | 'install' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (wsl) void refreshDistros().catch(() => undefined)
  }, [wsl, refreshDistros])

  useEffect(() => {
    if (!wsl || distro) return
    const preferred = distros.find((item) => item.isDefault) ?? distros[0]
    if (preferred) setDistro(preferred.name)
  }, [wsl, distro, distros])

  const target = useMemo<OpenCodeConfigTarget | null>(
    () => (wsl ? (distro ? { kind: 'wsl', distro } : null) : { kind: 'native' }),
    [wsl, distro],
  )

  const run = useCallback(async (action: 'load' | 'install' | 'remove', place: OpenCodeConfigTarget) => {
    setBusy(action)
    setError(null)
    try {
      const api = window.api.mdeMcp
      setStatus(await (action === 'install' ? api.install(place) : action === 'remove' ? api.remove(place) : api.status(place)))
    } catch (failure) {
      setError(ipcErrorMessage(failure, 'MDE could not change OpenCode’s configuration.'))
      if (action === 'load') setStatus(null)
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    setStatus(null)
    if (target) void run('load', target)
  }, [target, run])

  const state = status?.state
  return (
    <div className="space-y-2 rounded border border-line bg-panel p-3" data-testid="mde-mcp-settings">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-medium text-fg">MDE MCP</h4>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Lets agents start new Inbox threads, for example to hand off independent work, and open panes in the Inbox
            terminal, for example to run a dev server. Adds an <code>mde</code> MCP
            server to OpenCode’s global configuration; OpenCode picks it up within seconds.
          </p>
        </div>
        {wsl && (
          <div className="flex w-40 shrink-0 flex-col gap-1">
            <Label htmlFor="mde-mcp-distro" className="text-[11px] text-fg-subtle">WSL distro</Label>
            <Select value={distro} onValueChange={setDistro} disabled={busy !== null}>
              <SelectTrigger id="mde-mcp-distro" data-testid="mde-mcp-distro">
                <SelectValue placeholder="Choose a distro" />
              </SelectTrigger>
              <SelectContent>
                {distros.map((item) => (
                  <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {!target ? (
        <p className="text-[11px] text-fg-muted">
          {distros.length === 0 ? 'No WSL distro was found. OpenCode runs inside one.' : 'Choose the WSL distro OpenCode runs in.'}
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[11px] text-fg-muted" data-testid="mde-mcp-state" aria-live="polite">
            {busy === 'load' && <LoaderCircle aria-hidden className="h-3 w-3 motion-safe:animate-spin" />}
            {busy === 'load' ? 'Checking…' : status?.parseError ? `${status.file} cannot be read (${status.parseError}). Fix it by hand first.` : state ? STATE_TEXT[state] : ''}
          </p>
          {status && <p className="truncate text-[11px] text-fg-subtle" title={status.file}>{status.file}</p>}
          <div className="flex gap-2">
            {state && state !== 'installed' && !status?.parseError && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="mde-mcp-install"
                disabled={busy !== null}
                onClick={() => void run('install', target)}
              >
                {busy === 'install' && <LoaderCircle aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />}
                {state === 'outdated' ? 'Update' : 'Install'}
              </Button>
            )}
            {state && state !== 'missing' && !status?.parseError && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="mde-mcp-remove"
                disabled={busy !== null}
                onClick={() => void run('remove', target)}
              >
                {busy === 'remove' && <LoaderCircle aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />}
                Remove
              </Button>
            )}
          </div>
        </>
      )}
      {error && <p className="text-[11px] text-danger" data-testid="mde-mcp-error">{error}</p>}
      <AgentTerminalCommandsSetting />
    </div>
  )
}

const COMMAND_CHOICES: Record<MdeMcpTerminalCommands, string> = {
  ask: 'Ask me first',
  run: 'Run without asking',
}

/**
 * Whether a command an agent asks to run in a terminal it opens runs at once or waits on an approval bar in that
 * pane. Running it skips OpenCode's own permission rules for shell commands, so asking is the default.
 */
function AgentTerminalCommandsSetting(): JSX.Element {
  const [settings, setSettings] = useState<MdeMcpTerminalSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    window.api.mdeMcp.terminalSettings()
      .then((value) => { if (live) setSettings(value) })
      .catch((failure: unknown) => { if (live) setError(ipcErrorMessage(failure, 'MDE could not read this setting.')) })
    return () => { live = false }
  }, [])

  const change = async (update: Parameters<typeof window.api.mdeMcp.setTerminalSettings>[0]): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.api.mdeMcp.setTerminalSettings(update))
    } catch (failure) {
      setError(ipcErrorMessage(failure, 'MDE could not change this setting.'))
    }
  }

  const until = settings?.commands === 'ask' && settings.allowedUntil !== null
    ? new Date(settings.allowedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div className="space-y-1.5 border-t border-line pt-2" data-testid="mde-mcp-terminal-commands">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="mde-mcp-terminal-commands" className="text-xs font-medium text-fg">Commands in terminals agents open</Label>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Asking shows the command over the new pane with Run, Run and allow for an hour, and Don’t run. Running
            without asking skips OpenCode’s own permission rules for shell commands.
          </p>
        </div>
        <div className="w-40 shrink-0">
          <Select
            value={settings?.commands ?? ''}
            disabled={!settings}
            onValueChange={(value) => void change({ commands: value as MdeMcpTerminalCommands })}
          >
            <SelectTrigger id="mde-mcp-terminal-commands" data-testid="mde-mcp-terminal-commands-select">
              <SelectValue placeholder="…" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(COMMAND_CHOICES) as MdeMcpTerminalCommands[]).map((choice) => (
                <SelectItem key={choice} value={choice}>{COMMAND_CHOICES[choice]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {until && settings && (
        <p className="flex items-center gap-2 text-[11px] text-fg-muted" data-testid="mde-mcp-terminal-allowed">
          Commands run without asking until {until}.
          <Button type="button" variant="ghost" size="sm" onClick={() => void change({ commands: settings.commands, allowedUntil: null })}>
            Ask again now
          </Button>
        </p>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  )
}
