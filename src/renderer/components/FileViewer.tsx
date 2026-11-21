import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Code,
  Columns2,
  Eye,
  FileText,
  FoldHorizontal,
  Maximize2,
  RefreshCw,
  UnfoldHorizontal,
  WrapText,
  X
} from 'lucide-react'
import type { FileReadResponse, Session } from '@shared/types'
import type { FileRoot } from '@shared/ipc'
import { useWorkspace } from '@/store/workspace'
import { Button } from '@/components/ui/button'
import { CodeViewer } from '@/components/CodeViewer'
import { MarkdownPreview } from '@/components/MarkdownPreview'
import { FileFindBar } from '@/components/FileFindBar'
import { seedQuery, type FileFinder } from '@/lib/file-find'
import { cn } from '@/lib/utils'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { MAX_FILE_VIEW_LABEL, formatFileSize, getCodeWrap, isMarkdownPath, saveCodeWrap } from '@/lib/file-viewer'
import {
  getMarkdownPreviewWidth,
  saveMarkdownPreviewWidth,
  type MarkdownPreviewWidth
} from '@/lib/markdown-preview-width'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; file: FileReadResponse }
  | { status: 'error'; error: string }

interface FileViewerProps {
  session: Session
  root?: FileRoot
  /** File path relative to the file root. */
  path: string
  onOpenFile: (path: string) => void
  onClose: () => void
  /** Stands beside the Inbox conversation instead of over it. */
  beside?: boolean
  /** Moves the viewer beside the conversation or back over it; left out where there is no conversation to stand by. */
  onPlace?: (beside: boolean) => void
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

/**
 * Whether the key press is an Escape that closes the file viewer: one nothing else took, with no dialog or menu open,
 * pressed in the viewer or anywhere but a text field or a terminal, whose Escape is their own. A viewer `beside` the
 * conversation closes only on an Escape pressed in it.
 */
export function escapeClosesViewer(event: KeyboardEvent, root: HTMLElement | null, beside = false): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  if (!root || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return false
  const active = document.activeElement
  if (active && root.contains(active)) return true
  // Beside the conversation, Escape elsewhere is the conversation's own.
  if (beside) return false
  if (!active || active === document.body) return true
  if (active.closest('.xterm')) return false
  return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable))
}

