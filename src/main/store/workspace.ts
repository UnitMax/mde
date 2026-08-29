import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  MoveSessionRequest,
  MoveTodoTaskRequest,
  ReorderSessionRequest,
  CreateSessionTabRequest,
  RemoveSessionTabRequest,
  SelectSessionTabRequest,
  UpdateProjectRequest,
  UpdateTodoProjectRequest,
  UpdateTodoTaskRequest,
  UpdateSessionRequest,
  UpdateSessionTabRequest,
  WorkspaceData
} from '@shared/ipc'
import type {
  NewProject,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  PersistedTerminalLayout,
  Project,
  TodoProject,
  TodoColumn,
  TodoTask,
  Session,
  SessionTab,
  TerminalLayout
} from '@shared/types'
import { isSessionColor } from '@shared/session-colors'
import { isSessionIcon } from '@shared/session-icons'

const FILE_NAME = 'workspace.json'

export const DEFAULT_TODO_COLUMNS: readonly TodoColumn[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'done', name: 'Done' }
]

const TODO_SHORTHAND_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

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

export function normalizeTodoShorthand(value: string): string {
  return value.trim().toUpperCase()
}

export function isTodoShorthand(value: string): boolean {
  return TODO_SHORTHAND_PATTERN.test(normalizeTodoShorthand(value))
}

function defaultTodoColumns(): TodoColumn[] {
  return DEFAULT_TODO_COLUMNS.map((column) => ({ ...column }))
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

const TERMINAL_LAYOUT_COUNTS: Record<TerminalLayout, number> = {
  single: 1,
  columns: 2,
  three: 3,
  quadrant: 4,
  fiveGrid: 5,
  threeColumns: 3,
  sixGrid: 6
}

function isTerminalLayout(value: unknown): value is TerminalLayout {
  return value === 'single' || value === 'columns' || value === 'three' || value === 'quadrant' ||
    value === 'fiveGrid' || value === 'threeColumns' || value === 'sixGrid'
}

function ratio(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
    ? value
    : 0.5
}

function validRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
}

function isThreeColumnLayout(layout: TerminalLayout): boolean {
  return layout === 'threeColumns' || layout === 'fiveGrid' || layout === 'sixGrid'
}

function defaultTab(sessionId: string): SessionTab {
  return {
    id: `${sessionId}:tab:default`,
    name: 'Tab 1',
    layout: {
      layout: 'single',
      panes: [{ id: 'pane-1' }],
      sizes: { columnRatio: 0.5, rowRatio: 0.5 }
    }
  }
}

function validateTerminalLayout(raw: unknown): PersistedTerminalLayout | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (!isTerminalLayout(record.layout) || !Array.isArray(record.panes)) return null

  const expectedCount = TERMINAL_LAYOUT_COUNTS[record.layout]
  const panes = record.panes
    .filter((pane): pane is Record<string, unknown> => typeof pane === 'object' && pane !== null)
    .filter((pane) => isNonEmptyString(pane.id))
    .map((pane) => ({
      id: pane.id as string,
      ...(isNonEmptyString(pane.title) ? { title: pane.title.trim() } : {})
    }))
  if (panes.length !== expectedCount || new Set(panes.map((pane) => pane.id)).size !== panes.length) {
    return null
  }

  const sizes = typeof record.sizes === 'object' && record.sizes !== null
    ? record.sizes as Record<string, unknown>
    : {}
  const columnRatio = isThreeColumnLayout(record.layout)
    ? validRatio(sizes.columnRatio) ? sizes.columnRatio : 1 / 3
    : ratio(sizes.columnRatio)
  const secondColumnRatio = isThreeColumnLayout(record.layout)
    ? validRatio(sizes.secondColumnRatio) ? sizes.secondColumnRatio : 2 / 3
    : undefined
  const normalizedColumnRatios = isThreeColumnLayout(record.layout) && columnRatio >= (secondColumnRatio ?? 0)
    ? { columnRatio: 1 / 3, secondColumnRatio: 2 / 3 }
    : { columnRatio, ...(secondColumnRatio === undefined ? {} : { secondColumnRatio }) }
  return {
    layout: record.layout,
    panes,
    sizes: {
      ...normalizedColumnRatios,
      rowRatio: ratio(sizes.rowRatio)
    }
  }
}

