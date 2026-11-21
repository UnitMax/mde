import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { isBrowserLinkClick, normalizeAllowedHost, type BrowserLinkClick } from '@shared/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SwitchRow } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mdeBrowserAvailable } from '@/lib/web-links'
import { useInboxBrowser } from '@/store/inbox-browser'
import { getTerminalSettings, saveTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

const LINK_CLICK_LABELS: Record<BrowserLinkClick, string> = {
  system: 'System browser',
  mde: 'MDE browser, for local and allowed hosts',
}

/** Settings → Browser: where clicked links open, and the hosts the MDE browser may open besides local ones. */
export function BrowserSettings(): JSX.Element {
  const [linkClick, setLinkClick] = useState<BrowserLinkClick>(() => getTerminalSettings().linkClick)
  useEffect(() => subscribeTerminalSettings(() => setLinkClick(getTerminalSettings().linkClick)), [])
  const store = useInboxBrowser()
  useEffect(() => useInboxBrowser.getState().init(), [])
  const [host, setHost] = useState('')
  const [cleared, setCleared] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchingWebRTC, setSwitchingWebRTC] = useState(false)
  const [webrtcError, setWebRTCError] = useState<string | null>(null)
  const typed = host.trim() ? normalizeAllowedHost(host) : null
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!typed) return
    if (await store.allowHost(typed)) setHost('')
  }
  const available = mdeBrowserAvailable()
  return (
    <section className="space-y-4" aria-labelledby="browser-settings">
      <div>
        <h3 id="browser-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Browser
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          The MDE browser is the Browser tab of the Inbox sidebar, for the web apps you are building. It opens localhost,
          127.0.0.1 and the hosts listed here. The host list covers web requests and WebSockets, and WebRTC is off.
        </p>
      </div>

      <SwitchRow
        checked={store.state.enabled}
        label="Enable the MDE browser"
        description="Adds the Browser tab to the Inbox sidebar. Turning it off closes its tabs and keeps the allowed hosts and browsing data."
        testId="browser-enabled"
        disabled={!available || !store.loaded || switching}
        onClick={() => {
          setSwitching(true)
          void store.setEnabled(!store.state.enabled).finally(() => setSwitching(false))
        }}
      />

      <label className="block text-xs font-medium text-fg-muted">
        Clicking a web link opens it in
        <Select
          value={linkClick}
          disabled={!available || !store.state.enabled}
          onValueChange={(value) => {
            if (!isBrowserLinkClick(value)) return
            setLinkClick(value)
            saveTerminalSettings({ ...getTerminalSettings(), linkClick: value })
          }}
        >
          <SelectTrigger className="mt-1" data-testid="browser-link-click">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LINK_CLICK_LABELS) as BrowserLinkClick[]).map((value) => (
              <SelectItem key={value} value={value}>
                {LINK_CLICK_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="mt-1 block font-normal text-fg-subtle">
          {available && !store.state.enabled ? 'Links open in the system browser while the MDE browser is off.' : available
            ? 'With the MDE browser chosen, links to any other host still open in the system browser. Right-click a link to choose either browser.'
            : 'The MDE browser is part of the Inbox, which is not available here, so links open in the system browser.'}
        </span>
      </label>

      <div className="space-y-2 rounded border border-line bg-panel p-3" data-testid="browser-allowed-hosts">
        <div>
          <h4 className="text-xs font-medium text-fg">Allowed hosts</h4>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Hosts besides local ones that the MDE browser may open and load from, on any port. Add only hosts you trust,
            such as your own staging servers.
          </p>
        </div>
        {store.state.allowedHosts.length === 0 ? (
          <p className="text-[11px] text-fg-subtle">None. Only local addresses open.</p>
        ) : (
          <ul className="space-y-1">
            {store.state.allowedHosts.map((entry) => (
              <li key={entry} className="flex items-center gap-2 rounded bg-bg px-2 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{entry}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={`Stop allowing ${entry}`}
                  aria-label={`Remove ${entry}`}
                  data-testid="browser-host-remove"
                  onClick={() => void store.removeHost(entry)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex items-center gap-2" onSubmit={(event) => void add(event)}>
          <Input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="staging.example.internal"
            spellCheck={false}
            aria-label="Host to allow"
            data-testid="browser-host-input"
            className="font-mono"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!typed} data-testid="browser-host-add">
            Allow
          </Button>
        </form>
        {host.trim() && !typed && <p className="text-[11px] text-danger">Enter a host name or an IP address, without wildcards.</p>}
        {store.error && store.error !== webrtcError && <p role="alert" className="text-[11px] text-danger">{store.error}</p>}
      </div>

      <div className="space-y-2">
        <SwitchRow
          checked={store.state.webrtc}
          label="Allow WebRTC"
          description="For pages that make video or voice calls or connect peer to peer. Most apps don't need it; leave it off unless yours does. Open pages are closed and opened again."
          testId="browser-webrtc"
          disabled={!available || !store.loaded || !store.state.enabled || switchingWebRTC}
          onClick={() => {
            setSwitchingWebRTC(true)
            setWebRTCError(null)
            void store.setWebRTC(!store.state.webrtc).then((done) => {
              if (!done) setWebRTCError(useInboxBrowser.getState().error)
              setSwitchingWebRTC(false)
            })
          }}
        />
        {store.state.webrtc && (
          <p data-testid="browser-webrtc-warning" className="flex items-start gap-1.5 px-1 text-[11px] text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            WebRTC connections don't go through the host list. A page can use them to reach hosts you haven't allowed,
            over TCP or through a TURN relay, and so send data out without asking. Only plain UDP to other hosts is
            stopped. Pages can also use service workers again.
          </p>
        )}
        {store.state.webrtcUnsaved && (
          <div data-testid="browser-webrtc-unsaved" className="flex items-start gap-2 px-1 text-[11px] text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              WebRTC is off, but that could not be saved, so MDE will start with it on next time.
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={switchingWebRTC}
              data-testid="browser-webrtc-save-again"
              onClick={() => {
                setSwitchingWebRTC(true)
                setWebRTCError(null)
                void store.setWebRTC(false).then((done) => {
                  if (!done) setWebRTCError(useInboxBrowser.getState().error)
                  setSwitchingWebRTC(false)
                })
              }}
            >
              Save again
            </Button>
          </div>
        )}
        {webrtcError && !store.state.webrtcUnsaved && <p role="alert" className="px-1 text-[11px] text-danger">{webrtcError}</p>}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-3">
        <div>
          <h4 className="text-xs font-medium text-fg">Browsing data</h4>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Cookies, storage, the cache and the history of the MDE browser, kept apart from MDE itself. Clearing them signs
            you out of the apps opened in it and forgets the pages opened.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="browser-clear-data"
          onClick={() => void store.clearData().then(setCleared)}
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
          {cleared ? 'Cleared' : 'Clear browsing data'}
        </Button>
      </div>
    </section>
  )
}
