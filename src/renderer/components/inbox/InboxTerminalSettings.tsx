import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxTerminal } from '@/store/inbox-terminal'
import { useWorkspace } from '@/store/workspace'

const DEFAULT_DISTRO = '@default'

/** The Inbox sidebar's WSL choice in the main Settings dialog's Terminal section. */
export function InboxTerminalSettings(): JSX.Element {
  const savedDistro = useInboxTerminal((state) => state.distro)
  const configuring = useInboxTerminal((state) => state.configuring)
  const error = useInboxTerminal((state) => state.error)
  const configureDistro = useInboxTerminal((state) => state.configureDistro)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const [distro, setDistro] = useState(savedDistro ?? DEFAULT_DISTRO)
  const [loadError, setLoadError] = useState<string | null>(null)
  const unavailable = distro !== DEFAULT_DISTRO && !distros.some((item) => item.name === distro)

  useEffect(() => {
    let cancelled = false
    void refreshDistros().catch((error: unknown) => {
      if (!cancelled) setLoadError(ipcErrorMessage(error, 'Could not list WSL distributions.'))
    })
    return () => { cancelled = true }
  }, [refreshDistros])

  return (
    <form
      className="space-y-3 rounded border border-line bg-panel p-3"
      data-testid="inbox-terminal-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void configureDistro(distro === DEFAULT_DISTRO ? null : distro)
      }}
    >
      <div>
        <h4 className="text-xs font-medium text-fg">Inbox sidebar terminal</h4>
        <p className="mt-0.5 text-[11px] text-fg-subtle">
          Choose its WSL distribution. Changing it restarts all sidebar terminal panes in that
          distribution&rsquo;s home directory.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inbox-terminal-distro">WSL distribution</Label>
        <Select value={distro} onValueChange={setDistro} disabled={configuring}>
          <SelectTrigger id="inbox-terminal-distro" data-testid="inbox-terminal-distro">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_DISTRO}>Default WSL distribution</SelectItem>
            {unavailable && <SelectItem value={distro} disabled>{distro} (unavailable)</SelectItem>}
            {distros.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {(loadError || error) && <p role="alert" className="text-xs text-danger">{loadError || error}</p>}
      <Button type="submit" variant="secondary" size="sm" disabled={configuring || unavailable}>
        {configuring ? 'Applying…' : 'Apply'}
      </Button>
    </form>
  )
}
