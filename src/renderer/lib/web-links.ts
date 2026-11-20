import { isBrowserUrlAllowed } from '@shared/browser'
import { externalLinkUrl } from '@/lib/file-viewer'
import { inboxLocked } from '@/lib/inbox'
import { useInboxBrowser } from '@/store/inbox-browser'
import { useInboxChanges } from '@/store/inbox-changes'
import { useInboxView } from '@/store/inbox-view'
import { useWorkspace } from '@/store/workspace'
import { getTerminalSettings } from '@/terminal/terminal-settings'

/** The MDE browser lives in the Inbox sidebar, so it is there wherever the Inbox is. */
export function mdeBrowserAvailable(): boolean {
  const { platform, wslAvailable } = useWorkspace.getState()
  return !inboxLocked(platform, wslAvailable)
}

/** Opens a web link in the system browser; the main process checks it once more before the OS gets it. */
export function openInSystemBrowser(href: string): void {
  const url = externalLinkUrl(href)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Brings the MDE browser into view: the Inbox, its sidebar docked and open, on the Browser tab. The page is a
 * native view laid over that tab, which a floating menu card could not hold.
 */
export function showInboxBrowser(): void {
  const workspace = useWorkspace.getState()
  if (workspace.activeWorkspaceView !== 'inbox') workspace.setWorkspaceView('inbox')
  if (useInboxView.getState().sidebarFloating) useInboxView.getState().setSidebarFloating(false)
  if (useWorkspace.getState().fileTreeCollapsed) useWorkspace.getState().toggleFileTree()
  useInboxChanges.getState().setTab('browser')
}

/**
 * Opens a web link in the MDE browser. A host that is not allowed is not contacted: the tab says so and offers to
 * allow it. Where there is no MDE browser the link goes to the system browser.
 */
export function openInMdeBrowser(href: string): void {
  const url = externalLinkUrl(href)
  if (!url) return
  if (!mdeBrowserAvailable() || !useInboxBrowser.getState().state.enabled) {
    openInSystemBrowser(url)
    return
  }
  showInboxBrowser()
  void useInboxBrowser.getState().open(url)
}

/**
 * What a left click on a web link does: by default the system browser opens it. With Settings → Browser set to the
 * MDE browser, local addresses and allowed hosts open there and every other link still goes to the system browser,
 * so a click never asks to allow a host.
 */
export function openWebLink(href: string): void {
  const url = externalLinkUrl(href)
  if (!url) return
  const browser = useInboxBrowser.getState()
  browser.init()
  if (getTerminalSettings().linkClick === 'mde' && browser.state.enabled && mdeBrowserAvailable() && isBrowserUrlAllowed(url, browser.state.allowedHosts)) {
    openInMdeBrowser(url)
    return
  }
  openInSystemBrowser(url)
}
