import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FolderSearch, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ProjectKind } from '@shared/types'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useProjects } from '@/store/projects'

type Validation = 'idle' | 'checking' | 'ok' | 'missing'

const VALIDATE_DEBOUNCE_MS = 300

/** Last path segment, tolerating both separators. */
function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps): JSX.Element {
  const platform = useProjects((state) => state.platform)
  const wslAvailable = useProjects((state) => state.wslAvailable)
  const distros = useProjects((state) => state.distros)
  const refreshDistros = useProjects((state) => state.refreshDistros)
  const addProject = useProjects((state) => state.addProject)

  // The location choice only exists on Windows, and only with a working wsl.exe.
  const showLocationChoice = Boolean(platform?.isWindows) && wslAvailable

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [kind, setKind] = useState<ProjectKind>('native')
  const [distro, setDistro] = useState('')
  const [path, setPath] = useState('')
  const [warning, setWarning] = useState<string | undefined>(undefined)
  const [validation, setValidation] = useState<Validation>('idle')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)

  const checkSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setName('')
    setNameTouched(false)
    setKind('native')
    setPath('')
    setWarning(undefined)
    setValidation('idle')
    setValidationError(undefined)
    setCreating(false)
    if (wslAvailable) {
      void refreshDistros()
      setDistro((current) => current || (distros.find((d) => d.isDefault)?.name ?? ''))
    }
    // `distros` is intentionally not a dependency: this is a one-shot reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wslAvailable, refreshDistros])

  useEffect(() => {
    if (!distro && distros.length > 0) {
      setDistro(distros.find((d) => d.isDefault)?.name ?? distros[0]?.name ?? '')
    }
  }, [distros, distro])

  const applyName = useCallback(
    (resolvedPath: string) => {
      if (nameTouched) return
      const base = basename(resolvedPath)
      if (base) setName(base)
    },
    [nameTouched]
  )

  /** Converts whatever is in the field into the format the target stores. */
  const normalise = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return
      const resolution = await window.api.paths.resolve({
        kind,
        ...(distro ? { distro } : {}),
        rawPath: raw
      })
      setPath(resolution.path)
      setWarning(resolution.warning)
      // A \\wsl$\ UNC path names its own distro; trust it over the dropdown.
      if (resolution.distro) setDistro(resolution.distro)
      applyName(resolution.path)
    },
    [kind, distro, applyName]
  )

  const browse = useCallback(async () => {
    const picked = await window.api.paths.browse()
    if (picked) await normalise(picked)
  }, [normalise])

  // Validation is debounced so typing a path does not fire a wsl.exe call per keystroke.
  useEffect(() => {
    if (!open) return
    const trimmed = path.trim()
    if (!trimmed || (kind === 'wsl' && !distro)) {
      setValidation('idle')
      setValidationError(undefined)
      return
    }

    setValidation('checking')
    const seq = ++checkSeq.current
    const timer = window.setTimeout(() => {
      void window.api.paths
        .validate({ kind, ...(distro ? { distro } : {}), path: trimmed })
        .then((result) => {
          if (seq !== checkSeq.current) return
          setValidation(result.exists ? 'ok' : 'missing')
          setValidationError(result.error)
        })
    }, VALIDATE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [open, path, kind, distro])

  const canCreate =
    name.trim().length > 0 &&
    path.trim().length > 0 &&
    validation === 'ok' &&
    (kind === 'native' || distro.length > 0) &&
    !creating

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    try {
      await addProject({
        name: name.trim(),
        kind,
        path: path.trim(),
        ...(kind === 'wsl' ? { distro } : {})
      })
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canCreate) {
            event.preventDefault()
            void create()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Point mde at a folder. It opens a shell there and keeps it alive while the app runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {showLocationChoice && (
            <div className="space-y-1.5">
              <Label>Location</Label>
              <RadioGroup
                value={kind}
                onValueChange={(value) => {
                  setKind(value as ProjectKind)
                  setWarning(undefined)
                }}
              >
                <RadioGroupItem value="native">Windows</RadioGroupItem>
                <RadioGroupItem value="wsl">WSL</RadioGroupItem>
              </RadioGroup>
            </div>
          )}

          {showLocationChoice && kind === 'wsl' && (
            <div className="space-y-1.5">
              <Label>Distro</Label>
              <Select value={distro} onValueChange={setDistro}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a distro" />
                </SelectTrigger>
                <SelectContent>
                  {distros.map((option) => (
                    <SelectItem key={option.name} value={option.name}>
                      {option.name}
                      {option.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {distros.length === 0 && (
                <p className="text-xs text-fg-subtle">No WSL 2 distros found.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="project-path">Path</Label>
            <div className="flex gap-2">
              <Input
                id="project-path"
                value={path}
                spellCheck={false}
                placeholder={kind === 'wsl' ? '/home/me/src/app' : 'Choose a folder'}
                onChange={(event) => setPath(event.target.value)}
                onBlur={(event) => void normalise(event.target.value)}
                className="font-mono"
              />
              <Button variant="secondary" size="default" onClick={() => void browse()}>
                <FolderSearch className="h-3.5 w-3.5" />
                Browse
              </Button>
            </div>

            <div className="flex min-h-4 items-center gap-1.5 text-xs">
              {validation === 'checking' && (
                <>
                  <LoaderCircle className="h-3 w-3 animate-spin text-fg-subtle" />
                  <span className="text-fg-subtle">Checking…</span>
                </>
              )}
              {validation === 'ok' && (
                <>
                  <Check className="h-3 w-3 text-ok" />
                  <span className="text-fg-subtle">
                    Folder found{kind === 'wsl' ? ` in ${distro}` : ''}.
                  </span>
                </>
              )}
              {validation === 'missing' && (
                <>
                  <TriangleAlert className="h-3 w-3 text-danger" />
                  <span className="text-danger">
                    {validationError ?? 'That folder does not exist.'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              placeholder="app"
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
            />
          </div>

          {warning && (
            <div className="flex gap-2 rounded border border-warn/40 bg-warn/10 p-2.5 text-xs leading-relaxed text-warn">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canCreate} onClick={() => void create()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