function validateSessionTab(raw: unknown): SessionTab | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.name)) return null
  const layout = validateTerminalLayout(record.layout)
  if (!layout) return null
  return { id: record.id, name: record.name.trim(), layout }
}

function sessionTabs(raw: unknown, sessionId: string): { tabs: SessionTab[]; activeTabId: string } {
  const tabs = Array.isArray(raw)
    ? uniqueEntries(
        raw.map(validateSessionTab).filter((tab): tab is SessionTab => tab !== null),
        'session tab'
      )
    : []
  const normalizedTabs = tabs.length > 0 ? tabs : [defaultTab(sessionId)]
  return { tabs: normalizedTabs, activeTabId: normalizedTabs[0]!.id }
}

function nextTabName(tabs: readonly SessionTab[]): string {
  const names = new Set(tabs.map((tab) => tab.name))
  let index = 1
  while (names.has(`Tab ${index}`)) index += 1
  return `Tab ${index}`
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

export function validateTodoProject(raw: unknown): TodoProject | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!isNonEmptyString(r.id) || !isNonEmptyString(r.name)) return null

  const columns = Array.isArray(r.columns)
    ? uniqueEntries(
        r.columns
          .filter((column): column is Record<string, unknown> =>
            typeof column === 'object' && column !== null
          )
          .filter((column) => isNonEmptyString(column.id) && isNonEmptyString(column.name))
          .map((column) => ({ id: column.id as string, name: (column.name as string).trim() })),
        'to-do column'
      )
    : []
  const shorthand = isNonEmptyString(r.shorthand) && isTodoShorthand(r.shorthand)
    ? normalizeTodoShorthand(r.shorthand)
    : null

  return {
    id: r.id,
    name: r.name.trim(),
    shorthand,
    nextTaskNumber:
      typeof r.nextTaskNumber === 'number' && Number.isInteger(r.nextTaskNumber) && r.nextTaskNumber > 0
        ? r.nextTaskNumber
        : 1,
    columns: columns.length > 0 ? columns : defaultTodoColumns(),
    createdAt: isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString()
  }
}

export function validateTodoProjectList(raw: unknown): TodoProject[] {
  if (!Array.isArray(raw)) return []
  const projects = uniqueEntries(
    raw
      .map(validateTodoProject)
      .filter((project): project is TodoProject => project !== null),
    'to-do project'
  )
  const shorthands = new Set<string>()
  return projects.map((project) => {
    if (!project.shorthand || !shorthands.has(project.shorthand)) {
      if (project.shorthand) shorthands.add(project.shorthand)
      return project
    }
    console.warn(`[workspace] clearing duplicate to-do shorthand ${project.shorthand}`)
    return { ...project, shorthand: null }
  })
}

export function validateTodoTask(
  raw: unknown,
  projects: ReadonlyMap<string, TodoProject>
): TodoTask | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (
    !isNonEmptyString(r.id) ||
    !isNonEmptyString(r.todoProjectId) ||
    !isNonEmptyString(r.columnId) ||
    typeof r.number !== 'number' ||
    !Number.isInteger(r.number) ||
    r.number <= 0 ||
    !isNonEmptyString(r.title) ||
    typeof r.description !== 'string'
  ) {
    return null
  }
  const project = projects.get(r.todoProjectId)
  if (!project?.columns.some((column) => column.id === r.columnId)) return null
  const createdAt = isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString()
  return {
    id: r.id,
    todoProjectId: r.todoProjectId,
    columnId: r.columnId,
    number: r.number,
    title: r.title.trim(),
    description: r.description.trim(),
    createdAt,
    updatedAt: isNonEmptyString(r.updatedAt) ? r.updatedAt : createdAt
  }
}

