import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Code, Eye, FileText, RefreshCw, X } from 'lucide-react'
import type { FileReadResponse, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import { CodeViewer } from '@/components/CodeViewer'
import { MarkdownPreview } from '@/components/MarkdownPreview'
import { cn } from '@/lib/utils'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { MAX_FILE_VIEW_LABEL, formatFileSize, isMarkdownPath } from '@/lib/file-viewer'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; file: FileReadResponse }
  | { status: 'error'; error: string }

interface FileViewerProps {
  session: Session
  /** File path relative to the session root. */
  path: string
  onOpenFile: (path: string) => void
  onClose: () => void
}

function Message({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'danger' }): JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center gap-2 p-6 text-center text-xs',
        tone === 'danger' ? 'text-danger' : 'text-fg-muted'
      )}
    >
      {tone === 'danger' && <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  )
}

export function FileViewer({ session, path, onOpenFile, onClose }: FileViewerProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [showSource, setShowSource] = useState(false)
  const requestSequence = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const markdown = isMarkdownPath(path)

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const file = await window.api.files.read({ sessionId: session.id, path })
      if (sequence === requestSequence.current) setState({ status: 'ready', file })
    } catch (error) {
      if (sequence === requestSequence.current) {
        setState({ status: 'error', error: ipcErrorMessage(error, 'Could not read file.') })
      }
    }
  }, [path, session.id])

  useEffect(() => {
    setShowSource(false)
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  // Take focus from the terminal underneath so keys land in the viewer.
  useEffect(() => {
    rootRef.current?.focus()
  }, [path])

  const segments = path.split('/')

  let body: JSX.Element
  if (state.status === 'loading') {
    body = <Message>Loading…</Message>
  } else if (state.status === 'error') {
    body = <Message tone="danger">{state.error}</Message>
  } else if (state.file.tooLarge) {
    body = (
      <Message>
        {`File is ${formatFileSize(state.file.size)}; previews are limited to ${MAX_FILE_VIEW_LABEL}.`}
      </Message>
    )
  } else if (state.file.binary || state.file.content === null) {
    body = <Message>Binary file — preview not available.</Message>
  } else if (markdown && !showSource) {
    body = <MarkdownPreview path={path} content={state.file.content} onOpenFile={onOpenFile} />
  } else {
    body = <CodeViewer path={path} content={state.file.content} />
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="file-viewer"
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-bg outline-none"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 pr-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-center gap-1 text-[12px]" title={path}>
          {segments.map((segment, index) => (
            <span key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span className="text-fg-subtle">/</span>}
              <span
                className={cn(
                  'truncate',
                  index === segments.length - 1 ? 'font-medium text-fg' : 'text-fg-muted'
                )}
              >
                {segment}
              </span>
            </span>
          ))}
        </div>
        {markdown && (
          <div className="flex shrink-0 items-center rounded border border-line p-0.5" role="group" aria-label="Markdown view">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-6 gap-1 px-2 text-[11px]', !showSource && 'bg-active text-fg')}
              aria-pressed={!showSource}
              onClick={() => setShowSource(false)}
            >
              <Eye className="h-3 w-3" />
              Preview
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-6 gap-1 px-2 text-[11px]', showSource && 'bg-active text-fg')}
              aria-pressed={showSource}
              onClick={() => setShowSource(true)}
            >
              <Code className="h-3 w-3" />
              Source
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => void load()}
          title="Reload file"
          aria-label="Reload file"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onClose}
          title="Close file"
          aria-label="Close file"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}
