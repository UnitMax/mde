import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  denyDevicePermission,
  denyPermissionCheck,
  denyPermissionRequest,
  installPermissionPolicy,
  type PermissionPolicySession
} from '../src/main/permissions'

const PERMISSIONS = [
  'clipboard-read',
  'clipboard-sanitized-write',
  'display-capture',
  'fullscreen',
  'geolocation',
  'idle-detection',
  'media',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'notifications',
  'pointerLock',
  'keyboardLock',
  'openExternal',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'window-management',
  'fileSystem',
  'hid',
  'serial',
  'usb',
  'unknown',
  'not-a-real-permission'
]

function fakeSession(): {
  session: PermissionPolicySession
  calls: { request: unknown[]; check: unknown[]; device: unknown[] }
} {
  const calls = {
    request: [] as unknown[],
    check: [] as unknown[],
    device: [] as unknown[]
  }
  const session = {
    setPermissionRequestHandler: (handler: unknown) => calls.request.push(handler),
    setPermissionCheckHandler: (handler: unknown) => calls.check.push(handler),
    setDevicePermissionHandler: (handler: unknown) => calls.device.push(handler)
  } as unknown as PermissionPolicySession
  return { session, calls }
}

describe('permission policy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('installs the request, check and device handlers exactly once', () => {
    const { session, calls } = fakeSession()
    installPermissionPolicy(session)

    expect(calls.request).toEqual([denyPermissionRequest])
    expect(calls.check).toEqual([denyPermissionCheck])
    expect(calls.device).toEqual([denyDevicePermission])
  })

  it('denies every permission request', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const permission of PERMISSIONS) {
      const callback = vi.fn()
      denyPermissionRequest(null, permission, callback)
      expect(callback, permission).toHaveBeenCalledExactlyOnceWith(false)
    }
  })

  it('denies every permission check and device grant', () => {
    for (const permission of PERMISSIONS) {
      expect(denyPermissionCheck(), permission).toBe(false)
      expect(denyDevicePermission(), permission).toBe(false)
    }
  })

  it('logs each denied permission only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const permission = 'log-once-test-permission'

    denyPermissionRequest(null, permission, () => {})
    denyPermissionRequest(null, permission, () => {})

    expect(warn).toHaveBeenCalledExactlyOnceWith('[permissions] denied request:', permission)
  })

  it('installs the policy before the first window is created', () => {
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const install = source.indexOf('installPermissionPolicy(session.defaultSession)')
    const firstWindow = source.indexOf('    createWindow()')

    expect(install).toBeGreaterThan(-1)
    expect(firstWindow).toBeGreaterThan(install)
  })
})