export function validateTodoTaskList(
  raw: unknown,
  projects: ReadonlyMap<string, TodoProject>
): TodoTask[] {
  if (!Array.isArray(raw)) return []
  const seenNumbers = new Set<string>()
  return uniqueEntries(
    raw
      .map((entry) => validateTodoTask(entry, projects))
      .filter((task): task is TodoTask => task !== null)
      .filter((task) => {
        const key = `${task.todoProjectId}:${task.number}`
        if (seenNumbers.has(key)) return false
        seenNumbers.add(key)
        return true
      }),
    'to-do task'
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
    (r.kind !== 'native' && r.kind !== 'wsl') ||
    !isNonEmptyString(r.path)
  ) {
    return null
  }
  if (r.kind === 'wsl' && !isNonEmptyString(r.distro)) return null

  const normalizedTabs = sessionTabs(r.tabs, r.id)
  const session: Session = {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    kind: r.kind,
    path: r.path,
    createdAt: isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString(),
    tabs: normalizedTabs.tabs,
    activeTabId: typeof r.activeTabId === 'string' && normalizedTabs.tabs.some((tab) => tab.id === r.activeTabId)
      ? r.activeTabId
      : normalizedTabs.activeTabId
  }
  if (r.kind === 'wsl' && isNonEmptyString(r.distro)) session.distro = r.distro
  if (isSessionColor(r.color)) session.color = r.color
  if (isSessionIcon(r.icon)) session.icon = r.icon
  if (isNonEmptyString(r.shell)) session.shell = r.shell
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
    return { projects: [], todoProjects: [], todoTasks: [], sessions: [] }
  }
  const record = raw as Record<string, unknown>
  const projects = validateProjectList(record.projects)
  let todoProjects = validateTodoProjectList(record.todoProjects)
  const todoProjectMap = new Map(todoProjects.map((project) => [project.id, project]))
  const todoTasks = validateTodoTaskList(record.todoTasks, todoProjectMap)
  todoProjects = todoProjects.map((project) => {
    const highestNumber = todoTasks
      .filter((task) => task.todoProjectId === project.id)
      .reduce((highest, task) => Math.max(highest, task.number), 0)
    return project.nextTaskNumber > highestNumber
      ? project
      : { ...project, nextTaskNumber: highestNumber + 1 }
  })
  const projectIds = new Set(projects.map((project) => project.id))
  const sessions = validateSessionList(record.sessions, projectIds)
  return { projects, todoProjects, todoTasks, sessions }
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
    cache = { projects: [], todoProjects: [], todoTasks: [], sessions: [] }
    return cache
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.warn('[workspace] workspace.json is not valid JSON, starting empty:', error)
    cache = { projects: [], todoProjects: [], todoTasks: [], sessions: [] }
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
    ...workspace,
    projects: workspace.projects.filter((project) => project.id !== id),
    sessions: workspace.sessions.filter((session) => session.projectId !== id)
  }
  await enqueueWrite(cache)
  return removedSessionIds
}

export async function createTodoProject(input: NewTodoProject): Promise<TodoProject> {
  const workspace = await loadWorkspace()
  const name = input.name.trim()
  if (!name) throw new Error('To Do project name cannot be empty')
  const shorthand = normalizeTodoShorthand(input.shorthand)
  if (!isTodoShorthand(shorthand)) {
    throw new Error('To Do project shorthand must be 2-10 letters or numbers and start with a letter')
  }
  if (workspace.todoProjects.some((project) => project.shorthand === shorthand)) {
    throw new Error(`To Do project shorthand ${shorthand} is already in use`)
  }

  const project: TodoProject = {
    id: randomUUID(),
    name,
    shorthand,
    nextTaskNumber: 1,
    columns: defaultTodoColumns(),
    createdAt: new Date().toISOString()
  }
  cache = { ...workspace, todoProjects: [...workspace.todoProjects, project] }
  await enqueueWrite(cache)
  return project
}

