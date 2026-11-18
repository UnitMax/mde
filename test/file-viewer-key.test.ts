import { describe, expect, it } from 'vitest'
import { FileViewerKey, isCloseKey } from '../src/main/file-viewer-key'

const press = (init: Partial<{ type: string; key: string; code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({
  type: 'keyDown', key: 'w', code: 'KeyW', control: false, meta: false, alt: false, shift: false, ...init,
})

describe('the close key', () => {
  it('is Ctrl+W on Windows and Linux and Cmd+W on a Mac', () => {
    expect(isCloseKey(press({ control: true }), 'win32')).toBe(true)
    expect(isCloseKey(press({ control: true, key: 'W' }), 'linux')).toBe(true)
    expect(isCloseKey(press({ meta: true }), 'darwin')).toBe(true)
    expect(isCloseKey(press({ control: true }), 'darwin')).toBe(false)
    expect(isCloseKey(press({ meta: true }), 'win32')).toBe(false)
  })

  it('is no other chord, key or key release', () => {
    expect(isCloseKey(press({ control: true, shift: true }), 'win32')).toBe(false)
    expect(isCloseKey(press({ control: true, alt: true }), 'win32')).toBe(false)
    expect(isCloseKey(press({ control: true, key: 'q', code: 'KeyQ' }), 'win32')).toBe(false)
    expect(isCloseKey(press({ control: true, type: 'keyUp' }), 'win32')).toBe(false)
    expect(isCloseKey(press(), 'win32')).toBe(false)
  })
})

describe('the file viewer key', () => {
  it('takes the close key only while a file viewer is open', () => {
    const key = new FileViewerKey('win32')
    expect(key.closes(press({ control: true }))).toBe(false)
    key.setOpen(true)
    expect(key.closes(press({ control: true }))).toBe(true)
    key.setOpen(false)
    expect(key.closes(press({ control: true }))).toBe(false)
  })
})
