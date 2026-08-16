import type { TerminalPalette } from '@shared/ipc'

type PaletteSlot = 10 | 11

interface PaletteQuery {
  sequence: string
  slot: PaletteSlot
}

const PALETTE_QUERIES: readonly PaletteQuery[] = [
  { sequence: '\u001b]10;?\u0007', slot: 10 },
  { sequence: '\u001b]10;?\u001b\\', slot: 10 },
  { sequence: '\u001b]11;?\u0007', slot: 11 },
  { sequence: '\u001b]11;?\u001b\\', slot: 11 }
]

export interface TerminalQueryResult {
  data: string
  responses: string[]
}

function toOscRgb(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  const hex = match?.[1]
  if (!hex) throw new Error(`Invalid terminal palette color: ${color}`)
  return [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
    .map((channel) => channel.toLowerCase().repeat(2))
    .join('/')
}

function paletteResponse(slot: PaletteSlot, palette: TerminalPalette): string {
  const color = slot === 10 ? palette.foreground : palette.background
  return `\u001b]${slot};rgb:${toOscRgb(color)}\u001b\\`
}

function pendingQueryLength(data: string): number {
  const maxLength = Math.min(
    data.length,
    Math.max(...PALETTE_QUERIES.map(({ sequence }) => sequence.length - 1))
  )
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = data.slice(-length)
    if (PALETTE_QUERIES.some(({ sequence }) => sequence.startsWith(suffix))) return length
  }
  return 0
}

/** Handles latency-sensitive terminal color queries before renderer IPC. */
export class TerminalQueryResponder {
  private pending = ''

  constructor(private palette: TerminalPalette) {}

  setPalette(palette: TerminalPalette): void {
    this.palette = palette
  }

  flush(): string {
    const data = this.pending
    this.pending = ''
    return data
  }

  process(data: string): TerminalQueryResult {
    let remaining = this.pending + data
    this.pending = ''
    let visible = ''
    const responses: string[] = []

    while (remaining.length > 0) {
      let matchIndex = -1
      let match: PaletteQuery | undefined
      for (const query of PALETTE_QUERIES) {
        const index = remaining.indexOf(query.sequence)
        if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
          matchIndex = index
          match = query
        }
      }
      if (!match || matchIndex < 0) break

      visible += remaining.slice(0, matchIndex)
      responses.push(paletteResponse(match.slot, this.palette))
      remaining = remaining.slice(matchIndex + match.sequence.length)
    }

    visible += remaining
    const pendingLength = pendingQueryLength(visible)
    if (pendingLength > 0) {
      this.pending = visible.slice(-pendingLength)
      visible = visible.slice(0, -pendingLength)
    }

    return { data: visible, responses }
  }
}