export async function updateTodoProject(
  req: UpdateTodoProjectRequest
): Promise<TodoProject | null> {
  const workspace = await loadWorkspace()
  const index = workspace.todoProjects.findIndex((project) => project.id === req.id)
  const existing = workspace.todoProjects[index]
  if (!existing) return null

  const updated = { ...existing }
  if (req.patch.name !== undefined) {
    const name = req.patch.name.trim()
    if (!name) throw new Error('To Do project name cannot be empty')
    updated.name = name
  }
  if (req.patch.shorthand !== undefined) {
    const shorthand = normalizeTodoShorthand(req.patch.shorthand)
    if (!isTodoShorthand(shorthand)) {
      throw new Error('To Do project shorthand must be 2-10 letters or numbers and start with a letter')
    }
    if (workspace.todoProjects.some(
      (project) => project.id !== existing.id && project.shorthand === shorthand
    )) {
      throw new Error(`To Do project shorthand ${shorthand} is already in use`)
    }
    updated.shorthand = shorthand
  }
  const todoProjects = [...workspace.todoProjects]
  todoProjects[index] = updated
  cache = { ...workspace, todoProjects }
  await enqueueWrite(cache)
  return updated
}

export async function removeTodoProject(id: string): Promise<void> {
  const workspace = await loadWorkspace()
  cache = {
    ...workspace,
    todoProjects: workspace.todoProjects.filter((project) => project.id !== id),
    todoTasks: workspace.todoTasks.filter((task) => task.todoProjectId !== id)
  }
  await enqueueWrite(cache)
}

export async function createTodoTask(input: NewTodoTask): Promise<TodoTask> {
  const workspace = await loadWorkspace()
  const projectIndex = workspace.todoProjects.findIndex(
    (project) => project.id === input.todoProjectId
  )
  const project = workspace.todoProjects[projectIndex]
  if (!project) throw new Error('Cannot create a task without a valid To Do project')
  if (!project.shorthand) throw new Error('Configure a project shorthand before creating tasks')
  if (!project.columns.some((column) => column.id === input.columnId)) {
    throw new Error('Cannot create a task in an invalid column')
  }
  const title = input.title.trim()
  if (!title) throw new Error('Task title cannot be empty')

  const now = new Date().toISOString()
  const task: TodoTask = {
    id: randomUUID(),
    todoProjectId: project.id,
    columnId: input.columnId,
    number: project.nextTaskNumber,
    title,
    description: input.description.trim(),
    createdAt: now,
    updatedAt: now
  }
  const todoProjects = [...workspace.todoProjects]
  todoProjects[projectIndex] = { ...project, nextTaskNumber: project.nextTaskNumber + 1 }
  cache = { ...workspace, todoProjects, todoTasks: [...workspace.todoTasks, task] }
  await enqueueWrite(cache)
  return task
}

export async function updateTodoTask(req: UpdateTodoTaskRequest): Promise<TodoTask | null> {
  const workspace = await loadWorkspace()
  const index = workspace.todoTasks.findIndex((task) => task.id === req.id)
  const existing = workspace.todoTasks[index]
  if (!existing) return null
  const project = workspace.todoProjects.find((candidate) => candidate.id === existing.todoProjectId)
  if (!project) return null

  const updated = { ...existing, updatedAt: new Date().toISOString() }
  if (req.patch.title !== undefined) {
    const title = req.patch.title.trim()
    if (!title) throw new Error('Task title cannot be empty')
    updated.title = title
  }
  if (req.patch.description !== undefined) updated.description = req.patch.description.trim()
  if (req.patch.columnId !== undefined) {
    if (!project.columns.some((column) => column.id === req.patch.columnId)) {
      throw new Error('Cannot move a task to an invalid column')
    }
    updated.columnId = req.patch.columnId
  }

  const todoTasks = workspace.todoTasks.filter((task) => task.id !== existing.id)
  if (updated.columnId === existing.columnId) todoTasks.splice(index, 0, updated)
  else todoTasks.push(updated)
  cache = { ...workspace, todoTasks }
  await enqueueWrite(cache)
  return updated
}

