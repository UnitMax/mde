export interface PackageMetadata {
  dev?: boolean
  dependencies?: Record<string, string>
  [key: string]: unknown
}

export const bundledRendererDependencies: string[]
export function dependencyClosure(
  rootNames: string[],
  packageMetadata?: Record<string, PackageMetadata>,
): Set<string>
export function attributedPackagePaths(
  packageMetadata?: Record<string, PackageMetadata>,
): Set<string>
export function renderThirdPartyNotices(): string
export function generateThirdPartyNotices(options?: { check?: boolean }): {
  entryCount: number
  rendered: string
}
