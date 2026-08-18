export interface DependencyFingerprintOptions {
  packageJson: Record<string, unknown>
  packageLock: Record<string, unknown>
  npmrc?: string
  platform: string
  arch: string
  nodeVersion: string
  npmVersion: string
}

export interface DependenciesNeedInstallOptions {
  rootDirectory: string
  fingerprint: string
  force?: boolean
}

export interface EnsureWindowsDependenciesOptions {
  rootDirectory?: string
  force?: boolean
  install?: (rootDirectory: string) => number
  platform?: string
  arch?: string
  nodeVersion?: string
  npmVersionValue?: string
}

export const dependencyFingerprintFile: string
export function createDependencyFingerprint(options: DependencyFingerprintOptions): string
export function dependenciesNeedInstall(options: DependenciesNeedInstallOptions): boolean
export function ensureWindowsDependencies(options?: EnsureWindowsDependenciesOptions): boolean
