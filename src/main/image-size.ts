/**
 * The width and height a PNG or JPEG says it has, read from its header without decoding it.
 *
 * Decoding a picture takes memory for every pixel, whatever the file's size: a small, highly compressed file can say
 * it is 50,000 by 50,000 pixels and so need about 10 GB. A preview is made only of a picture whose size is known and
 * within `MAX_PREVIEW_PIXELS`.
 */

export interface ImageSize {
  width: number
  height: number
}

/** About 200 MB once decoded; a photo from a phone camera fits. */
export const MAX_PREVIEW_PIXELS = 50_000_000

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function pngSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** Start-of-frame markers, which carry the size: every SOFn except DHT (C4), JPG (C8) and DAC (CC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function jpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    // Any number of 0xFF fill bytes may come before a marker.
    while (bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]!
    offset += 1
    // Markers without a length: TEM and the restart markers. The image data ends at EOI or SOS before any size.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      if (offset + 7 > bytes.length) return null
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

export function imageSize(bytes: Buffer): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes)
}

/** Whether a preview may be made of the picture: a PNG or JPEG of a known size, neither empty nor too big. */
export function mayPreviewImage(bytes: Buffer): boolean {
  const size = imageSize(bytes)
  if (!size || size.width === 0 || size.height === 0) return false
  return size.width * size.height <= MAX_PREVIEW_PIXELS
}
