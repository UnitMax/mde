export interface InstallNodePtyOptions {
  platform?: NodeJS.Platform
  rootDirectory?: string
  spawn?: (...args: any[]) => { error?: Error; status: number | null }
}

export function installNodePty(options?: InstallNodePtyOptions): number | null