export async function moveTodoTask(req: MoveTodoTaskRequest): Promise<TodoTask[] | null> {
  const workspace = await loadWorkspace()
  const existing = workspace.todoTasks.find((task) => task.id === req.id)
  if (!existing) return null
  const project = workspace.todoProjects.find((candidate) => candidate.id === existing.todoProjectId)
  if (!project?.columns.some((column) => column.id === req.columnId)) return null
  const before = req.beforeId === null
    ? null
    : workspace.todoTasks.find((task) => task.id === req.beforeId)
  if (
    req.beforeId === existing.id ||
    (req.beforeId !== null && (
      !before || before.todoProjectId !== existing.todoProjectId || before.columnId !== req.columnId
    ))
  ) {
    return null
  }

  const moved = { ...existing, columnId: req.columnId, updatedAt: new Date().toISOString() }
  const todoTasks = workspace.todoTasks.filter((task) => task.id !== existing.id)
  if (before) todoTasks.splice(todoTasks.findIndex((task) => task.id === before.id), 0, moved)
  else todoTasks.push(moved)
  cache = { ...workspace, todoTasks }
  await enqueueWrite(cache)
  return todoTasks
}

export async function removeTodoTask(id: string): Promise<void> {
  const workspace = await loadWorkspace()
  cache = { ...workspace, todoTasks: workspace.todoTasks.filter((task) => task.id !== id) }
  await enqueueWrite(cache)
}

export async function createSession(input: NewSession): Promise<Session> {
  const workspace = await loadWorkspace()
  if (!workspace.projects.some((project) => project.id === input.projectId)) {
    throw new Error('Cannot create a session without a valid project')
  }
  if (!input.name.trim() || !input.path.trim()) throw new Error('Session name and path are required')
  if (input.kind === 'wsl' && !input.distro?.trim()) {
    throw new Error('WSL sessions require a distro')
  }

  const session: Session = {
    id: randomUUID(),
    projectId: input.projectId,
    name: input.name.trim(),
    kind: input.kind,
    path: input.path.trim(),
    createdAt: new Date().toISOString(),
    tabs: []
  }
  session.tabs = [defaultTab(session.id)]
  session.activeTabId = session.tabs[0]!.id
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
  if (!source) return null

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
    ...(source.icon ? { icon: source.icon } : {}),
    kind: source.kind,
    ...(source.distro ? { distro: source.distro } : {}),
    path: source.path,
    ...(source.shell ? { shell: source.shell } : {}),
    createdAt: new Date().toISOString(),
    tabs: []
  }
  session.tabs = [defaultTab(session.id)]
  session.activeTabId = session.tabs[0]!.id

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
  if (req.patch.icon === null) delete updated.icon
  else if (isSessionIcon(req.patch.icon)) updated.icon = req.patch.icon
  if (req.patch.shell !== undefined) {
    if (req.patch.shell.trim()) updated.shell = req.patch.shell.trim()
    else delete updated.shell
  }
  const sessions = [...workspace.sessions]
  sessions[index] = updated
  cache = { ...workspace, sessions }
  await enqueueWrite(cache)
  return updated
}

function replaceSession(workspace: WorkspaceData, index: number, updated: Session): void {
  const sessions = [...workspace.sessions]
  sessions[index] = updated
  cache = { ...workspace, sessions }
}

