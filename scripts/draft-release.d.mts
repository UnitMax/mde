export function uploadDraftRelease(options: {
  tag: string | undefined
  repository: string | undefined
  assets: string[]
  run?: (file: string, args: string[], options: { encoding: 'utf8', maxBuffer: number }) => string
}): void

export function ensureReleaseTag(options: {
  tag: string | undefined
  sha: string | undefined
  repository: string | undefined
  /** False only checks that the tag is free or already on `sha`. */
  create?: boolean
  run?: (file: string, args: string[], options: { encoding: 'utf8', maxBuffer: number }) => string
}): 'created' | 'exists'
