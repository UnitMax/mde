import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  MoveSessionRequest,
  ReorderSessionRequest,
  UpdateProjectRequest,
  UpdateSessionRequest,
  WorkspaceData
} from '@shared/ipc'
import type { NewProject, NewSession, OpenCodeModelSelection, Project, Session } from '@shared/types'
import { isSessionColor } from '@shared/session-colors'

const FILE_NAME = 'workspace.json'

let storeDir: string | null = null
let cache: WorkspaceData | null = null

/** Called once from main/index.ts with app.getPath('userData'). */
export function initWorkspaceStore(dir: string): void {
  storeDir = dir
  cache = null
}

function storeFile(): string {
  if (!storeDir) throw new Error('Workspace store used before initWorkspaceStore()')
  return join(storeDir, FILE_NAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validModelSelection(value: unknown): value is OpenCodeModelSelection {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    isNonEmptyString(record.providerID) &&
    isNonEmptyString(record.modelID) &&
    (record.variant === undefined || isNonEmptyString(record.variant))
  )
}

function validateModelSelections(value: unknown): Record<string, OpenCodeModelSelection> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const selections: Record<string, OpenCodeModelSelection> = {}
  for (const [conversationId, selection] of Object.entries(value)) {
    if (!isNonEmptyString(conversationId) || !validModelSelection(selection)) continue
    selections[conversationId] = {
      providerID: selection.providerID.trim(),
      modelID: selection.modelID.trim(),
      ...(selection.variant?.trim() ? { variant: selection.variant.trim() } : {})
    }
  }
  return Object.keys(selections).length > 0 ? selections : undefined
}

function uniqueEntries<T extends { id: string }>(entries: T[], kind: string): T[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      console.warn(`[workspace] dropping duplicate ${kind} id ${entry.id}`)
      return false
    }
    seen.add(entry.id)
    return true
  })
}

export function validateProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!isNonEmptyString(r.id) || !isNonEmptyString(r.name)) return null

  return {
    id: r.id,
    name: r.name,
    createdAt: isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString()
  }
}

export function validateProjectList(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return []
  return uniqueEntries(
    raw.map(validateProject).filter((project): project is Project => project !== null),
    'project'
  )
}

export function validateSession(raw: unknown, projectIds: Set<string>): Session | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (
    !isNonEmptyString(r.id) ||
    !isNonEmptyString(r.projectId) ||
    !projectIds.has(r.projectId) ||
    !isNonEmptyString(r.name) ||
    (r.mode !== 'terminal' && r.mode !== 'gui') ||
    (r.kind !== 'native' && r.kind !== 'wsl') ||
    !isNonEmptyString(r.path)
  ) {
    return null
  }
  if (r.kind === 'wsl' && !isNonEmptyString(r.distro)) return null

  const session: Session = {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    mode: r.mode,
    kind: r.kind,
    path: r.path,
    createdAt: isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString()
  }
  if (r.kind === 'wsl' && isNonEmptyString(r.distro)) session.distro = r.distro
  if (isSessionColor(r.color)) session.color = r.color
  if (isNonEmptyString(r.shell)) session.shell = r.shell
  if (isNonEmptyString(r.opencodeSessionId)) session.opencodeSessionId = r.opencodeSessionId
  const modelSelections = validateModelSelections(r.opencodeModelSelections)
  if (modelSelections) session.opencodeModelSelections = modelSelections
  return session
}

export function validateSessionList(raw: unknown, projectIds: Set<string>): Session[] {
  if (!Array.isArray(raw)) return []
  return uniqueEntries(
    raw
      .map((entry) => validateSession(entry, projectIds))
      .filter((session): session is Session => session !== null),
    'session'
  )
}

export function validateWorkspace(raw: unknown): WorkspaceData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { projects: [], sessions: [] }
  }
  const record = raw as Record<string, unknown>
  const projects = validateProjectList(record.projects)
  const projectIds = new Set(projects.map((project) => project.id))
  const sessions = validateSessionList(record.sessions, projectIds)
  return { projects, sessions }
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  if (cache) return cache

  let text: string
  try {
    text = await fs.readFile(storeFile(), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[workspace] could not read workspace.json, starting empty:', error)
    }
    cache = { projects: [], sessions: [] }
    return cache
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.warn('[workspace] workspace.json is not valid JSON, starting empty:', error)
    cache = { projects: [], sessions: [] }
    return cache
  }

  cache = validateWorkspace(parsed)
  return cache
}

