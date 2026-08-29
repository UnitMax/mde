import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  createTodoProject,
  initWorkspaceStore,
  loadWorkspace,
  removeTodoProject,
  updateTodoProject
} from '../src/main/store/workspace'

describe('To Do project persistence', () => {
  let storeDir: string

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(join(tmpdir(), 'mde-workspace-todo-'))
    initWorkspaceStore(storeDir)
  })

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true })
  })

  it('creates, renames, and removes To Do projects independently', async () => {
    const terminalProject = await createProject({ name: 'Terminal work' })
    const todoProject = await createTodoProject({ name: '  Release plan  ' })

    expect(todoProject.name).toBe('Release plan')
    expect(await updateTodoProject({
      id: todoProject.id,
      patch: { name: 'Launch plan' }
    })).toMatchObject({ id: todoProject.id, name: 'Launch plan' })

    await removeTodoProject(todoProject.id)

    const workspace = await loadWorkspace()
    expect(workspace.todoProjects).toEqual([])
    expect(workspace.projects).toEqual([terminalProject])
  })

  it('persists To Do projects across store reloads', async () => {
    const project = await createTodoProject({ name: 'Roadmap' })

    initWorkspaceStore(storeDir)

    expect((await loadWorkspace()).todoProjects).toEqual([project])
  })
})
