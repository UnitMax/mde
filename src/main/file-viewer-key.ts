interface CloseKeyInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/**
 * Whether the key press is Ctrl+W (Cmd+W on a Mac). The application menu closes the window on it, before the page
 * sees the key, so the main process has to take it when the press means something else.
 */
export function isCloseKey(input: CloseKeyInput, platform: NodeJS.Platform): boolean {
  const primary = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  return input.type === 'keyDown' && primary && !input.alt && !input.shift && (input.key.toLowerCase() === 'w' || input.code === 'KeyW')
}

/**
 * Whether a file viewer is open, as the renderer last said. While one is, Ctrl+W (Cmd+W) closes the viewer instead of
 * the window; with none open the key keeps closing the window.
 */
export class FileViewerKey {
  private open = false

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  setOpen(open: boolean): void {
    this.open = open
  }

  /** Whether the press closes the file viewer (and so must not close the window). */
  closes(input: CloseKeyInput): boolean {
    return this.open && isCloseKey(input, this.platform)
  }
}
