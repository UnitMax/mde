import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw'

export function AboutSettingsPanel(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true
    void window.api.app.info().then((value) => {
      if (active) setInfo(value)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="space-y-3" aria-labelledby="about-settings">
      <div>
        <h3 id="about-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {info?.name ?? 'MDE'}
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          {info?.fullName ?? 'Max Development Environment'}
        </p>
      </div>

      <div className="rounded border border-line bg-panel px-3 py-2 text-xs text-fg-muted">
        <p className="font-medium text-fg">Max Development Environment</p>
        <p className="mt-1">Version {info?.version ?? 'Loading…'}</p>
        <p className="mt-1">MDE is licensed under the MIT License.</p>
      </div>

      <section className="flex min-h-0 flex-col" aria-labelledby="third-party-notices">
        <h4 id="third-party-notices" className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Third-party licenses and notices
        </h4>
        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-bg p-3 font-mono text-[10px] leading-relaxed text-fg-muted">
          {thirdPartyNotices}
        </pre>
      </section>
    </section>
  )
}
