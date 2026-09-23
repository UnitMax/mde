import type { Session } from 'electron'

export type PermissionPolicySession = Pick<
  Session,
  'setPermissionRequestHandler' | 'setPermissionCheckHandler' | 'setDevicePermissionHandler'
>

const reportedPermissions = new Set<string>()

/**
 * Refuses a Chromium permission request. MDE uses no permission-gated web API:
 * the clipboard goes through the preload bridge, alerts are raised by the main
 * process, and terminal fullscreen is app state rather than the Fullscreen API.
 * Each permission is logged once so a future feature that needs one fails
 * visibly instead of silently.
 */
export function denyPermissionRequest(
  _webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void
): void {
  if (!reportedPermissions.has(permission)) {
    reportedPermissions.add(permission)
    console.warn('[permissions] denied request:', permission)
  }
  callback(false)
}

export function denyPermissionCheck(): boolean {
  return false
}

/** Covers WebHID, Web Serial and WebUSB device grants, which bypass the request handler. */
export function denyDevicePermission(): boolean {
  return false
}

/**
 * Installs a deny-all permission policy. Without these handlers Electron falls
 * back to defaults that can grant a request. There is deliberately no
 * allowlist; an exception must be added on purpose, with its own test.
 */
export function installPermissionPolicy(session: PermissionPolicySession): void {
  session.setPermissionRequestHandler(denyPermissionRequest)
  session.setPermissionCheckHandler(denyPermissionCheck)
  session.setDevicePermissionHandler(denyDevicePermission)
}
