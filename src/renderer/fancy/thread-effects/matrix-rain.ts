import { darken, mixRgb, rgba, type FancyPalette, type Rgb } from '@/fancy/color'
import { between, clamp, hashString, mulberry32, type Random } from '@/fancy/random'
import type { RowEffect } from './types'

export interface RainColumn {
  /** Whether anything falls here at all; a share of the columns stay dark so the rain is not a wall. */
  active: boolean
  /** The row the falling head is in; fractional between rows. Above the top (negative) while it waits. */
  head: number
  /** Rows per second. */
  speed: number
  /** How many cells the tail is long. */
  length: number
  /** Seconds left before the column starts again. */
  wait: number
  /** The glyph (an index into the glyph set) in each row. */
  glyphs: number[]
}

export interface RainState {
  columns: RainColumn[]
  rows: number
  glyphCount: number
}

function restart(column: RainColumn, random: Random, rows: number): void {
  column.head = -1
  column.speed = between(random, 4.5, 12)
  column.length = Math.round(between(random, Math.min(4, rows), Math.max(5, rows + 4)))
  column.wait = between(random, 0, 1.8)
}

export function createRain(random: Random, columns: number, rows: number, glyphCount: number): RainState {
  const state: RainState = { columns: [], rows, glyphCount }
  for (let index = 0; index < columns; index += 1) {
    const column: RainColumn = {
      active: random() < 0.8,
      head: 0,
      speed: 0,
      length: 0,
      wait: 0,
      glyphs: Array.from({ length: rows }, () => Math.floor(random() * glyphCount))
    }
    restart(column, random, rows)
    // Start mid-fall so the row is already raining when it appears.
    column.head = between(random, -2, rows + column.length * 0.5)
    column.wait = column.head < 0 ? between(random, 0, 1) : 0
    state.columns.push(column)
  }
  return state
}

/** Moves every column on by `dt` seconds. */
export function stepRain(state: RainState, random: Random, dt: number): void {
  for (const column of state.columns) {
    if (column.wait > 0) {
      column.wait -= dt
      continue
    }
    const before = Math.floor(column.head)
    column.head += column.speed * dt
    for (let row = before + 1; row <= Math.floor(column.head); row += 1) {
      // A new glyph appears in each cell the head enters.
      if (row >= 0 && row < state.rows) column.glyphs[row] = Math.floor(random() * state.glyphCount)
    }
    if (column.head - column.length > state.rows) restart(column, random, state.rows)
  }
  // The odd glyph in a tail changes, as it does in the film.
  if (state.columns.length > 0 && random() < 0.5) {
    const column = state.columns[Math.floor(random() * state.columns.length)]!
    column.glyphs[Math.floor(random() * state.rows)] = Math.floor(random() * state.glyphCount)
  }
}

/** How lit a cell is: 1 at the head, falling off along the tail, 0 ahead of the head and beyond the tail. */
export function rainBrightness(column: RainColumn, row: number): number {
  if (!column.active || column.wait > 0) return 0
  const behind = Math.floor(column.head) - row
  if (behind < 0 || behind >= column.length) return 0
  return (1 - behind / column.length) ** 1.2
}

/** Whether the cell is where the head is. */
export function isRainHead(column: RainColumn, row: number): boolean {
  return column.active && column.wait <= 0 && Math.floor(column.head) === row
}

const KATAKANA = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'
const LATIN = '0123456789ABCDEFZXVK<>=+*:.'
const FONT = "ui-monospace, 'Cascadia Mono', Menlo, Consolas, 'Noto Sans Mono CJK JP', monospace"

let glyphSet: string[] | null = null

