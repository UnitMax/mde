/** A function that returns the next number in [0, 1). */
export type Random = () => number

/** A small, fast generator: the same seed always gives the same sequence. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seed from text, so each thread gets a pattern of its own that stays the same between renders. */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random()
}

export function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]!
}

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

export const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** Smooth gradient noise in three dimensions, in about [-1, 1]. The third is usually time. */
export type Noise3 = (x: number, y: number, z: number) => number

export function createNoise3(seed: number): Noise3 {
  const random = mulberry32(seed)
  const permutation = new Uint8Array(512)
  const source = Array.from({ length: 256 }, (_, index) => index)
  for (let index = 255; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[source[index], source[other]] = [source[other]!, source[index]!]
  }
  for (let index = 0; index < 512; index += 1) permutation[index] = source[index & 255]!

  const gradient = (hash: number, x: number, y: number, z: number): number => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  return (x, y, z) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = x - xi
    const yf = y - yi
    const zf = z - zi
    const X = xi & 255
    const Y = yi & 255
    const Z = zi & 255
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)
    const a = permutation[X]! + Y
    const aa = permutation[a]! + Z
    const ab = permutation[a + 1]! + Z
    const b = permutation[X + 1]! + Y
    const ba = permutation[b]! + Z
    const bb = permutation[b + 1]! + Z
    return lerp(
      lerp(
        lerp(gradient(permutation[aa]!, xf, yf, zf), gradient(permutation[ba]!, xf - 1, yf, zf), u),
        lerp(gradient(permutation[ab]!, xf, yf - 1, zf), gradient(permutation[bb]!, xf - 1, yf - 1, zf), u),
        v
      ),
      lerp(
        lerp(gradient(permutation[aa + 1]!, xf, yf, zf - 1), gradient(permutation[ba + 1]!, xf - 1, yf, zf - 1), u),
        lerp(gradient(permutation[ab + 1]!, xf, yf - 1, zf - 1), gradient(permutation[bb + 1]!, xf - 1, yf - 1, zf - 1), u),
        v
      ),
      w
    )
  }
}
