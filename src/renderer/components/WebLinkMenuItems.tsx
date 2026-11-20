import { AppWindow, ExternalLink } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { mdeBrowserAvailable, openInMdeBrowser, openInSystemBrowser } from '@/lib/web-links'
import { useInboxBrowser } from '@/store/inbox-browser'

/** "Open in MDE browser" and "Open in system browser" for a web link that was right-clicked. */
export function WebLinkMenuItems({ url, testIdPrefix }: { url: string; testIdPrefix: string }): JSX.Element {
  const enabled = useInboxBrowser((s) => s.state.enabled)
  return (
    <>
      {enabled && mdeBrowserAvailable() && (
        <ContextMenuItem data-testid={`${testIdPrefix}-open-mde`} onSelect={() => openInMdeBrowser(url)}>
          <AppWindow aria-hidden className="h-3.5 w-3.5" />
          Open in MDE browser
        </ContextMenuItem>
      )}
      <ContextMenuItem data-testid={`${testIdPrefix}-open-system`} onSelect={() => openInSystemBrowser(url)}>
        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        Open in system browser
      </ContextMenuItem>
    </>
  )
}
