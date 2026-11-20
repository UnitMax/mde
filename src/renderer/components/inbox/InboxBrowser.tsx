import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Globe,
  MoreHorizontal,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import type { BrowserTab } from '@shared/browser'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { openInSystemBrowser } from '@/lib/web-links'
import { useInboxBrowser } from '@/store/inbox-browser'
import { useWorkspace } from '@/store/workspace'

const ICON = 'h-3.5 w-3.5'

/** Layers the app draws over everything that are not children of `<body>` besides the app itself. */
const LAYERS = '.mde-toasts > *, [data-testid="floating-terminal"]'

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && a.width > 0 && a.height > 0
}

/**
 * Whether anything of the app's is drawn over the panel: a menu, dialog, popover or toast (portalled into
 * `<body>`), the floating terminal, or an overlay inside the app such as the file viewer. The page is a native view
 * above the whole window, so it would hide them.
 */
function coveredPanel(panel: HTMLElement, rect: DOMRect): boolean {
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child.contains(panel) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue
    if (intersects(child.getBoundingClientRect(), rect)) return true
  }
  for (const layer of Array.from(document.querySelectorAll<HTMLElement>(LAYERS))) {
    if (intersects(layer.getBoundingClientRect(), rect)) return true
  }
  // What is on top at points across the panel: anything there but the panel itself covers it.
  const columns = 6
  const rows = 8
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = rect.left + ((column + 0.5) * rect.width) / columns
      const y = rect.top + ((row + 0.5) * rect.height) / rows
      const hit = document.elementFromPoint(x, y)
      if (hit && !panel.contains(hit)) return true
    }
  }
  return false
}

const SNAPSHOT_LINGER_MS = 300

/** Resolves once a picture is ready to paint, or soon anyway if it never says so. */
function decoded(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => resolve(), 150)
    const done = (): void => {
      window.clearTimeout(timer)
      resolve()
    }
    image.onload = done
    image.onerror = done
    image.src = url
    if (typeof image.decode === 'function') image.decode().then(done, done)
  })
}

/** Resolves after the next frame has been painted. */
function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Where the page is drawn. The page itself is a native view the main process lays over this box; while a menu,
 * dialog or toast is over the box, a picture of the page stands in and the page steps aside.
 */
