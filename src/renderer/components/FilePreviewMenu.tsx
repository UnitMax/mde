import { useState, type ReactElement } from 'react'
import { Copy, TextSelect } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ipcErrorMessage } from '@/lib/ipc-error'

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
        <ContextMenuTrigger asChild onContextMenuCapture={() => setSelection(getSelectedText())}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onClose?.()
          }}
        >
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
