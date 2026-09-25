export interface SubsequenceMatch {
  score: number
  positions: number[]
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase()
}

export function queryTokens(query: string): string[] {
  return normalize(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function isWordBoundary(value: string, index: number): boolean {
  return index === 0 || /[\s/\\_.:-]/.test(value[index - 1] ?? '')
}

export function matchSubsequence(query: string, value: string): SubsequenceMatch | null {
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