/** Serialises writes so rapid mutations cannot interleave their renames. */
let writeQueue: Promise<void> = Promise.resolve()

function enqueueWrite(workspace: WorkspaceData): Promise<void> {
  const run = writeQueue.then(() => persist(workspace))
  writeQueue = run.catch(() => undefined)
  return run
}

async function persist(workspace: WorkspaceData): Promise<void> {
  const target = storeFile()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const contents = `${JSON.stringify(workspace, null, 2)}\n`

  await fs.mkdir(storeDir as string, { recursive: true })
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}

export async function createProject(input: NewProject): Promise<Project> {
  const workspace = await loadWorkspace()
  const name = input.name.trim()
  if (!name) throw new Error('Project name cannot be empty')

  const project: Project = { id: randomUUID(), name, createdAt: new Date().toISOString() }
  cache = { ...workspace, projects: [...workspace.projects, project] }
  await enqueueWrite(cache)
  return project
}

export async function updateProject(
  req: UpdateProjectRequest
): Promise<Project | null> {
  const workspace = await loadWorkspace()
  const index = workspace.projects.findIndex((project) => project.id === req.id)
  const existing = workspace.projects[index]
  if (!existing) return null

  const name = req.patch.name?.trim()
  if (!name) return existing
  const updated = { ...existing, name }
  const projects = [...workspace.projects]
  projects[index] = updated
  cache = { ...workspace, projects }
  await enqueueWrite(cache)
  return updated
}

export async function removeProject(id: string): Promise<string[]> {
  const workspace = await loadWorkspace()
  const removedSessionIds = workspace.sessions
    .filter((session) => session.projectId === id)
    .map((session) => session.id)
  cache = {
    projects: workspace.projects.filter((project) => project.id !== id),
    sessions: workspace.sessions.filter((session) => session.projectId !== id)
  }
  await enqueueWrite(cache)
  return removedSessionIds
}

export async function createSession(input: NewSession): Promise<Session> {
  const workspace = await loadWorkspace()
  if (!workspace.projects.some((project) => project.id === input.projectId)) {
    throw new Error('Cannot create a session without a valid project')
  }
  if (input.mode !== 'terminal' && input.mode !== 'gui') {
    throw new Error('Session mode must be terminal or gui')
  }
  if (!input.name.trim() || !input.path.trim()) throw new Error('Session name and path are required')
  if (input.kind === 'wsl' && !input.distro?.trim()) {
    throw new Error('WSL sessions require a distro')
  }

  const session: Session = {
    id: randomUUID(),
    projectId: input.projectId,
    name: input.name.trim(),
    mode: input.mode,
    kind: input.kind,
    path: input.path.trim(),
    createdAt: new Date().toISOString()
  }
  if (input.kind === 'wsl' && input.distro) session.distro = input.distro.trim()
  if (input.shell?.trim()) session.shell = input.shell.trim()

  cache = { ...workspace, sessions: [...workspace.sessions, session] }
  await enqueueWrite(cache)
  return session
}

function duplicateSessionName(name: string, existingNames: Set<string>): string {
  const base = `${name} (copy)`
  if (!existingNames.has(base)) return base

  let suffix = 2
  while (existingNames.has(`${name} (copy ${suffix})`)) suffix += 1
  return `${name} (copy ${suffix})`
}

export async function duplicateSession(id: string): Promise<Session | null> {
  const workspace = await loadWorkspace()
  const source = workspace.sessions.find((session) => session.id === id)
  if (!source || source.mode !== 'terminal') return null

  const existingNames = new Set(
    workspace.sessions
      .filter((session) => session.projectId === source.projectId)
      .map((session) => session.name)
  )
  const session: Session = {
    id: randomUUID(),
    projectId: source.projectId,
    name: duplicateSessionName(source.name, existingNames),
    ...(source.color ? { color: source.color } : {}),
    mode: 'terminal',
    kind: source.kind,
    ...(source.distro ? { distro: source.distro } : {}),
    path: source.path,
    ...(source.shell ? { shell: source.shell } : {}),
    createdAt: new Date().toISOString()
  }

  cache = { ...workspace, sessions: [...workspace.sessions, session] }
  await enqueueWrite(cache)
  return session
}

