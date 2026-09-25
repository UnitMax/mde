import type { TodoProject, TodoTask } from '@shared/types'
import { todoTaskIdentifier } from '@shared/todo'
import { isWordBoundary, matchSubsequence, normalize, queryTokens } from '@/lib/fuzzy-search'

export interface TodoSearchItem {
  task: TodoTask
  identifier: string
  columnName: string
  order: number
}

export type TodoSearchField = 'title' | 'identifier' | 'description'

export interface TodoDescriptionMatch {
  lineIndex: number
  line: string
  positions: number[]
}

export interface TodoSearchMatch {
  item: TodoSearchItem
  score: number
  matches: {
    title?: number[]
    identifier?: number[]
    description?: TodoDescriptionMatch
  }
}

export interface TodoDescriptionSnippet {
  text: string
  positions: number[]
}

export interface TodoSearchShortcutInput {
  type?: string
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

const TITLE_WEIGHT = 100
const IDENTIFIER_WEIGHT = 80
const DESCRIPTION_WEIGHT = 20
const SNIPPET_LEAD = 24

interface DescriptionTokenMatch {
  score: number
  match: TodoDescriptionMatch
}

export function buildTodoSearchItems(
  project: TodoProject,
  tasks: readonly TodoTask[]
): TodoSearchItem[] {
  return project.columns.flatMap((column) =>
    tasks
      .filter((task) => task.columnId === column.id)
      .map((task) => ({
        task,
        identifier: todoTaskIdentifier(project, task),
        columnName: column.name
      }))
  ).map((item, order) => ({ ...item, order }))
}

// Descriptions are long, so fuzzy subsequence matching would accept nearly
// any short query; require each token to appear verbatim within one line.
function matchDescription(
  token: string,
  description: string,
  preferredLineIndex?: number
): DescriptionTokenMatch | null {
  const lines = description.split(/\r\n|\r|\n/)
  const candidates = preferredLineIndex === undefined
    ? lines.map((_, index) => index)
    : [preferredLineIndex, ...lines.map((_, index) => index).filter((index) => index !== preferredLineIndex)]

  for (const lineIndex of candidates) {
    const line = lines[lineIndex] ?? ''
    const start = normalize(line).indexOf(token)
    if (start < 0) continue
    const positions = Array.from({ length: token.length }, (_, offset) => start + offset)
    const boundary = isWordBoundary(normalize(line), start) ? 10 : 0
    return {
      score: 20 + boundary + token.length * 2,
      match: { lineIndex, line, positions }
    }
  }
  return null
}

export function searchTodoTasks(items: readonly TodoSearchItem[], query: string): TodoSearchMatch[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) {
    return items.map((item) => ({ item, score: 0, matches: {} }))
  }

  return items
    .flatMap((item) => {
      const matches: TodoSearchMatch['matches'] = {}
      let score = 0

      for (const token of tokens) {
        const title = matchSubsequence(token, item.task.title)
        const identifier = matchSubsequence(token, item.identifier)
        const description = matchDescription(
          token,
          item.task.description,
          matches.description?.lineIndex
        )
        const candidates = [
          title && { field: 'title' as const, score: title.score + TITLE_WEIGHT },
          identifier && { field: 'identifier' as const, score: identifier.score + IDENTIFIER_WEIGHT },
          description && { field: 'description' as const, score: description.score + DESCRIPTION_WEIGHT }
        ].filter((candidate): candidate is { field: TodoSearchField; score: number } => candidate !== null)
        const best = candidates.sort((left, right) => right.score - left.score)[0]
        if (!best) return []

        score += best.score
        if (best.field === 'title' && title) {
          matches.title = [...(matches.title ?? []), ...title.positions]
        } else if (best.field === 'identifier' && identifier) {
          matches.identifier = [...(matches.identifier ?? []), ...identifier.positions]
        } else if (best.field === 'description' && description) {
          const existing = matches.description
          matches.description = existing && existing.lineIndex === description.match.lineIndex
            ? { ...existing, positions: [...existing.positions, ...description.match.positions] }
            : existing ?? description.match
        }
      }

      return [{ item, score, matches }]
    })
    .sort((left, right) => right.score - left.score || left.item.order - right.item.order)
}

export function todoDescriptionSnippet(match: TodoDescriptionMatch): TodoDescriptionSnippet {
  const first = Math.min(...match.positions)
  if (first <= SNIPPET_LEAD) return { text: match.line, positions: match.positions }
  const start = first - SNIPPET_LEAD
  return {
    text: `…${match.line.slice(start)}`,
    positions: match.positions.map((position) => position - start + 1)
  }
}

export function isTodoSearchShortcut(input: TodoSearchShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    (input.key.toLocaleLowerCase() === 'f' || input.code === 'KeyF') &&
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    !input.shiftKey &&
    !input.isComposing
  )
}
