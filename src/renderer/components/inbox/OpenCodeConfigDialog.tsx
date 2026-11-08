import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { validateDraft, type OpenCodeConfigTarget } from '@shared/opencode-config'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OpenCodeConfigPermissions } from '@/components/inbox/OpenCodeConfigPermissions'
import { OpenCodeConfigProviders } from '@/components/inbox/OpenCodeConfigProviders'
import { OpenCodeConfigSource } from '@/components/inbox/OpenCodeConfigSource'
import { isConfigDirty, useOpenCodeConfig } from '@/store/opencode-config'
import { useWorkspace } from '@/store/workspace'

type Tab = 'permissions' | 'providers' | 'source'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'providers', label: 'Providers' },
  { id: 'source', label: 'Source' },
]

function Banner({ tone, testId, children }: { tone: 'warn' | 'danger'; testId: string; children: ReactNode }): JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-testid={testId}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs text-fg-muted ${
        tone === 'danger' ? 'border-danger/40 bg-danger/10' : 'border-warn/40 bg-warn/10'
      }`}
    >
      {children}
    </div>
  )
}

/**
 * Edits the parts of OpenCode's global configuration that MDE knows how to change: permission rules, custom
 * OpenAI-compatible providers and which providers are disabled. Everything else in the file is left as it is.
 * The forms edit a draft; Save applies it to the file and OpenCode picks the change up by itself.
 */
export function OpenCodeConfigDialog(): JSX.Element {
  const open = useWorkspace((state) => state.opencodeConfigDialog.open)
  const closeDialog = useWorkspace((state) => state.closeOpenCodeConfig)
  const platform = useWorkspace((state) => state.platform)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)

  const target = useOpenCodeConfig((state) => state.target)
  const snapshot = useOpenCodeConfig((state) => state.snapshot)
  const draft = useOpenCodeConfig((state) => state.draft)
  const loading = useOpenCodeConfig((state) => state.loading)
  const saving = useOpenCodeConfig((state) => state.saving)
  const loadError = useOpenCodeConfig((state) => state.loadError)
  const saveError = useOpenCodeConfig((state) => state.saveError)
  const conflict = useOpenCodeConfig((state) => state.conflict)
  const savedAt = useOpenCodeConfig((state) => state.savedAt)
  const dirty = useOpenCodeConfig(isConfigDirty)
  const load = useOpenCodeConfig((state) => state.load)
  const edit = useOpenCodeConfig((state) => state.edit)
  const revert = useOpenCodeConfig((state) => state.revert)
  const save = useOpenCodeConfig((state) => state.save)
  const reset = useOpenCodeConfig((state) => state.reset)

  const wsl = Boolean(platform?.isWindows)
  const [distro, setDistro] = useState('')
  const [tab, setTab] = useState<Tab>('permissions')
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    if (open && wsl) void refreshDistros()
  }, [open, wsl, refreshDistros])

  useEffect(() => {
    if (!open || !wsl || distro) return
    const preferred = distros.find((item) => item.isDefault) ?? distros[0]
    if (preferred) setDistro(preferred.name)
  }, [open, wsl, distro, distros])

  const wanted = useMemo<OpenCodeConfigTarget | null>(
    () => (wsl ? (distro ? { kind: 'wsl', distro } : null) : { kind: 'native' }),
    [wsl, distro]
  )
  const wantedKey = wanted ? `${wanted.kind}:${wanted.distro ?? ''}` : ''

  // Opening reads the file; closing forgets it, so the next opening never shows a stale copy.
  useEffect(() => {
    if (!open) {
      reset()
      setTab('permissions')
      setConfirmDiscard(false)
      return
    }
    if (wanted) void load(wanted)
    // `wanted` is fully described by `wantedKey`.
  }, [open, wantedKey, load, reset])

  const requestClose = (): void => {
    if (dirty && !saving) setConfirmDiscard(true)
    else closeDialog()
  }

  const problem = validateDraft(draft)
  const parseError = snapshot?.parseError ?? null
  const readOnly = parseError !== null || saving
  const canSave = dirty && problem === null && parseError === null && !saving
  const reload = (): void => {
    if (wanted) void load(wanted)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
        <DialogContent
          data-testid="opencode-config-dialog"
          className="flex h-[min(46rem,calc(100vh-2rem))] max-w-4xl flex-col"
          onInteractOutside={(event) => { if (dirty) event.preventDefault() }}
        >
          <DialogHeader className="mb-3 flex flex-row items-start justify-between gap-4 pr-6">
            <div className="min-w-0 space-y-1">
              <DialogTitle>OpenCode configuration</DialogTitle>
              <DialogDescription>
                {snapshot ? (
                  <>
                    <span data-testid="opencode-config-path" className="font-mono">{snapshot.file.displayPath}</span>
                    {snapshot.file.exists ? '' : ' (does not exist yet; Save creates it)'}
                    . Everything in the file that is not shown here stays as it is.
                  </>
                ) : (
                  'Permissions, custom providers and disabled providers for OpenCode.'
                )}
              </DialogDescription>
            </div>
            {wsl && (
              <div className="flex w-48 shrink-0 flex-col gap-1">
                <Label htmlFor="opencode-config-distro" className="text-[11px] text-fg-subtle">WSL distro</Label>
                <Select value={distro} onValueChange={setDistro} disabled={dirty || loading || saving}>
                  <SelectTrigger id="opencode-config-distro" data-testid="opencode-config-distro">
                    <SelectValue placeholder="Choose a distro" />
                  </SelectTrigger>
                  <SelectContent>
                    {distros.map((item) => (
                      <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </DialogHeader>

          {wsl && !distro ? (
            <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[13px] text-fg-muted">
              {distros.length === 0 ? 'No WSL distro was found. OpenCode runs inside one.' : 'Choose the WSL distro OpenCode runs in.'}
            </p>
          ) : loading && !snapshot ? (
            <p className="flex items-center gap-2 px-1 py-6 text-[13px] text-fg-muted">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Reading the configuration…
            </p>
          ) : loadError || !snapshot || !target ? (
            <div className="flex flex-col items-start gap-3">
              <Banner tone="danger" testId="opencode-config-load-error">{loadError ?? 'The configuration has not been read.'}</Banner>
              <Button type="button" variant="secondary" size="sm" data-testid="opencode-config-retry" onClick={reload}>
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          ) : (
            <>
              {(parseError || conflict || snapshot.warnings.length > 0) && (
                <div className="mb-3 flex flex-col gap-2">
                  {parseError && (
                    <Banner tone="danger" testId="opencode-config-parse-error">
                      <span className="min-w-0 flex-1">
                        The file is not valid JSON, so MDE shows nothing from it and will not change it: {parseError}. OpenCode ignores a file like this. Fix it by hand, then reload.
                      </span>
                      <Button type="button" variant="secondary" size="sm" data-testid="opencode-config-reload" onClick={reload}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reload
                      </Button>
                    </Banner>
                  )}
                  {conflict && (
                    <Banner tone="danger" testId="opencode-config-conflict">
                      <span className="min-w-0 flex-1">
                        The file changed on disk after it was loaded, so nothing was saved. Reload it to see the current file; your edits here are then discarded.
                      </span>
                      <Button type="button" variant="secondary" size="sm" data-testid="opencode-config-reload" onClick={reload}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reload
                      </Button>
                    </Banner>
                  )}
                  {snapshot.warnings.map((warning) => (
                    <Banner key={warning} tone="warn" testId="opencode-config-warning">{warning}</Banner>
                  ))}
                </div>
              )}

              <div role="tablist" aria-label="Configuration sections" className="mb-3 flex gap-1 border-b border-line pb-2">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`opencode-config-tab-${item.id}`}
                    aria-selected={tab === item.id}
                    aria-controls={`opencode-config-panel-${item.id}`}
                    data-testid={`opencode-config-tab-${item.id}`}
                    onClick={() => setTab(item.id)}
                    className={`rounded px-3 py-1 text-[13px] transition-colors ${
                      tab === item.id ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Both forms stay mounted, so a half-filled provider survives a look at the Source tab. */}
              <div
                role="tabpanel"
                id="opencode-config-panel-permissions"
                aria-labelledby="opencode-config-tab-permissions"
                className={tab === 'permissions' ? 'min-h-0 flex-1 overflow-y-auto pr-1' : 'hidden'}
              >
                <OpenCodeConfigPermissions
                  rules={draft.permissions}
                  readOnly={readOnly}
                  onChange={(permissions) => edit((current) => ({ ...current, permissions }))}
                />
              </div>
              <div
                role="tabpanel"
                id="opencode-config-panel-providers"
                aria-labelledby="opencode-config-tab-providers"
                className={tab === 'providers' ? 'min-h-0 flex-1 overflow-y-auto pr-1' : 'hidden'}
              >
                <OpenCodeConfigProviders snapshot={snapshot} draft={draft} readOnly={readOnly} onChange={edit} />
              </div>
              {tab === 'source' && (
                <div
                  role="tabpanel"
                  id="opencode-config-panel-source"
                  aria-labelledby="opencode-config-tab-source"
                  className="min-h-0 flex-1"
                >
                  <OpenCodeConfigSource target={target} draft={draft} />
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <p
                  data-testid="opencode-config-status"
                  role={saveError ? 'alert' : 'status'}
                  className={`mr-auto min-w-0 flex-1 text-xs ${saveError ? 'text-danger' : 'text-fg-muted'}`}
                >
                  {saveError ??
                    (problem && dirty
                      ? problem
                      : saving
                        ? 'Saving…'
                        : dirty
                          ? 'Unsaved changes.'
                          : savedAt
                            ? 'Saved. OpenCode applies it within a few seconds; no restart is needed.'
                            : '')}
                </p>
                <Button type="button" variant="ghost" disabled={!dirty || saving} data-testid="opencode-config-revert" onClick={revert}>
                  Revert
                </Button>
                <Button type="button" variant="ghost" data-testid="opencode-config-close" onClick={requestClose}>
                  Close
                </Button>
                <Button type="button" disabled={!canSave} data-testid="opencode-config-save" onClick={() => void save()}>
                  {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>
            The configuration has changes that were not saved. Closing the editor throws them away.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              data-testid="opencode-config-discard"
              onClick={() => {
                setConfirmDiscard(false)
                closeDialog()
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
