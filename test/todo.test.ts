import { describe, expect, it } from 'vitest'
import { todoTaskIdentifier } from '../src/shared/todo'
import type { TodoProject, TodoTask } from '../src/shared/types'

const project: TodoProject = {
  id: 'project-1',
  name: 'Engineering',
  shorthand: 'ENG',
  nextTaskNumber: 2,
  columns: [{ id: 'todo', name: 'To Do' }],
  createdAt: '2026-01-01T00:00:00.000Z'
}

const task: TodoTask = {
  id: 'task-1',
  todoProjectId: project.id,
  columnId: 'todo',
  number: 1,
  title: 'Ship board',
  description: '',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z'
}

describe('To Do task identifiers', () => {
  it('uses the current project shorthand without changing the task number', () => {
    expect(todoTaskIdentifier(project, task)).toBe('ENG-1')
    expect(todoTaskIdentifier({ ...project, shorthand: 'APP' }, task)).toBe('APP-1')
  })
})
