import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  createTodoTask,
  createTodoProject,
  initWorkspaceStore,
  loadWorkspace,
  moveTodoTask,
  removeTodoProject,
  removeTodoTask,
  updateTodoProject,
  updateTodoTask
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
    const todoProject = await createTodoProject({ name: '  Release plan  ', shorthand: 'REL' })

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
    const project = await createTodoProject({ name: 'Roadmap', shorthand: 'ROAD' })

    initWorkspaceStore(storeDir)

    expect((await loadWorkspace()).todoProjects).toEqual([project])
  })

  it('allocates monotonic task numbers and never reuses a deleted number', async () => {
    const project = await createTodoProject({ name: 'Engineering', shorthand: 'ENG' })
    const first = await createTodoTask({
      todoProjectId: project.id,
      columnId: 'todo',
      title: 'First task',
      description: ''
    })
    await removeTodoTask(first.id)
    const second = await createTodoTask({
      todoProjectId: project.id,
      columnId: 'todo',
      title: 'Second task',
      description: 'Details'
    })

    expect(first.number).toBe(1)
    expect(second.number).toBe(2)
    expect((await loadWorkspace()).todoProjects[0]?.nextTaskNumber).toBe(3)
  })

  it('updates task content and persists movement within and across columns', async () => {
    const project = await createTodoProject({ name: 'Engineering', shorthand: 'ENG' })
    const first = await createTodoTask({
      todoProjectId: project.id,
      columnId: 'todo',
      title: 'First',
      description: ''
    })
    const second = await createTodoTask({
      todoProjectId: project.id,
      columnId: 'todo',
      title: 'Second',
      description: ''
    })
    const inProgress = await createTodoTask({
      todoProjectId: project.id,
      columnId: 'in-progress',
      title: 'Started',
      description: ''
    })

    await moveTodoTask({ id: second.id, columnId: 'todo', beforeId: first.id })
    await moveTodoTask({ id: first.id, columnId: 'in-progress', beforeId: inProgress.id })
    const updated = await updateTodoTask({
      id: second.id,
      patch: { title: 'Renamed', description: 'More context' }
    })

    const tasks = (await loadWorkspace()).todoTasks
    expect(tasks.filter((task) => task.columnId === 'todo').map((task) => task.id)).toEqual([
      second.id
    ])
    expect(tasks.filter((task) => task.columnId === 'in-progress').map((task) => task.id)).toEqual([
      first.id,
      inProgress.id
    ])
    expect(updated).toMatchObject({ title: 'Renamed', description: 'More context' })
  })

  it('requires unique shorthands and cascades task removal with a project', async () => {
    const project = await createTodoProject({ name: 'Engineering', shorthand: 'eng' })
    await expect(createTodoProject({ name: 'Duplicate', shorthand: 'ENG' })).rejects.toThrow(
      'already in use'
    )
    await createTodoTask({
      todoProjectId: project.id,
      columnId: 'todo',
      title: 'Task',
      description: ''
    })
    await updateTodoProject({ id: project.id, patch: { shorthand: 'APP' } })

    expect((await loadWorkspace()).todoProjects[0]?.shorthand).toBe('APP')
    await removeTodoProject(project.id)
    expect((await loadWorkspace()).todoTasks).toEqual([])
  })
})
