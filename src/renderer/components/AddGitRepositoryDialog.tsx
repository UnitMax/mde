import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderSearch, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'

type Validation = 'idle' | 'checking' | 'ok' | 'missing'

const VALIDATE_DEBOUNCE_MS = 300

interface AddGitRepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function AddGitRepositoryDialog({
  open,
  onOpenChange
}: AddGitRepositoryDialogProps): JSX.Element {
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addGitRepository = useWorkspace((state) => state.addGitRepository)
  const [distro, setDistro] = useState('')
  const [path, setPath] = useState('')
  const [warning, setWarning] = useState<string | undefined>(undefined)
  const [validation, setValidation] = useState<Validation>('idle')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const checkSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setPath('')
    setWarning(undefined)
    setValidation('idle')
    setValidationError(undefined)
    setFormError(undefined)
    setCreating(false)
    setDistro(distros.find((candidate) => candidate.isDefault)?.name ?? distros[0]?.name ?? '')
    if (wslAvailable) void refreshDistros()
    // A distro refresh must not reset a path the user has already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wslAvailable, refreshDistros])

  useEffect(() => {
    if (!distro && distros.length > 0) {
      setDistro(distros.find((candidate) => candidate.isDefault)?.name ?? distros[0]?.name ?? '')
    }
  }, [distros, distro])

  const normalise = useCallback(async () => {
    const rawPath = path.trim()
    if (!rawPath || !distro) return
    try {
      const resolution = await window.api.paths.resolve({
        kind: 'wsl',
        distro,
        rawPath
      })
      setPath(resolution.path)
      setWarning(resolution.warning)
      if (resolution.distro) setDistro(resolution.distro)
    } catch (reason) {
      setFormError(errorMessage(reason, 'Could not resolve that WSL path.'))
    }
  }, [distro, path])

  const browse = async (): Promise<void> => {
    try {
      const picked = await window.api.paths.browse()
      if (!picked) return
      const resolution = await window.api.paths.resolve({
        kind: 'wsl',
        distro,
        rawPath: picked
      })
      setPath(resolution.path)
      setWarning(resolution.warning)
      if (resolution.distro) setDistro(resolution.distro)
    } catch (reason) {
      setFormError(errorMessage(reason, 'Could not resolve that WSL path.'))
    }
  }

  useEffect(() => {
    if (!open) return
    const trimmed = path.trim()
    if (!trimmed || !distro) {
      setValidation('idle')
      setValidationError(undefined)
      return
    }

    setValidation('checking')
    const seq = ++checkSeq.current
    const timer = window.setTimeout(() => {
      void window.api.paths
        .validate({ kind: 'wsl', distro, path: trimmed })
        .then((result) => {
          if (seq !== checkSeq.current) return
          setValidation(result.exists ? 'ok' : 'missing')
          setValidationError(result.error)
        })
        .catch((reason) => {
          if (seq !== checkSeq.current) return
          setValidation('missing')
          setValidationError(errorMessage(reason, 'Could not validate that path.'))
        })
    }, VALIDATE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [distro, open, path])

  const canAdd = Boolean(
    wslAvailable && distro && path.trim() && validation === 'ok' && !creating
  )

  const add = async (): Promise<void> => {
    if (!canAdd) return
    setCreating(true)
    setFormError(undefined)
    try {
      await addGitRepository({ kind: 'wsl', distro, path: path.trim() })
      onOpenChange(false)
    } catch (reason) {
      setFormError(errorMessage(reason, 'Could not add that Git repository.'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canAdd) {
            event.preventDefault()
            void add()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add Git repository</DialogTitle>
          <DialogDescription>
            Add a WSL repository to the Git sidebar. MDE will list its checked-out worktrees without
            changing anything on disk.
          </DialogDescription>
        </DialogHeader>

        {!wslAvailable ? (
          <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs text-warn">
            WSL is unavailable. Git repositories can be added from WSL only for now.
          </p>
        ) : (
          <div className="space-y-3.5">
            {distros.length === 0 ? (
              <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs text-warn">
                No WSL distributions were found.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="git-repository-distro">WSL distribution</Label>
                <Select value={distro} onValueChange={setDistro}>
                  <SelectTrigger id="git-repository-distro">
                    <SelectValue placeholder="Select a distribution" />
                  </SelectTrigger>
                  <SelectContent>
                    {distros.map((candidate) => (
                      <SelectItem key={candidate.name} value={candidate.name}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="git-repository-path">Repository path</Label>
              <div className="flex gap-1.5">
                <Input
                  id="git-repository-path"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value)
                    setFormError(undefined)
                  }}
                  onBlur={() => void normalise()}
                  placeholder="/home/me/src/repository"
                  disabled={!wslAvailable || distros.length === 0}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => void browse()}
                  disabled={!wslAvailable || distros.length === 0}
                  title="Browse for a folder"
                  aria-label="Browse for a folder"
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                </Button>
              </div>
              {warning && <p className="text-xs text-warn">{warning}</p>}
              {validation === 'checking' && (
                <p className="flex items-center gap-1 text-xs text-fg-subtle">
                  <LoaderCircle className="h-3 w-3 animate-spin" /> Checking folder…
                </p>
              )}
              {validation === 'ok' && (
                <p className="text-xs text-ok">Folder found. Git repository discovery will run when added.</p>
              )}
              {validation === 'missing' && (
                <p className="flex items-center gap-1 text-xs text-danger">
                  <TriangleAlert className="h-3 w-3" />
                  {validationError ?? 'Folder not found.'}
                </p>
              )}
            </div>
          </div>
        )}

        {formError && (
          <p className="mt-3 rounded border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
            {formError}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void add()} disabled={!canAdd}>
            {creating && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Add repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
