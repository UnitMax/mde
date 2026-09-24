/** C0 and C1 controls, including DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Returns an http(s) link target, or null for anything else. */
export function externalLinkUrl(href: string): string | null {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Resolves a relative Markdown link against the file that contains it. Returns
 * the target relative to the session root, or null when the link has a scheme,
 * is absolute, is only an anchor, or would climb out of the session.
 */
export function resolveRelativeLink(currentFile: string, href: string): string | null {
  const withoutFragment = href.split('#')[0]?.split('?')[0] ?? ''
  if (!withoutFragment || URL_SCHEME.test(withoutFragment) || withoutFragment.startsWith('/')) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(withoutFragment)
  } catch {
    return null
  }
  if (decoded.includes('\\') || CONTROL_CHARS.test(decoded)) return null

  const segments = currentFile.split('/').slice(0, -1)
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.length > 0 ? segments.join('/') : null
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Mirrors the main-process read limit for display. */
export const MAX_FILE_VIEW_LABEL = '2 MB'