/** Whether this system's fonts can draw half-width katakana: they do not when it draws the missing-glyph box. */
function canDrawKatakana(): boolean {
  try {
    const probe = document.createElement('canvas')
    probe.width = 24
    probe.height = 16
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) return false
    const render = (character: string): string => {
      context.clearRect(0, 0, 24, 16)
      context.font = `12px ${FONT}`
      context.fillText(character, 2, 12)
      return Array.from(context.getImageData(0, 0, 24, 16).data).join(',')
    }
    const katakana = render('ｱ')
    // A code point no font has a glyph for: the page then draws its missing-glyph box, or nothing.
    return katakana !== render('\u{10FFFE}') && katakana !== render('ﾝ')
  } catch {
    return false
  }
}

/** The glyphs that fall: katakana and digits where the fonts can draw katakana, digits and letters where they cannot. */
export function rainGlyphs(): string[] {
  if (!glyphSet) glyphSet = [...(canDrawKatakana() ? KATAKANA + '0123456789' : LATIN)]
  return glyphSet
}

export const CELL_WIDTH = 8
export const CELL_HEIGHT = 10

const atlases = new Map<string, HTMLCanvasElement>()

/** Every glyph in one color, side by side, at the device's resolution; the rain stamps from it. */
function glyphAtlas(glyphs: readonly string[], color: Rgb, scale: number): HTMLCanvasElement | null {
  const key = `${glyphs.length}:${color.join(',')}:${scale}`
  const cached = atlases.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  const cell = { width: Math.ceil(CELL_WIDTH * scale), height: Math.ceil(CELL_HEIGHT * scale) }
  canvas.width = cell.width * glyphs.length
  canvas.height = cell.height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = rgba(color, 1)
  context.font = `${Math.round(9.5 * scale)}px ${FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  glyphs.forEach((glyph, index) => context.fillText(glyph, index * cell.width + cell.width / 2, cell.height / 2 + scale * 0.5))
  if (atlases.size > 12) atlases.clear()
  atlases.set(key, canvas)
  return canvas
}

const glows = new Map<string, HTMLCanvasElement>()

/** A soft round light in the rain's color, stamped under each falling head. */
function headGlow(color: Rgb, scale: number): HTMLCanvasElement | null {
  const key = `${color.join(',')}:${scale}`
  const cached = glows.get(key)
  if (cached) return cached
  const size = Math.ceil(22 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, rgba(color, 0.9))
  gradient.addColorStop(0.35, rgba(color, 0.25))
  gradient.addColorStop(1, rgba(color, 0))
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  if (glows.size > 12) glows.clear()
  glows.set(key, canvas)
  return canvas
}

/**
 * The effect on a working thread: digital rain. Columns of glyphs fall through the row, each with a white-hot head
 * and a green tail that fades; a band of light sweeps down the row, and a packet of light runs along its lower
 * edge as if the work were being carried off.
 */
export function createMatrixRainEffect(palette: FancyPalette, seed: string, devicePixelRatio = 1): RowEffect {
  const dark = palette.mode === 'dark'
  const random = mulberry32(hashString(`rain:${seed}`))
  const body: Rgb = dark ? palette.ok : darken(palette.ok, 0.12)
  const head: Rgb = dark ? mixRgb(palette.ok, [255, 255, 255], 0.82) : darken(palette.ok, 0.45)
  const glyphs = rainGlyphs()
  const scale = Math.min(2, Math.max(1, devicePixelRatio))

  let width = 0
  let height = 0
  let state = createRain(random, 1, 1, glyphs.length)
  let lastTime: number | null = null
  let accumulated = 0
  const phase = random() * 10

  const paintRain = (context: CanvasRenderingContext2D): void => {
    const bodyAtlas = glyphAtlas(glyphs, body, scale)
    const headAtlas = glyphAtlas(glyphs, head, scale)
    if (!bodyAtlas || !headAtlas) return
    const cellWidth = Math.ceil(CELL_WIDTH * scale)
    const cellHeight = Math.ceil(CELL_HEIGHT * scale)
    const offsetX = (width - state.columns.length * CELL_WIDTH) / 2
    state.columns.forEach((column, columnIndex) => {
      for (let row = 0; row < state.rows; row += 1) {
        const brightness = rainBrightness(column, row)
        if (brightness <= 0) continue
        const glyph = column.glyphs[row]!
        const atX = offsetX + columnIndex * CELL_WIDTH
        const atY = row * CELL_HEIGHT
        if (isRainHead(column, row)) {
          // The head glows: a soft round light under a bright glyph.
          const glowSprite = headGlow(body, scale)
          if (glowSprite) {
            context.globalAlpha = dark ? 0.7 : 0.5
            context.drawImage(glowSprite, atX + CELL_WIDTH / 2 - 11, atY + CELL_HEIGHT / 2 - 11, 22, 22)
          }
          context.globalAlpha = 0.9
          context.drawImage(headAtlas, glyph * cellWidth, 0, cellWidth, cellHeight, atX, atY, CELL_WIDTH, CELL_HEIGHT)
        } else {
          context.globalAlpha = (dark ? 0.6 : 0.5) * brightness
          context.drawImage(bodyAtlas, glyph * cellWidth, 0, cellWidth, cellHeight, atX, atY, CELL_WIDTH, CELL_HEIGHT)
        }
      }
    })
    context.globalAlpha = 1
  }

  const paintFrame = (context: CanvasRenderingContext2D, time: number): void => {
    context.clearRect(0, 0, width, height)
    context.globalCompositeOperation = dark ? 'lighter' : 'source-over'

    // A faint green cast over the row, a little deeper toward the bottom.
    const cast = context.createLinearGradient(0, 0, 0, height)
    cast.addColorStop(0, rgba(body, 0.03))
    cast.addColorStop(1, rgba(body, dark ? 0.1 : 0.08))
    context.fillStyle = cast
    context.fillRect(0, 0, width, height)

    paintRain(context)

    // The sweep: a soft band of light running down the row and starting again.
    const period = 2.6
    const sweep = ((time + phase) % period) / period
    const bandY = -10 + sweep * (height + 20)
    const band = context.createLinearGradient(0, bandY - 9, 0, bandY + 9)
    band.addColorStop(0, rgba(head, 0))
    band.addColorStop(0.5, rgba(head, dark ? 0.1 : 0.07))
    band.addColorStop(1, rgba(head, 0))
    context.fillStyle = band
    context.fillRect(0, bandY - 9, width, 18)

    // The packet: a short bright dash running along the bottom edge, with a dim line under it.
    context.fillStyle = rgba(body, 0.22)
    context.fillRect(0, height - 1, width, 1)
    const run = (((time * 0.55 + phase * 0.13) % 1) + 1) % 1
    const dashX = -40 + run * (width + 80)
    const dash = context.createLinearGradient(dashX - 40, 0, dashX, 0)
    dash.addColorStop(0, rgba(head, 0))
    dash.addColorStop(1, rgba(head, 0.95))
    context.fillStyle = dash
    context.fillRect(dashX - 40, height - 1.5, 40, 1.5)

    context.globalCompositeOperation = 'source-over'
  }

  return {
    resize: (cssWidth, cssHeight) => {
      width = cssWidth
      height = cssHeight
      state = createRain(random, Math.max(1, Math.floor(width / CELL_WIDTH)), Math.max(1, Math.ceil(height / CELL_HEIGHT)), glyphs.length)
    },
    draw: (context, time) => {
      if (width === 0) return
      // The rain falls in steps, as it does on the screens it comes from, so it advances at a fixed rate.
      const dt = lastTime === null ? 0 : clamp(time - lastTime, 0, 0.25)
      lastTime = time
      accumulated += dt
      const tick = 1 / 30
      while (accumulated >= tick) {
        stepRain(state, random, tick)
        accumulated -= tick
      }
      paintFrame(context, time)
    },
    still: (context) => {
      if (width === 0) return
      for (let index = 0; index < 40; index += 1) stepRain(state, random, 1 / 20)
      paintFrame(context, 1.1)
    }
  }
}
