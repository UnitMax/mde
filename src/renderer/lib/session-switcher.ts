import type { Project, Session } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'

export interface SessionSearchItem {
  session: Session
  project?: Project
  order: number
}

export interface SessionSearchMatch {
  item: SessionSearchItem
  score: number
  matches: Partial<Record<SessionSearchField, number[]>>
}

export type SessionSearchField = 'name' | 'project' | 'path' | 'distro'

interface SearchField {
  key: SessionSearchField
  value: string
  weight: number
}

export interface SessionSwitcherShortcutInput {
  type?: string
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

function fieldsFor(item: SessionSearchItem): SearchField[] {
  const { session, project } = item
  return [
    { key: 'name', value: session.name, weight: 100 },
    { key: 'project', value: project?.name ?? '', weight: 65 },
    { key: 'path', value: session.path, weight: 45 },
    { key: 'distro', value: session.distro ?? '', weight: 40 }
  ]
}

export function searchSessions(items: readonly SessionSearchItem[], query: string): SessionSearchMatch[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) {
    return items.map((item) => ({ item, score: 0, matches: {} }))
  }

  return items
    .flatMap((item) => {
      const fields = fieldsFor(item)
      const matches: Partial<Record<SessionSearchField, number[]>> = {}
      let score = 0

      for (const token of tokens) {
        const candidates = fields.flatMap((field) => {
          const match = matchSubsequence(token, field.value)
          return match ? [{ field, match }] : []
        })
        const best = candidates.sort(
          (left, right) => right.match.score + right.field.weight - (left.match.score + left.field.weight)
        )[0]
        if (!best) return []

        score += best.match.score + best.field.weight
        const existing = matches[best.field.key] ?? []
        matches[best.field.key] = [...existing, ...best.match.positions]
      }

      return [{ item, score, matches }]
    })
    .sort((left, right) => right.score - left.score || left.item.order - right.item.order)
}

export function isSessionSwitcherShortcut(input: SessionSwitcherShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    input.key.toLocaleLowerCase() === 'o' &&
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    !input.shiftKey &&
    !input.isComposing
  )
}
