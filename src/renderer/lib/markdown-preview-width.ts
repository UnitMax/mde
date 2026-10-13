export type MarkdownPreviewWidth = 'centered' | 'full'

export const MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY = 'mde.markdown-preview-width'

export function isMarkdownPreviewWidth(value: unknown): value is MarkdownPreviewWidth {
  return value === 'centered' || value === 'full'
}

/** The remembered preview width; anything missing, unknown or unreadable is the centered column. */
export function getMarkdownPreviewWidth(): MarkdownPreviewWidth {
  try {
    const stored = localStorage.getItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY)
    return isMarkdownPreviewWidth(stored) ? stored : 'centered'
  } catch {
    return 'centered'
  }
}

export function saveMarkdownPreviewWidth(width: MarkdownPreviewWidth): void {
  try {
    localStorage.setItem(MARKDOWN_PREVIEW_WIDTH_STORAGE_KEY, width)
  } catch {
    // A restricted storage environment should not prevent reading a file.
  }
}
