import type { AppInfo } from './ipc'

export const MDE_APP_NAME = 'MDE'
export const MDE_FULL_NAME = 'Max Development Environment'

export function createAppInfo(version: string): AppInfo {
  return {
    name: MDE_APP_NAME,
    fullName: MDE_FULL_NAME,
    version
  }
}
