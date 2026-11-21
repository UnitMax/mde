import { useState, type ReactElement } from 'react'
import { Copy, TextSelect } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { externalLinkUrl } from '@/lib/file-viewer'
import { WebLinkMenuItems } from '@/components/WebLinkMenuItems'

interface FilePreviewMenuProps {
  children: ReactElement
  getSelectedText: () => string
  onSelectAll: () => void
  onClose?: () => void
  empty: boolean
}

export function FilePreviewMenu({
  children,
  getSelectedText,
  onSelectAll,
  onClose,
  empty,
}: FilePreviewMenuProps): JSX.Element {
  const [selection, setSelection] = useState('')
  // The web link the right-click landed on, offered to open in either browser.
  const [link, setLink] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  const copy = (): void => {
    if (!selection) return
    void window.api.clipboard.writeText(selection).then(
      () => setCopyError(null),
      (error: unknown) => setCopyError(ipcErrorMessage(error, 'Could not copy.')),
    )
  }

  return (
    <div className="relative h-full min-h-0">
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenuCapture={(event) => {
            setSelection(getSelectedText())
            const href = (event.target as HTMLElement).closest?.('a')?.getAttribute('href')
            setLink(href ? externalLinkUrl(href) : null)
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onClose?.()
          }}
        >
          {link && (
            <>
              <WebLinkMenuItems url={link} testIdPrefix="file-preview-menu" />
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem disabled={!selection} onSelect={copy}>
            <Copy aria-hidden className="h-3.5 w-3.5" />
            Copy
          </ContextMenuItem>
          <ContextMenuItem disabled={empty} onSelect={onSelectAll}>
            <TextSelect aria-hidden className="h-3.5 w-3.5" />
            Select all
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {copyError && (
        <div role="alert" className="absolute bottom-2 left-2 right-2 rounded border border-line bg-panel p-2 text-xs text-danger">
          {copyError}
        </div>
      )}
    </div>
  )
}
