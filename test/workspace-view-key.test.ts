import { describe, expect, it } from 'vitest'
import { getWorkspaceViewKeyAction, WorkspaceViewKey } from '../src/main/workspace-view-key'

const key = { type: 'keyDown', key: 'F6', code: 'F6', control: false, meta: false, alt: false, shift: false, isAutoRepeat: false }

describe('getWorkspaceViewKeyAction', () => {
  it('opens Sessions, To Do and the Inbox on F6, F7 and F8', () => {
    expect(getWorkspaceViewKeyAction(key, true)).toBe('sessions')
    expect(getWorkspaceViewKeyAction({ ...key, key: 'F7', code: 'F7' }, true)).toBe('todo')
    expect(getWorkspaceViewKeyAction({ ...key, key: 'F8', code: 'F8' }, true)).toBe('inbox')
  })

  it('reads the physical key when the key name is not reported', () => {
    expect(getWorkspaceViewKeyAction({ ...key, key: 'Unidentified', code: 'F8' }, true)).toBe('inbox')
  })

  it('leaves the keys alone while the full window is not on screen', () => {
    expect(getWorkspaceViewKeyAction(key, false)).toBeNull()
  })

  it('swallows auto-repeat so a held key never reaches a shell', () => {
    expect(getWorkspaceViewKeyAction({ ...key, isAutoRepeat: true }, true)).toBe('ignore')
  })

  it.each([
    ['key release', { type: 'keyUp' }],
    ['Ctrl', { control: true }],
    ['Shift', { shift: true }],
    ['Alt', { alt: true }],
    ['Meta', { meta: true }],
    ['F2, which renames', { key: 'F2', code: 'F2' }],
    ['F5, which reloads a browser page', { key: 'F5', code: 'F5' }],
    ['F9, which is the message box', { key: 'F9', code: 'F9' }],
  ])('ignores %s', (_name, change) => {
    expect(getWorkspaceViewKeyAction({ ...key, ...change }, true)).toBeNull()
  })
})

describe('WorkspaceViewKey', () => {
  it('answers only while the renderer says it is active', () => {
    const viewKey = new WorkspaceViewKey()
    expect(viewKey.action(key)).toBeNull()
    viewKey.setActive(true)
    expect(viewKey.action(key)).toBe('sessions')
    viewKey.setActive(false)
    expect(viewKey.action(key)).toBeNull()
  })
})
