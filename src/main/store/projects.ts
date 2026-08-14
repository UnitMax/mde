import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { NewProject, Project } from '@shared/types'

const FILE_NAME = 'projects.json'

let storeDir: string | null = null
let cache: Project[] | null = null

/** Called once from main/index.ts with app.getPath('userData'). */
export function initProjectStore(dir: string): void {
  storeDir = dir
  cache = null
}

function storeFile(): string {
  if (!storeDir) throw new Error('Project store used before initProjectStore()')
  return join(storeDir, FILE_NAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Coerces one entry from disk into a Project, or returns null if it is beyond
 * saving. Callers drop nulls with a warning rather than throwing, so one bad
 * entry cannot make the whole project list unreadable.
 */
export function validateProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  if (!isNonEmptyString(r.id)) return null
  if (!isNonEmptyString(r.name)) return null
  if (r.kind !== 'native' && r.kind !== 'wsl') return null
  if (!isNonEmptyString(r.path)) return null
  if (r.kind === 'wsl' && !isNonEmptyString(r.distro)) return null

  const project: Project = {
    id: r.id,
    name: r.name,
    kind: r.kind,
    path: r.path,
    createdAt: isNonEmptyString(r.createdAt) ? r.createdAt : new Date(0).toISOString()
  }
  if (r.kind === 'wsl' && isNonEmptyString(r.distro)) project.distro = r.distro
  if (isNonEmptyString(r.shell)) project.shell = r.shell
  return project
}

export function validateProjectList(raw: unknown): Project[] {
  if (!Array.isArray(raw)) {
    console.warn('[projects] projects.json did not contain an array; starting empty')
    return []
  }
  const seen = new Set<string>()
  const projects: Project[] = []
  for (const entry of raw) {
    const project = validateProject(entry)
    if (!project) {
      console.warn('[projects] dropping malformed project entry:', JSON.stringify(entry))
      continue
    }
    if (seen.has(project.id)) {
      console.warn(`[projects] dropping duplicate project id ${project.id}`)
      continue
    }
    seen.add(project.id)
    projects.push(project)
  }
  return projects
}

export async function loadProjects(): Promise<Project[]> {
  if (cache) return cache

  let text: string
  try {
    text = await fs.readFile(storeFile(), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[projects] could not read projects.json, starting empty:', error)
    }
    cache = []
    return cache
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.warn('[projects] projects.json is not valid JSON, starting empty:', error)
    cache = []
    return cache
  }

  cache = validateProjectList(parsed)
  return cache
}

/** Serialises writes so two rapid mutations cannot interleave their renames. */
let writeQueue: Promise<void> = Promise.resolve()

function enqueueWrite(projects: Project[]): Promise<void> {
  const run = writeQueue.then(() => persist(projects))
  // Keep the chain alive even if one write fails.
  writeQueue = run.catch(() => undefined)
  return run
}

async function persist(projects: Project[]): Promise<void> {
  const target = storeFile()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const contents = `${JSON.stringify(projects, null, 2)}\n`

  await fs.mkdir(storeDir as string, { recursive: true })
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    // Flush before the rename so a crash cannot leave a renamed-but-empty file.
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}

export async function createProject(input: NewProject): Promise<Project> {
  const projects = await loadProjects()
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    kind: input.kind,
    path: input.path,
    createdAt: new Date().toISOString()
  }
  if (input.kind === 'wsl' && input.distro) project.distro = input.distro
  if (input.shell) project.shell = input.shell

  cache = [...projects, project]
  await enqueueWrite(cache)
  return project
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'path' | 'shell'>>
): Promise<Project | null> {
  const projects = await loadProjects()
  const index = projects.findIndex((p) => p.id === id)
  const existing = projects[index]
  if (!existing) return null

  const updated: Project = { ...existing }
  if (patch.name !== undefined && patch.name.trim().length > 0) updated.name = patch.name.trim()
  if (patch.path !== undefined && patch.path.length > 0) updated.path = patch.path
  if (patch.shell !== undefined) {
    if (patch.shell) updated.shell = patch.shell
    else delete updated.shell
  }

  const next = [...projects]
  next[index] = updated
  cache = next
  await enqueueWrite(cache)
  return updated
}

export async function removeProject(id: string): Promise<void> {
  const projects = await loadProjects()
  cache = projects.filter((p) => p.id !== id)
  await enqueueWrite(cache)
}

export async function getProject(id: string): Promise<Project | null> {
  const projects = await loadProjects()
  return projects.find((p) => p.id === id) ?? null
}
