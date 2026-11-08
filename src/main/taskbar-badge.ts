import { ATTENTION_COUNT_LIMIT, type AlertKind } from '@shared/taskbar-attention'

/** Windows draws a taskbar overlay icon at 16 x 16 device-independent pixels. */
export const BADGE_SIZE = 16

type Color = readonly [number, number, number]

/** The disc behind the number, and the number's colour: dark on the yellow, white on the others. */
const BADGE_COLORS: Record<AlertKind, { disc: Color; ink: Color }> = {
  failed: { disc: [220, 38, 38], ink: [255, 255, 255] },
  input: { disc: [245, 184, 0], ink: [32, 24, 0] },
  done: { disc: [22, 150, 70], ink: [255, 255, 255] }
}

/** Digits as 3 x 5 pixels, one string per row. */
const DIGITS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
}

/** Pixels of the number, as x/y cells of the badge: one digit drawn double size, two digits at the font's own size. */
function numberPixels(count: number): Array<[number, number]> {
  const text = String(Math.max(0, Math.min(ATTENTION_COUNT_LIMIT, Math.floor(count))))
  const scale = text.length === 1 ? 2 : 1
  const gap = text.length === 1 ? 0 : 1
  const width = text.length * 3 * scale + (text.length - 1) * gap
  const height = 5 * scale
  const left = Math.round((BADGE_SIZE - width) / 2)
  const top = Math.round((BADGE_SIZE - height) / 2)
  const pixels: Array<[number, number]> = []
  Array.from(text).forEach((digit, index) => {
    const rows = DIGITS[digit] ?? DIGITS['0']!
    const origin = left + index * (3 * scale + gap)
    rows.forEach((row, y) => {
      Array.from(row).forEach((cell, x) => {
        if (cell !== '1') return
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) pixels.push([origin + x * scale + dx, top + y * scale + dy])
        }
      })
    })
  })
  return pixels
}

/**
 * The badge as raw pixels (BGRA, premultiplied, row by row), which `nativeImage.createFromBitmap` takes: a
 * coloured disc with the number on it. Drawn here so that no image file or font has to ship with the app.
 */
export function badgeBitmap(tone: AlertKind, count: number): Buffer {
  const { disc, ink } = BADGE_COLORS[tone]
  const bitmap = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4)
  const inked = new Set(numberPixels(count).map(([x, y]) => y * BADGE_SIZE + x))
  const middle = BADGE_SIZE / 2
  const radius = middle - 0.5
  for (let y = 0; y < BADGE_SIZE; y += 1) {
    for (let x = 0; x < BADGE_SIZE; x += 1) {
      // Coverage of the disc by 4 x 4 samples inside the pixel, so the edge is smooth.
      let covered = 0
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const dx = x + (sx + 0.5) / 4 - middle
          const dy = y + (sy + 0.5) / 4 - middle
          if (dx * dx + dy * dy <= radius * radius) covered += 1
        }
      }
      const alpha = covered / 16
      const [red, green, blue] = inked.has(y * BADGE_SIZE + x) ? ink : disc
      const offset = (y * BADGE_SIZE + x) * 4
      bitmap[offset] = Math.round(blue * alpha)
      bitmap[offset + 1] = Math.round(green * alpha)
      bitmap[offset + 2] = Math.round(red * alpha)
      bitmap[offset + 3] = Math.round(alpha * 255)
    }
  }
  return bitmap
}
