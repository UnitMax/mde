import { describe, expect, it } from 'vitest'
import { imageSize, mayPreviewImage, MAX_PREVIEW_PIXELS } from '../src/main/image-size'

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}

function jpeg(width: number, height: number, frame = 0xc0): Buffer {
  const sof = Buffer.alloc(15)
  sof[0] = 8
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    // Fill bytes before a marker are allowed.
    Buffer.from([0xff]),
    segment(0xdb, Buffer.alloc(65)),
    segment(0xc4, Buffer.alloc(20)),
    segment(frame, sof),
    Buffer.from([0xff, 0xda]),
  ])
}

describe('imageSize', () => {
  it('reads the size of a PNG from its header', () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('reads the size of a baseline or progressive JPEG, past the segments before it', () => {
    expect(imageSize(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 })
    expect(imageSize(jpeg(1200, 800, 0xc2))).toEqual({ width: 1200, height: 800 })
  })

  it('knows no size for other or broken data', () => {
    expect(imageSize(Buffer.from('GIF89a'))).toBeNull()
    expect(imageSize(png(1, 1).subarray(0, 20))).toBeNull()
    expect(imageSize(jpeg(10, 10).subarray(0, 30))).toBeNull()
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda]))).toBeNull()
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toBeNull()
  })
})

describe('mayPreviewImage', () => {
  it('allows an ordinary picture and a large phone photo', () => {
    expect(mayPreviewImage(png(1920, 1080))).toBe(true)
    expect(mayPreviewImage(jpeg(8064, 6048))).toBe(true)
  })

  it('refuses a small file that says it has a huge number of pixels', () => {
    expect(mayPreviewImage(png(50_000, 50_000))).toBe(false)
    expect(mayPreviewImage(jpeg(65_535, 65_535))).toBe(false)
    expect(mayPreviewImage(png(MAX_PREVIEW_PIXELS + 1, 1))).toBe(false)
  })

  it('refuses a picture with no pixels or of unknown size', () => {
    expect(mayPreviewImage(png(0, 100))).toBe(false)
    expect(mayPreviewImage(Buffer.from('not an image'))).toBe(false)
  })
})
