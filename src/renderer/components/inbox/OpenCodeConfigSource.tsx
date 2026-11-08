import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { validateDraft, type OpenCodeConfigDraft, type OpenCodeConfigTarget } from '@shared/opencode-config'
import { CodeViewer } from '@/components/CodeViewer'
import { ipcErrorMessage } from '@/lib/ipc-error'

type Preview = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'error'; message: string }

/**
 * The file as it would be after Save, read-only. The text comes from the main process, which applies the draft to
 * the file and hides the values of anything that looks like a secret, so this view never holds one.
 */
export function OpenCodeConfigSource({
  target,
  draft,
}: {
  target: OpenCodeConfigTarget
  draft: OpenCodeConfigDraft
}): JSX.Element {
  const [preview, setPreview] = useState<Preview>({ state: 'loading' })
  const problem = validateDraft(draft)
  const { kind, distro } = target

  useEffect(() => {
    if (problem) return
    let current = true
    setPreview((previous) => (previous.state === 'ready' ? previous : { state: 'loading' }))
    window.api.opencodeConfig
      .preview({ kind, ...(distro ? { distro } : {}), draft })
      .then((result) => {
        if (current) setPreview({ state: 'ready', text: result.text })
      })
      .catch((reason) => {
        if (current) setPreview({ state: 'error', message: ipcErrorMessage(reason, 'Could not build the preview.') })
      })
    return () => {
      current = false
    }
  }, [kind, distro, draft, problem])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="opencode-source">
      <p className="text-xs text-fg-muted">
        What the file will hold after you save. It is read-only, and the values of settings that look like secrets are hidden here.
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
        {problem ? (
          <p data-testid="opencode-source-problem" className="p-4 text-[13px] text-fg-muted">
            There is nothing to show yet: {problem}
          </p>
        ) : preview.state === 'error' ? (
          <p role="alert" className="p-4 text-[13px] text-danger">{preview.message}</p>
        ) : preview.state === 'loading' ? (
          <p className="flex items-center gap-2 p-4 text-[13px] text-fg-muted">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Building the preview…
          </p>
        ) : (
          <CodeViewer path="opencode.jsonc" content={preview.text} />
        )}
      </div>
    </div>
  )
}
