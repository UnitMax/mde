import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FolderSearch, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { NewSession, ProjectKind } from '@shared/types'
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
import { useWorkspace } from '@/store/workspace'

type Validation = 'idle' | 'checking' | 'ok' | 'missing'

const VALIDATE_DEBOUNCE_MS = 300

/** Last path segment, tolerating both separators. */
function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

interface AddSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string
  initialValues?: Pick<NewSession, 'kind' | 'distro' | 'path'> & { name?: string }
}

export function AddSessionDialog({
  open,
  onOpenChange,
  defaultProjectId,
  initialValues
}: AddSessionDialogProps): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const projects = useWorkspace((state) => state.projects)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addSession = useWorkspace((state) => state.addSession)

  // The location choice only exists on Windows, and only with a working wsl.exe.
  const showLocationChoice = Boolean(platform?.isWindows) && wslAvailable

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [projectId, setProjectId] = useState('')
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
    setName(initialValues?.name ?? '')
    setNameTouched(false)
    setProjectId(
      defaultProjectId && projects.some((project) => project.id === defaultProjectId)
        ? defaultProjectId
        : (projects[0]?.id ?? '')
    )
    setKind(initialValues?.kind ?? 'native')
    setPath(initialValues?.path ?? '')
    setWarning(undefined)
    setValidation('idle')
    setValidationError(undefined)
    setCreating(false)
    setDistro(
      initialValues?.distro ?? (wslAvailable ? (distros.find((d) => d.isDefault)?.name ?? '') : '')
    )
    if (wslAvailable) void refreshDistros()
    // This resets the form once per open. A distro refresh must not clear fields
    // the user has already entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProjectId, initialValues, projects, wslAvailable, refreshDistros])

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
    projectId.length > 0 &&
    name.trim().length > 0 &&
    path.trim().length > 0 &&
    validation === 'ok' &&
    (kind === 'native' || distro.length > 0) &&
    !creating

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    try {
      await addSession({
        projectId,
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
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Add a terminal session to a project. Each session can point at a different folder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {projects.length === 0 ? (
            <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs text-warn">
              Create a project before adding a session.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
            <Label htmlFor="session-path">Path</Label>
            <div className="flex gap-2">
              <Input
                id="session-path"
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
            <Label htmlFor="session-name">Session name</Label>
            <Input
              id="session-name"
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