export function FileViewer({ session, root: requestedRoot, path, onOpenFile, onClose, beside = false, onPlace }: FileViewerProps): JSX.Element {
  const root = useMemo<FileRoot>(
    () => requestedRoot?.terminalId
      ? { terminalId: requestedRoot.terminalId, directory: requestedRoot.directory }
      : { sessionId: session.id },
    [requestedRoot?.terminalId, requestedRoot?.directory, session.id]
  )
  const terminalReady = useWorkspace((state) => !root.terminalId || (state.statuses[root.terminalId] ?? 'none') !== 'none')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [showSource, setShowSource] = useState(false)
  const [previewWidth, setPreviewWidth] = useState<MarkdownPreviewWidth>(getMarkdownPreviewWidth)
  const [wrap, setWrap] = useState(getCodeWrap)
  const requestSequence = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const finderRef = useRef<FileFinder | null>(null)
  // The search bar (Ctrl+F) while it is open; asking again gives its field the focus, with the selection as the query.
  const [find, setFind] = useState<{ seed: string; signal: number } | null>(null)
  const markdown = isMarkdownPath(path)

  // Ctrl+F (Cmd+F on a Mac) searches the file from anywhere in the viewer, in the rendered Markdown and in source.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'f' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return
      const root = rootRef.current
      const active = document.activeElement
      if (!root || !active || !root.contains(active)) return
      event.preventDefault()
      event.stopPropagation()
      const seed = seedQuery(finderRef.current?.selectedText() ?? '')
      setFind((current) => ({ seed, signal: (current?.signal ?? 0) + 1 }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
  // Escape and Ctrl+W (Cmd+W) close the viewer. The main process takes Ctrl+W before the window menu would close the
  // window, while it knows a viewer is open.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const besideRef = useRef(beside)
  besideRef.current = beside
  useEffect(() => {
    void window.api.fileViewer.setOpen(true)
    const stop = window.api.fileViewer.onClose(() => closeRef.current())
    const onKeyDown = (event: KeyboardEvent): void => {
      if (escapeClosesViewer(event, rootRef.current, besideRef.current)) {
        event.preventDefault()
        closeRef.current()
      }
    }
    // Bubbling, so what Escape closes first inside the viewer (its search bar) keeps it.
    window.addEventListener('keydown', onKeyDown)
    return () => {
      stop()
      window.removeEventListener('keydown', onKeyDown)
      void window.api.fileViewer.setOpen(false)
    }
  }, [])
  const closeFind = useCallback(() => {
    setFind(null)
    const finder = finderRef.current
    requestAnimationFrame(() => (finder ? finder.focus() : rootRef.current?.focus()))
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    if (!terminalReady) return
    try {
      const file = await window.api.files.read({ ...root, path })
      if (sequence === requestSequence.current) setState({ status: 'ready', file })
    } catch (error) {
      if (sequence === requestSequence.current) {
        setState({ status: 'error', error: ipcErrorMessage(error, 'Could not read file.') })
      }
    }
  }, [path, root, terminalReady])

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

  const choosePreviewWidth = (width: MarkdownPreviewWidth): void => {
    setPreviewWidth(width)
    saveMarkdownPreviewWidth(width)
  }

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
    body = (
      <MarkdownPreview
        path={path}
        content={state.file.content}
        width={previewWidth}
        onOpenFile={onOpenFile}
        finderRef={finderRef}
        onFocus={() => rootRef.current?.focus()}
      />
    )
  } else {
    body = <CodeViewer path={path} content={state.file.content} finderRef={finderRef} wrap={wrap} />
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="file-viewer"
      data-beside={beside || undefined}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-bg outline-none"
    >
      {/* Beside the conversation, as tall as the thread's header (a 44 px row above its 1 px border), so the two
          read as one bar. */}
      <div className={cn('flex shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 pr-1.5', beside ? 'h-[45px]' : 'h-9')}>
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
        {markdown && !showSource && (
          <div
            className="flex shrink-0 items-center rounded border border-line p-0.5"
            role="group"
            aria-label="Markdown preview width"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(previewWidth === 'centered' && 'bg-active text-fg')}
              aria-pressed={previewWidth === 'centered'}
              aria-label="Centered"
              title="Centered column"
              onClick={() => choosePreviewWidth('centered')}
            >
              <FoldHorizontal className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(previewWidth === 'full' && 'bg-active text-fg')}
              aria-pressed={previewWidth === 'full'}
              aria-label="Full width"
              title="Fill the whole page"
              onClick={() => choosePreviewWidth('full')}
            >
              <UnfoldHorizontal className="h-3 w-3" />
            </Button>
          </div>
        )}
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
        {/* Source, not the Markdown preview: only text shown as code has lines to wrap. */}
        {state.status === 'ready' && !state.file.tooLarge && !state.file.binary && state.file.content !== null && !(markdown && !showSource) && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('shrink-0', wrap && 'bg-active text-fg')}
            aria-pressed={wrap}
            onClick={() => {
              setWrap(!wrap)
              saveCodeWrap(!wrap)
            }}
            title={wrap ? 'Long lines wrap: click to scroll sideways instead' : 'Wrap long lines'}
            aria-label="Wrap long lines"
            data-testid="file-viewer-wrap"
          >
            <WrapText className="h-3.5 w-3.5" />
          </Button>
        )}
        {onPlace && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => onPlace(!beside)}
            title={beside ? 'Expand over the chat' : 'Open beside the chat'}
            aria-label={beside ? 'Expand over the chat' : 'Open beside the chat'}
            data-testid="file-viewer-place"
          >
            {beside ? <Maximize2 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
          </Button>
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
      <div className="relative min-h-0 flex-1">
        {body}
        {find && (
          <FileFindBar
            finderRef={finderRef}
            version={`${state.status === 'ready' ? state.file.content : state.status}:${showSource}`}
            seed={find.seed}
            focusSignal={find.signal}
            onClose={closeFind}
          />
        )}
      </div>
    </div>
  )
}