export async function updateSession(req: UpdateSessionRequest): Promise<Session | null> {
  const workspace = await loadWorkspace()
  const index = workspace.sessions.findIndex((session) => session.id === req.id)
  const existing = workspace.sessions[index]
  if (!existing) return null

  const updated: Session = { ...existing }
  if (req.patch.name?.trim()) updated.name = req.patch.name.trim()
  if (req.patch.path?.trim()) updated.path = req.patch.path.trim()
  if (isSessionColor(req.patch.color)) updated.color = req.patch.color
  if (req.patch.shell !== undefined) {
    if (req.patch.shell.trim()) updated.shell = req.patch.shell.trim()
    else delete updated.shell
  }
  if (req.patch.opencodeSessionId !== undefined) {
    if (req.patch.opencodeSessionId.trim()) updated.opencodeSessionId = req.patch.opencodeSessionId.trim()
    else delete updated.opencodeSessionId
  }
  if (req.patch.opencodeModelSelections !== undefined) {
    const selections = validateModelSelections(req.patch.opencodeModelSelections)
    if (selections) updated.opencodeModelSelections = selections
    else delete updated.opencodeModelSelections
  }

  const sessions = [...workspace.sessions]
  sessions[index] = updated
  cache = { ...workspace, sessions }
  await enqueueWrite(cache)
  return updated
}

export async function moveSession(req: MoveSessionRequest): Promise<Session | null> {
  const workspace = await loadWorkspace()
  if (!workspace.projects.some((project) => project.id === req.projectId)) return null
  const index = workspace.sessions.findIndex((session) => session.id === req.id)
  const existing = workspace.sessions[index]
  if (!existing) return null

  const updated = { ...existing, projectId: req.projectId }
  const sessions = [...workspace.sessions]
  sessions[index] = updated
  cache = { ...workspace, sessions }
  await enqueueWrite(cache)
  return updated
}

/**
 * Reorders a session within its current project while leaving other projects'
 * positions in the flat persisted array untouched.
 */
export function reorderSessionList(
  sessions: readonly Session[],
  req: ReorderSessionRequest
): Session[] | null {
  if (
    !req ||
    typeof req.id !== 'string' ||
    (req.beforeId !== null && typeof req.beforeId !== 'string')
  ) {
    return null
  }

  const source = sessions.find((session) => session.id === req.id)
  if (!source) return null

  const projectEntries = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => session.projectId === source.projectId)

  const remaining = projectEntries
    .filter(({ session }) => session.id !== source.id)
    .map(({ session }) => session)

  let insertionIndex = remaining.length
  if (req.beforeId !== null) {
    insertionIndex = remaining.findIndex((session) => session.id === req.beforeId)
    if (insertionIndex < 0) return null
  }

  const reordered = [...remaining]
  reordered.splice(insertionIndex, 0, source)
  const currentOrder = projectEntries.map(({ session }) => session.id)
  const nextOrder = reordered.map((session) => session.id)
  if (currentOrder.every((id, index) => id === nextOrder[index])) return [...sessions]

  const result = [...sessions]
  projectEntries.forEach(({ index }, position) => {
    const session = reordered[position]
    if (session) result[index] = session
  })
  return result
}

export async function reorderSession(req: ReorderSessionRequest): Promise<Session[] | null> {
  const workspace = await loadWorkspace()
  const sessions = reorderSessionList(workspace.sessions, req)
  if (!sessions) return null

  cache = { ...workspace, sessions }
  await enqueueWrite(cache)
  return sessions
}

export async function removeSession(id: string): Promise<void> {
  const workspace = await loadWorkspace()
  cache = { ...workspace, sessions: workspace.sessions.filter((session) => session.id !== id) }
  await enqueueWrite(cache)
}

export async function getSession(id: string): Promise<Session | null> {
  const workspace = await loadWorkspace()
  return workspace.sessions.find((session) => session.id === id) ?? null
}
