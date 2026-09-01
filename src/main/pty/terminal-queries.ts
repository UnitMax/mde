import { hostname as osHostname } from 'node:os'
import type { TerminalPalette } from '@shared/ipc'

type PaletteSlot = 10 | 11

/**
 * How much of an unterminated OSC sequence to hold back while waiting for its
 * terminator. A stray `ESC ]` with no BEL or ST — a truncated sequence, or a
 * binary file dumped to the terminal — would otherwise swallow every later
 * byte for the life of the PTY. Past this the buffered text is released as
 * ordinary output.
 */
const MAX_PENDING_LENGTH = 4096

/**
 * Upper bound on an OSC 7 payload. Real directory reports are far shorter, and
 * the value is attacker-controlled: any process that can write to the terminal
 * can emit one.
 */
const MAX_OSC7_LENGTH = 4096

/** C0 and C1 controls, including DEL. */
const OSC7_CONTROL = /[\u0000-\u001f\u007f-\u009f]/

export interface TerminalQueryResult {
  data: string
  responses: string[]
  directory?: string
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

/** Handles terminal control sequences before renderer IPC. */
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
    let directory: string | undefined

    while (remaining.length > 0) {
      const start = remaining.indexOf('\u001b]')
      if (start < 0) {
        if (remaining.endsWith('\u001b')) {
          visible += remaining.slice(0, -1)
          this.pending = '\u001b'
        } else {
          visible += remaining
        }
        remaining = ''
        break
      }

      visible += remaining.slice(0, start)
      const terminator = oscTerminator(remaining, start + 2)
      if (!terminator) {
        const unterminated = remaining.slice(start)
        // Give up on this sequence rather than block the pane forever.
        if (unterminated.length > MAX_PENDING_LENGTH) visible += unterminated
        else this.pending = unterminated
        remaining = ''
        break
      }

      const payload = remaining.slice(start + 2, terminator.index)
      const raw = remaining.slice(start, terminator.end)
      const paletteSlot = paletteQuery(payload)
      if (paletteSlot) {
        responses.push(paletteResponse(paletteSlot, this.palette))
      } else if (payload.startsWith('7;')) {
        const reported = parseOsc7Directory(payload.slice(2))
        if (reported) directory = reported
      } else {
        visible += raw
      }
      remaining = remaining.slice(terminator.end)
    }

    return directory ? { data: visible, responses, directory } : { data: visible, responses }
  }
}

function paletteQuery(payload: string): PaletteSlot | null {
  if (payload === '10;?') return 10
  if (payload === '11;?') return 11
  return null
}

function oscTerminator(data: string, start: number): { index: number; end: number } | null {
  const bell = data.indexOf('\u0007', start)
  const st = data.indexOf('\u001b\\', start)
  if (bell < 0 && st < 0) return null
  if (bell >= 0 && (st < 0 || bell < st)) return { index: bell, end: bell + 1 }
  return { index: st, end: st + 2 }
}

function parseOsc7Directory(value: string): string | null {
  if (value.length === 0 || value.length > MAX_OSC7_LENGTH) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  // Only a plain local `file://` URL describes a directory on this machine.
  // A host, port, credentials, query, or fragment means the report is either
  // not local or is carrying data the path does not account for.
  if (url.protocol !== 'file:') return null
  if (url.search || url.hash || url.username || url.password || url.port) return null
  if (!isLocalOsc7Host(url.hostname)) return null

  // Decoded per segment, never as a whole: `%2F` in a segment would otherwise
  // become a separator and turn one name into a path the emitter never named.
  const segments: string[] = []
  for (const segment of url.pathname.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (decoded.includes('/') || decoded.includes('\\')) return null
    if (OSC7_CONTROL.test(decoded)) return null
    // `URL` already resolves literal dot segments, so one here was encoded to
    // survive that resolution.
    if (decoded === '..') return null
    if (decoded === '.' || decoded === '') continue
    segments.push(decoded)
  }

  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}

function isLocalOsc7Host(hostname: string): boolean {
  if (hostname === '' || hostname === 'localhost') return true
  const local = osHostname().toLowerCase()
  return hostname === local || hostname === local.split('.')[0]
}
