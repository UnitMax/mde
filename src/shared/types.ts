export type ProjectKind = 'native' | 'wsl'

export interface Project {
  id: string
  name: string
  kind: ProjectKind
  /** Required when kind === 'wsl', e.g. "Ubuntu-24.04". */
  distro?: string
  /**
   * Absolute path in the TARGET's own format:
   *   native on Windows -> "C:\\src\\app"
   *   native on Linux   -> "/home/me/src/app"
   *   wsl               -> "/home/me/src/app"
   */
  path: string
  /** Optional shell override; default is resolved per platform. */
  shell?: string
  createdAt: string
}

export type NewProject = Omit<Project, 'id' | 'createdAt'>

export interface Distro {
  name: string
  state: string
  version: number
  isDefault: boolean
}

/** Lifecycle of the PTY belonging to a project, as tracked by the main process. */
export type PtyStatus = 'none' | 'running' | 'exited'

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyExitInfo {
  projectId: string
  exitCode: number
  signal?: number
}

export interface PtyDataChunk {
  projectId: string
  data: string
}

export interface PathCheckResult {
  exists: boolean
  /** Populated when the check itself could not run (e.g. distro not running). */
  error?: string
}

/**
 * Result of normalising a path the user picked with the native folder dialog
 * into the format the target expects.
 */
export interface PathResolution {
  /** Path in the target's own format, ready to store on the Project. */
  path: string
  /** Distro parsed out of a \\wsl$\ or \\wsl.localhost\ UNC path, if any. */
  distro?: string
  /** Non-blocking advice to surface inline in the UI. */
  warning?: string
}
