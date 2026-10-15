export function uploadDraftRelease(options: {
  tag: string | undefined
  repository: string | undefined
  assets: string[]
  run?: (file: string, args: string[], options: { encoding: 'utf8', maxBuffer: number }) => string
}): void
