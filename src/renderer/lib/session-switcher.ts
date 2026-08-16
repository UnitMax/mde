import type { Project, Session } from '@shared/types'

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

export type SessionSearchField = 'name' | 'project' | 'path' | 'distro' | 'mode'

interface SearchField {
  key: SessionSearchField
  value: string
  weight: number
}

interface SubsequenceMatch {
  score: number
  positions: number[]
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

function normalize(value: string): string {
  return value.toLocaleLowerCase()
}

function queryTokens(query: string): string[] {
  return normalize(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function isWordBoundary(value: string, index: number): boolean {
  return index === 0 || /[\s/\\_.:-]/.test(value[index - 1] ?? '')
}

function matchSubsequence(query: string, value: string): SubsequenceMatch | null {
  const normalizedQuery = normalize(query)
  const normalizedValue = normalize(value)
  if (!normalizedQuery) return { score: 0, positions: [] }

  const positions: number[] = []
  let valueIndex = 0
  let contiguous = 0
  let boundaries = 0

  for (const character of normalizedQuery) {
    const matchIndex = normalizedValue.indexOf(character, valueIndex)
    if (matchIndex < 0) return null
    positions.push(matchIndex)
    const previousPosition = positions[positions.length - 2]
    if (previousPosition !== undefined && matchIndex === previousPosition + 1) {
      contiguous += 1
    }
    if (isWordBoundary(normalizedValue, matchIndex)) boundaries += 1
    valueIndex = matchIndex + 1
  }

  const first = positions[0] ?? 0
  const gaps = positions.reduce((total, position, index) => {
    if (index === 0) return total
    const previousPosition = positions[index - 1]
    return previousPosition === undefined ? total : total + Math.max(0, position - previousPosition - 1)
  }, 0)
  const prefix = first === 0 ? 40 : 0
  const exact = normalizedValue === normalizedQuery ? 100 : 0
  const compactness = Math.max(0, 20 - gaps)

  return {
    score: exact + prefix + contiguous * 8 + boundaries * 5 + compactness,
    positions
  }
}

function fieldsFor(item: SessionSearchItem): SearchField[] {
  const { session, project } = item
  return [
    { key: 'name', value: session.name, weight: 100 },
    { key: 'project', value: project?.name ?? '', weight: 65 },
    { key: 'path', value: session.path, weight: 45 },
    { key: 'distro', value: session.distro ?? '', weight: 40 },
    { key: 'mode', value: session.mode, weight: 25 }
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
