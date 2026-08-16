import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    void window.api.app.info().then((value) => {
      if (active) setInfo(value)
    })
    return () => {
      active = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{info?.name ?? 'MDE'}</DialogTitle>
          <DialogDescription>
            {info?.fullName ?? 'Max Development Environment'}
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 rounded border border-line bg-panel px-3 py-2 text-xs text-fg-muted">
          <p className="font-medium text-fg">Max Development Environment</p>
          <p className="mt-1">Version {info?.version ?? 'Loading…'}</p>
          <p className="mt-1">MDE is licensed under the MIT License.</p>
        </div>

        <section className="mt-4 flex min-h-0 flex-1 flex-col">
          <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Third-party licenses and notices
          </h3>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-bg p-3 font-mono text-[10px] leading-relaxed text-fg-muted">
            {thirdPartyNotices}
          </pre>
        </section>
      </DialogContent>
    </Dialog>
  )
}
