import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Folder, House, LoaderCircle } from 'lucide-react'
import type { WslDirectoryListing } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { childFolder, folderCrumbs, parentFolder } from '@/lib/wsl-folder'

/**
 * Chooses a folder inside a WSL distro. The Windows file dialog cannot do this: it shows the
 * Windows drives and reaches a distro only through a `\\wsl.localhost\` path, which is easy to
 * miss and lets people pick a Windows folder that a WSL location cannot use well. This browser lists
 * the distro's own folders (names only, through the main process), starts in the folder already
 * typed or in the distro's home, and hands back a plain Linux path.
 */
export function WslFolderBrowser({
  open,
  onOpenChange,
  distro,
  startPath,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  distro: string
  /** Where to start when it is an absolute Linux path that exists; the distro's home otherwise. */
  startPath?: string
  onChoose: (path: string) => void
}): JSX.Element {
  const [listing, setListing] = useState<WslDirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const sequence = useRef(0)
  const startRef = useRef(startPath)
  const listRef = useRef<HTMLUListElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  startRef.current = startPath

  const load = useCallback(async (path: string | undefined, showHidden: boolean, fallbackToHome = false): Promise<void> => {
    const mine = ++sequence.current
    setLoading(true)
    setError(null)
    const ask = (target: string | undefined): Promise<WslDirectoryListing> =>
      window.api.paths.listWslDirectories({
        distro,
        ...(target ? { path: target } : {}),
        ...(showHidden ? { hidden: true } : {}),
      })
    try {
      let next: WslDirectoryListing
      try {
        next = await ask(path)
      } catch (reason) {
        if (!fallbackToHome || !path) throw reason
        next = await ask(undefined)
      }
      if (mine !== sequence.current) return
      setListing(next)
      if (listRef.current) listRef.current.scrollTop = 0
    } catch (reason) {
      if (mine !== sequence.current) return
      setError(ipcErrorMessage(reason, 'Could not list that folder.'))
    } finally {
      if (mine === sequence.current) setLoading(false)
    }
  }, [distro])

  useEffect(() => {
    if (!open) return
    const start = startRef.current?.trim()
    setListing(null)
    setHidden(false)
    // Each load invalidates the requests before it, so one still on its way from an earlier
    // opening cannot land in this one.
    void load(start?.startsWith('/') ? start : undefined, false, true)
  }, [open, load])

  const crumbs = listing ? folderCrumbs(listing.path) : []
  const parent = listing ? parentFolder(listing.path) : null
  const ready = listing !== null && !loading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="wsl-folder-browser"
        // Radix returns focus only to a Trigger, and this dialog is opened by a button elsewhere:
        // without this, closing it would drop focus on the page and lose the keyboard's place.
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          opener.current?.focus()
          opener.current = null
        }}
      >
        <DialogHeader>
          <DialogTitle>Choose a folder in {distro}</DialogTitle>
          <DialogDescription>Only folders inside this WSL distro are shown.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title="Home folder"
              aria-label="Home folder"
              disabled={loading}
              onClick={() => void load(undefined, hidden)}
            >
              <House className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title="Parent folder"
              aria-label="Parent folder"
              disabled={loading || parent === null}
              onClick={() => parent !== null && void load(parent, hidden)}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <nav aria-label="Folder path" className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-x-0.5 font-mono text-xs">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
                  {index > 1 && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-fg-subtle" />}
                  <button
                    type="button"
                    className="max-w-48 truncate rounded px-1 py-0.5 text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none"
                    title={crumb.path}
                    disabled={loading}
                    aria-current={index === crumbs.length - 1 ? 'location' : undefined}
                    onClick={() => void load(crumb.path, hidden)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
              {!listing && (
                <>
                  {' '}
                  <button type="button" className="underline" onClick={() => void load('/', hidden)}>Browse from /</button>
                </>
              )}
            </p>
          )}

          <div className="relative">
            <ul
              ref={listRef}
              aria-label="Folders"
              aria-busy={loading}
              className={`h-64 overflow-y-auto rounded border border-line bg-bg p-1 ${loading ? 'opacity-60' : ''}`}
            >
              {listing?.directories.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    data-testid="wsl-folder-row"
                    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-fg hover:bg-hover disabled:pointer-events-none"
                    title={name}
                    disabled={loading}
                    onClick={() => void load(childFolder(listing.path, name), hidden)}
                  >
                    <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                </li>
              ))}
              {ready && listing.directories.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-fg-subtle">No folders in here.</li>
              )}
              {ready && listing.truncated && (
                <li className="px-2 py-2 text-center text-[11px] text-fg-subtle">
                  Only the first {listing.directories.length.toLocaleString('en-US')} folders are shown. Type the path instead.
                </li>
              )}
            </ul>
            {loading && (
              <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-fg-muted">
                <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {listing ? 'Loading…' : `Opening ${distro}…`}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked)
                void load(listing?.path, event.target.checked)
              }}
            />
            Show hidden folders
          </label>
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto min-w-0 truncate font-mono text-[11px] text-fg-subtle" title={listing?.path}>
            {listing?.path ?? ''}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" size="sm" disabled={!ready} onClick={() => listing && onChoose(listing.path)}>
            Choose this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