function BrowserViewport({ tabId }: { tabId: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  useLayoutEffect(() => {
    const panel = ref.current
    if (!panel) return
    let frame = 0
    let last = ''
    let captures = 0
    let stopped = false
    let clearing = 0
    const measure = (): void => {
      frame = 0
      if (stopped) return
      const rect = panel.getBoundingClientRect()
      const onScreen = rect.width >= 2 && rect.height >= 2 && document.visibilityState === 'visible' &&
        (typeof panel.checkVisibility !== 'function' || panel.checkVisibility({ visibilityProperty: true }))
      const covered = onScreen && coveredPanel(panel, rect)
      const key = !onScreen ? 'off' : covered ? 'covered' : [rect.left, rect.top, rect.width, rect.height].join(',')
      if (key === last) return
      const wasShown = last !== '' && last !== 'off' && last !== 'covered'
      last = key
      if (key === 'off') {
        captures += 1
        void window.api.browser.setBounds(null)
        return
      }
      if (key === 'covered') {
        if (!wasShown) return
        // The picture is taken while the page is still there, decoded and painted under it, and only then does the
        // page step aside, so nothing blank shows in between.
        const generation = ++captures
        window.clearTimeout(clearing)
        void window.api.browser.capture().then(
          async (url) => {
            if (generation !== captures) return
            if (url) await decoded(url)
            if (generation !== captures) return
            setSnapshot(url)
            await painted()
          },
          () => undefined,
        ).finally(() => {
          if (generation === captures) void window.api.browser.setBounds(null)
        })
        return
      }
      captures += 1
      void window.api.browser.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      // The page needs a moment to draw again where it was taken off; the picture stays under it until then.
      window.clearTimeout(clearing)
      clearing = window.setTimeout(() => {
        if (!stopped) setSnapshot(null)
      }, SNAPSHOT_LINGER_MS)
    }
    const schedule = (): void => {
      if (!frame && !stopped) frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(panel)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-state', 'hidden', 'open'] })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    // Animations move things without a change to observe; a slow look catches where they end.
    const timer = window.setInterval(schedule, 400)
    schedule()
    return () => {
      stopped = true
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      window.clearInterval(timer)
      window.clearTimeout(clearing)
      void window.api.browser.setBounds(null)
    }
  }, [tabId])
  return (
    <div ref={ref} data-testid="inbox-browser-viewport" className="relative min-h-0 flex-1 overflow-hidden bg-bg">
      {snapshot && <img src={snapshot} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-fill" />}
    </div>
  )
}

/** The tabs of the browser along the top of the panel, and the button for a new one. */
function BrowserTabStrip({ tabs, activeId }: { tabs: BrowserTab[]; activeId: string | null }): JSX.Element {
  const store = useInboxBrowser()
  return (
    <div className="flex min-w-0 items-center gap-1 px-2 pb-1.5 pt-2">
      <div role="tablist" aria-label="Browser tabs" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeId
          const label = tab.title || tab.url || 'New tab'
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex h-6 min-w-0 max-w-[11rem] shrink-0 items-center gap-1 rounded-md pl-2 pr-0.5 text-[12px]',
                selected ? 'bg-elevated text-fg ring-1 ring-inset ring-line-strong' : 'text-fg-subtle hover:bg-hover hover:text-fg',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid="inbox-browser-tab"
                title={tab.url || label}
                className="min-w-0 flex-1 truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => void store.select(tab.id)}
              >
                {tab.loading ? '… ' : ''}{label}
              </button>
              <button
                type="button"
                aria-label={`Close ${label}`}
                title="Close tab"
                data-testid="inbox-browser-tab-close"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 hover:bg-hover hover:opacity-100"
                onClick={() => void store.close(tab.id)}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <Button variant="ghost" size="icon-sm" className="shrink-0" title="New tab" aria-label="New tab" data-testid="inbox-browser-new-tab" onClick={() => void store.newTab()}>
        <Plus className={ICON} />
      </Button>
    </div>
  )
}

/** Back, forward, reload, the address and the page's tools. */
function BrowserToolbar({ tab }: { tab: BrowserTab }): JSX.Element {
  const store = useInboxBrowser()
  const openSettings = useWorkspace((state) => state.openSettings)
  const [address, setAddress] = useState(tab.url)
  const [editing, setEditing] = useState(false)
  // The address follows the page, except while it is being typed into.
  useEffect(() => {
    if (!editing) setAddress(tab.url)
  }, [tab.url, editing])
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!address.trim()) return
    setEditing(false)
    void store.navigate(tab.id, address)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }
  const live = Boolean(tab.url) && !tab.blocked
  return (
    <form className="flex items-center gap-0.5 px-2 pb-2" onSubmit={submit}>
      <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" title="Back (Alt+Left)" aria-label="Back" disabled={!tab.canGoBack} onClick={() => void store.act(tab.id, 'back')}>
        <ArrowLeft className={ICON} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" title="Forward (Alt+Right)" aria-label="Forward" disabled={!tab.canGoForward} onClick={() => void store.act(tab.id, 'forward')}>
        <ArrowRight className={ICON} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        title={tab.loading ? 'Stop' : 'Reload (F5)'}
        aria-label={tab.loading ? 'Stop' : 'Reload'}
        data-testid="inbox-browser-reload"
        disabled={!live}
        onClick={() => void store.act(tab.id, tab.loading ? 'stop' : 'reload')}
      >
        {tab.loading ? <X className={ICON} /> : <RotateCw className={ICON} />}
      </Button>
      <input
        value={address}
        onChange={(event) => {
          setEditing(true)
          setAddress(event.target.value)
        }}
        onFocus={(event) => {
          setEditing(true)
          event.target.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setEditing(false)
          setAddress(tab.url)
          event.currentTarget.blur()
        }}
        placeholder="localhost:3000"
        // A new tab is only its address field, so it starts there.
        autoFocus={!tab.url}
        spellCheck={false}
        autoComplete="off"
        aria-label="Address"
        data-testid="inbox-browser-address"
        className="h-6 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[11.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" title="More" aria-label="More browser actions" data-testid="inbox-browser-more">
            <MoreHorizontal className={ICON} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="inbox-browser-devtools" disabled={!live} onSelect={() => void store.act(tab.id, 'devtools')}>
            <Bug aria-hidden className={ICON} />
            <span className="flex-1">Developer tools</span>
            <span className="text-[11px] text-fg-subtle">Ctrl+Shift+I</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!tab.url} onSelect={() => openInSystemBrowser(tab.url)}>
            <ExternalLink aria-hidden className={ICON} />
            Open in system browser
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSettings('browser')}>
            <ShieldAlert aria-hidden className={ICON} />
            Allowed hosts…
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="inbox-browser-clear-data" onSelect={() => void store.clearData()}>
            <Trash2 aria-hidden className={ICON} />
            Clear browsing data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </form>
  )
}

