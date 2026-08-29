import type { TodoProject, TodoTask } from './types'

export function todoTaskIdentifier(project: TodoProject, task: TodoTask): string {
  return `${project.shorthand}-${task.number}`
}
