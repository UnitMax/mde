export interface StageConptyFilesOptions {
  sourceDirectory: string
  destinationDirectory: string
}

export interface StageDevelopmentConptyOptions {
  platform?: NodeJS.Platform
  arch?: string
  rootDirectory?: string
}

export interface AfterPackContext {
  electronPlatformName: string
  appOutDir: string
}

export function stageConptyFiles(options: StageConptyFilesOptions): Promise<string[]>
export function stageDevelopmentConpty(
  options?: StageDevelopmentConptyOptions
): Promise<string[]>
export default function stagePackagedConpty(context: AfterPackContext): Promise<void>