/** The page a tab shows in place of one whose host is not allowed: nothing was sent to that host. */
function BlockedPage({ tab }: { tab: BrowserTab }): JSX.Element {
  const store = useInboxBrowser()
  const blocked = tab.blocked!
  return (
    <div data-testid="inbox-browser-blocked" className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-6 py-10 text-center">
      <ShieldAlert aria-hidden className="h-6 w-6 text-fg-subtle" />
      <div className="space-y-1">
        <p className="text-[13px] text-fg">
          Allow <span className="font-mono">{blocked.host}</span>?
        </p>
        <p className="text-[12px] text-fg-subtle">
          The MDE browser opens local addresses and the hosts you allow. Nothing has been sent to this host. Allow only
          hosts you trust: an allowed host can be opened from any page in this browser.
        </p>
        <p className="break-all font-mono text-[11px] text-fg-subtle">{blocked.url}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" data-testid="inbox-browser-allow" onClick={() => void store.allowHost(blocked.host)}>
          Allow and open
        </Button>
        <Button size="sm" variant="secondary" onClick={() => openInSystemBrowser(blocked.url)}>
          <ExternalLink aria-hidden className={ICON} />
          Open in system browser
        </Button>
      </div>
    </div>
  )
}

/** Hosts the page tried to reach and was refused, each of which can be allowed (which reloads the page). */
function RefusedHosts({ tab }: { tab: BrowserTab }): JSX.Element | null {
  const store = useInboxBrowser()
  if (tab.blockedHosts.length === 0) return null
  const count = tab.blockedHosts.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="inbox-browser-refused"
          className="mx-2 mb-2 flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1 text-left text-[11.5px] text-fg-muted hover:bg-warn/15"
          title="The page asked for these hosts and was refused before anything was sent"
        >
          <ShieldAlert aria-hidden className="h-3.5 w-3.5 shrink-0 text-warn" />
          <span className="min-w-0 truncate">
            Refused {count} {count === 1 ? 'host' : 'hosts'}: {tab.blockedHosts.join(', ')}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[22rem]">
        {tab.blockedHosts.map((host) => (
          <DropdownMenuItem key={host} data-testid="inbox-browser-refused-allow" onSelect={() => void store.allowHost(host)}>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{host}</span>
            <span className="shrink-0 text-[11px] text-fg-subtle">Allow</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A tab with nothing open yet, or no tab at all: where to start, and the hosts it may open. Without a tab it has its
 * own address field, which opens the first one.
 */
function StartPage({ allowedHosts, withField = false }: { allowedHosts: string[]; withField?: boolean }): JSX.Element {
  const store = useInboxBrowser()
  const [address, setAddress] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (address.trim()) void store.open(address)
  }
  return (
    <div data-testid="inbox-browser-start" className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-6 py-10 text-center">
      <Globe aria-hidden className="h-6 w-6 text-fg-subtle" />
      <p className="text-[13px] text-fg-muted">Open the app you are working on, such as localhost:5173.</p>
      {withField && (
        <form className="mt-1 flex w-full max-w-[18rem] items-center gap-1.5" onSubmit={submit}>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="localhost:5173"
            spellCheck={false}
            autoComplete="off"
            aria-label="Address"
            data-testid="inbox-browser-start-address"
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!address.trim()} data-testid="inbox-browser-start-open">
            Open
          </Button>
        </form>
      )}
      <p className="mt-1 text-[12px] text-fg-subtle">
        This browser opens localhost and 127.0.0.1{allowedHosts.length > 0 ? `, and ${allowedHosts.join(', ')}` : ''}.
        Links to anything else open in your system browser.
      </p>
    </div>
  )
}

/** The Browser tab's contents: its tabs, the toolbar and the page. */
export function InboxBrowser(): JSX.Element {
  const store = useInboxBrowser()
  const { tabs, activeId, allowedHosts } = store.state
  useEffect(() => useInboxBrowser.getState().init(), [])
  const tab = tabs.find((item) => item.id === activeId) ?? null
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-browser">
      <BrowserTabStrip tabs={tabs} activeId={tab?.id ?? null} />
      {store.error && (
        <p role="alert" className="mx-2 mb-2 flex items-start gap-1.5 rounded-md bg-danger/10 px-2 py-1 text-[11.5px] text-danger">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{store.error}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100" onClick={store.clearError}>
            <X className="h-3 w-3" aria-hidden />
          </button>
        </p>
      )}
      {tab ? (
        <>
          <BrowserToolbar key={tab.id} tab={tab} />
          <RefusedHosts tab={tab} />
          <div className="flex min-h-0 flex-1 flex-col border-t border-line">
            {tab.blocked ? (
              <BlockedPage tab={tab} />
            ) : tab.error ? (
              <div data-testid="inbox-browser-error" className="flex min-h-0 flex-1 flex-col items-center gap-3 px-6 py-10 text-center">
                <AlertCircle aria-hidden className="h-6 w-6 text-fg-subtle" />
                <p className="break-all text-[12px] text-fg-muted">{tab.error}</p>
                <Button size="sm" variant="secondary" onClick={() => void store.act(tab.id, 'reload')}>
                  <RotateCw aria-hidden className={ICON} />
                  Try again
                </Button>
              </div>
            ) : tab.url ? (
              <BrowserViewport tabId={tab.id} />
            ) : (
              <StartPage allowedHosts={allowedHosts} />
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-line">
          <StartPage allowedHosts={allowedHosts} withField />
        </div>
      )}
    </div>
  )
}