export async function createSessionTab(req: CreateSessionTabRequest): Promise<Session | null> {
  if (!req || typeof req.sessionId !== 'string' || !req.sessionId) return null
  const workspace = await loadWorkspace()
  const index = workspace.sessions.findIndex((session) => session.id === req.sessionId)
  const existing = workspace.sessions[index]
  if (!existing) return null

  const tabs = existing.tabs ?? [defaultTab(existing.id)]
  const tab: SessionTab = {
    id: randomUUID(),
    name: nextTabName(tabs),
    layout: defaultTab(existing.id).layout
  }
  const updated = { ...existing, tabs: [...tabs, tab], activeTabId: tab.id }
  replaceSession(workspace, index, updated)
  await enqueueWrite(cache as WorkspaceData)
  return updated
}

export async function selectSessionTab(req: SelectSessionTabRequest): Promise<Session | null> {
  if (!req || typeof req.sessionId !== 'string' || !req.sessionId || typeof req.tabId !== 'string' || !req.tabId) return null
  const workspace = await loadWorkspace()
  const index = workspace.sessions.findIndex((session) => session.id === req.sessionId)
  const existing = workspace.sessions[index]
  if (!existing) return null
  const tabs = existing.tabs ?? [defaultTab(existing.id)]
  if (!tabs.some((tab) => tab.id === req.tabId)) return null
  if (existing.activeTabId === req.tabId && existing.tabs) return existing

  const updated = { ...existing, tabs, activeTabId: req.tabId }
  replaceSession(workspace, index, updated)
  await enqueueWrite(cache as WorkspaceData)
  return updated
}

export async function updateSessionTab(req: UpdateSessionTabRequest): Promise<Session | null> {
  if (!req || typeof req.sessionId !== 'string' || !req.sessionId || typeof req.tabId !== 'string' || !req.tabId || !req.patch) return null
  const workspace = await loadWorkspace()
  const index = workspace.sessions.findIndex((session) => session.id === req.sessionId)
  const existing = workspace.sessions[index]
  if (!existing) return null
  const tabs = existing.tabs ?? [defaultTab(existing.id)]
  const tabIndex = tabs.findIndex((tab) => tab.id === req.tabId)
  const tab = tabs[tabIndex]
  if (!tab) return null

  const updatedTab: SessionTab = { ...tab }
  if (req.patch.name !== undefined) {
    const name = req.patch.name.trim()
    if (!name) return null
    updatedTab.name = name
  }
  if (req.patch.layout !== undefined) {
    const layout = validateTerminalLayout(req.patch.layout)
    if (!layout) return null
    updatedTab.layout = layout
  }

  const updatedTabs = [...tabs]
  updatedTabs[tabIndex] = updatedTab
  const updated = {
    ...existing,
    tabs: updatedTabs,
    activeTabId: existing.activeTabId && updatedTabs.some((candidate) => candidate.id === existing.activeTabId)
      ? existing.activeTabId
      : updatedTabs[0]!.id
  }
  replaceSession(workspace, index, updated)
  await enqueueWrite(cache as WorkspaceData)
  return updated
}

export async function removeSessionTab(req: RemoveSessionTabRequest): Promise<Session | null> {
  if (!req || typeof req.sessionId !== 'string' || !req.sessionId || typeof req.tabId !== 'string' || !req.tabId) return null
  const workspace = await loadWorkspace()
  const index = workspace.sessions.findIndex((session) => session.id === req.sessionId)
  const existing = workspace.sessions[index]
  if (!existing) return null
  const tabs = existing.tabs ?? [defaultTab(existing.id)]
  if (tabs.length <= 1) return null
  const tabIndex = tabs.findIndex((tab) => tab.id === req.tabId)
  if (tabIndex < 0) return null

  const updatedTabs = tabs.filter((tab) => tab.id !== req.tabId)
  const activeTabId = existing.activeTabId === req.tabId
    ? (updatedTabs[tabIndex] ?? updatedTabs[tabIndex - 1] ?? updatedTabs[0]!).id
    : existing.activeTabId
  const updated = { ...existing, tabs: updatedTabs, activeTabId }
  replaceSession(workspace, index, updated)
  await enqueueWrite(cache as WorkspaceData)
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
