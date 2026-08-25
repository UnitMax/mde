export interface PrivatePathNeedle {
  label: string
  value: string
}

export interface PrivatePathNeedleOptions {
  homeDirectory?: string
  username?: string
  rootDirectory?: string
}

export interface NeedleMatcher extends PrivatePathNeedle {
  encoding: 'utf8' | 'utf16le'
  pattern: Buffer
}

export interface PrivatePathFinding extends PrivatePathNeedle {
  file: string
  encoding: 'utf8' | 'utf16le'
  offset: number
}

export interface AuditPackagedOutputOptions extends PrivatePathNeedleOptions {
  outputDirectory?: string
  allowMissing?: boolean
}

export interface AuditPackagedOutputResult {
  directory: string
  missing: boolean
  removed: string[]
  scannedFiles: number
  findings: PrivatePathFinding[]
}

export const buildMetadataFiles: string[]

export function privatePathNeedles(options?: PrivatePathNeedleOptions): PrivatePathNeedle[]
export function needleMatchers(needles: PrivatePathNeedle[]): NeedleMatcher[]
export function scanFileForNeedles(
  filePath: string,
  matchers: NeedleMatcher[]
): Promise<PrivatePathFinding[]>
export function removeBuildMetadata(outputDirectory: string): Promise<string[]>
export function auditPackagedOutput(
  options?: AuditPackagedOutputOptions
): Promise<AuditPackagedOutputResult>
