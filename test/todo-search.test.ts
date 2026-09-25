import { describe, expect, it } from 'vitest'
import type { TodoProject, TodoTask } from '../src/shared/types'
import {
  buildTodoSearchItems,
  isTodoSearchShortcut,
  searchTodoTasks,
  todoDescriptionSnippet
} from '../src/renderer/lib/todo-search'

const project: TodoProject = {
  id: 'todo-project-1',
  name: 'Workspace',
  shorthand: 'MDE',
  nextTaskNumber: 20,
  columns: [
    { id: 'todo', name: 'To Do' },
    { id: 'doing', name: 'In Progress' },
    { id: 'done', name: 'Done' }
  ],
  createdAt: '2026-01-01T00:00:00.000Z'
}

function task(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: 'task-1',
    todoProjectId: project.id,
    columnId: 'todo',
    number: 1,
    title: 'Task',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function search(tasks: TodoTask[], query: string): string[] {
  return searchTodoTasks(buildTodoSearchItems(project, tasks), query).map((result) => result.item.task.id)
}

describe('To Do search', () => {
  it('lists every task in board order for an empty query', () => {
    const tasks = [
      task({ id: 'done-1', columnId: 'done', number: 1 }),
      task({ id: 'todo-1', columnId: 'todo', number: 2 }),
      task({ id: 'doing-1', columnId: 'doing', number: 3 }),
      task({ id: 'todo-2', columnId: 'todo', number: 4 }),
      task({ id: 'orphan', columnId: 'missing', number: 5 })
    ]

    expect(search(tasks, '  ')).toEqual(['todo-1', 'todo-2', 'doing-1', 'done-1'])
    const items = buildTodoSearchItems(project, tasks)
    expect(items.map((item) => item.identifier)).toEqual(['MDE-2', 'MDE-4', 'MDE-3', 'MDE-1'])
    expect(items.map((item) => item.columnName)).toEqual(['To Do', 'To Do', 'In Progress', 'Done'])
  })

  it('matches titles as case-insensitive subsequences', () => {
    const tasks = [task({ id: 'search', title: 'Add search palette' }), task({ id: 'other', title: 'Fix tabs' })]
    const results = searchTodoTasks(buildTodoSearchItems(project, tasks), 'srch')

    expect(results.map((result) => result.item.task.id)).toEqual(['search'])
    expect(results[0]?.matches.title).toEqual([4, 7, 8, 9])
  })

  it('matches task identifiers with or without the separator', () => {
    const tasks = [task({ id: 'twelve', number: 12, title: 'Alpha' }), task({ id: 'three', number: 3, title: 'Beta' })]

    expect(search(tasks, '12')).toEqual(['twelve'])
    expect(search(tasks, 'mde-12')).toEqual(['twelve'])
    expect(search(tasks, 'MDE12')).toEqual(['twelve'])
  })

  it('matches descriptions by substring within one line', () => {
    const tasks = [
      task({ id: 'described', title: 'Alpha', description: 'First line\nMention the renderer here' }),
      task({ id: 'scattered', title: 'Beta', description: 'r e n d e r e r' })
    ]
    const results = searchTodoTasks(buildTodoSearchItems(project, tasks), 'render')

    expect(results.map((result) => result.item.task.id)).toEqual(['described'])
    expect(results[0]?.matches.description).toEqual({
      lineIndex: 1,
      line: 'Mention the renderer here',
      positions: [12, 13, 14, 15, 16, 17]
    })
  })

  it('requires every token to match and ranks title matches above description matches', () => {
    const tasks = [
      task({ id: 'in-description', title: 'Alpha', description: 'Keyboard shortcut' }),
      task({ id: 'in-title', title: 'Keyboard shortcut' }),
      task({ id: 'partial', title: 'Keyboard layout' })
    ]

    expect(search(tasks, 'keyboard shortcut')).toEqual(['in-title', 'in-description'])
  })

  it('keeps description highlights on one line across tokens', () => {
    const tasks = [task({ title: 'Alpha', description: 'zeta line\nfoo and bar' })]
    const results = searchTodoTasks(buildTodoSearchItems(project, tasks), 'bar foo')

    expect(results[0]?.matches.description).toEqual({
      lineIndex: 1,
      line: 'foo and bar',
      positions: [8, 9, 10, 0, 1, 2]
    })
  })

  it('trims long description lines to start near the first match', () => {
    const line = `${'x'.repeat(40)} needle`
    const snippet = todoDescriptionSnippet({ lineIndex: 0, line, positions: [41, 42] })

    expect(snippet.text.startsWith('…')).toBe(true)
    expect(snippet.positions.map((position) => snippet.text[position])).toEqual(['n', 'e'])
    expect(todoDescriptionSnippet({ lineIndex: 0, line: 'short needle', positions: [6] })).toEqual({
      text: 'short needle',
      positions: [6]
    })
  })
})

describe('To Do search shortcut', () => {
  const base = { key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }

  it('accepts Ctrl+F and Cmd+F', () => {
    expect(isTodoSearchShortcut({ ...base, ctrlKey: true })).toBe(true)
    expect(isTodoSearchShortcut({ ...base, metaKey: true, type: 'keydown' })).toBe(true)
    expect(isTodoSearchShortcut({ ...base, key: 'а', code: 'KeyF', ctrlKey: true })).toBe(true)
  })

  it('rejects other modifiers, composition, and key releases', () => {
    expect(isTodoSearchShortcut(base)).toBe(false)
    expect(isTodoSearchShortcut({ ...base, key: 'F', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isTodoSearchShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false)
    expect(isTodoSearchShortcut({ ...base, ctrlKey: true, isComposing: true })).toBe(false)
    expect(isTodoSearchShortcut({ ...base, ctrlKey: true, type: 'keyup' })).toBe(false)
  })
})
