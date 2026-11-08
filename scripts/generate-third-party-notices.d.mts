export interface PackageMetadata {
  dev?: boolean
  dependencies?: Record<string, string>
  [key: string]: unknown
}

export const bundledRendererDependencies: string[]
export const bundledMainDependencies: string[]
export function dependencyClosure(
  rootNames: string[],
  packageMetadata?: Record<string, PackageMetadata>,
): Set<string>
export function attributedPackagePaths(
  packageMetadata?: Record<string, PackageMetadata>,
): Set<string>
export interface ThemeCreditTheme {
  id: string
  label: string
}
export interface ThemeCreditSource {
  key: string
  name: string
  themes: ThemeCreditTheme[]
  url: string
  license: string
  copyright: string
  licenseFile: string
  changes: string
}
export interface ThemeCredits {
  original: ThemeCreditTheme[]
  sources: ThemeCreditSource[]
}
export function loadThemeCredits(): ThemeCredits
export function renderThirdPartyNotices(): string
export function generateThirdPartyNotices(options?: { check?: boolean }): {
  entryCount: number
  rendered: string
}
