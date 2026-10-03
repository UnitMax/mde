import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { RENDERER_ENTRY_URL } from './renderer-protocol'

export interface IpcSecurityContext {
  getWebContents(): WebContents | null
  rendererUrl: string
}

/** Share the entry selection with window loading; packaged apps ignore dev overrides. */
export function rendererEntryUrl(isPackaged: boolean, developmentUrl?: string): string {
  return !isPackaged && developmentUrl ? developmentUrl : RENDERER_ENTRY_URL
}

function isRendererUrl(value: string, expected: string): boolean {
  try {
    const url = new URL(value)
    const entry = new URL(expected)
    // URL.origin is "null" for custom schemes in Node; compare the components.
    return !url.username && !url.password &&
      url.protocol === entry.protocol && url.host === entry.host &&
      url.pathname === entry.pathname && url.search === entry.search
  } catch {
    return false
  }
}

/** Fail closed before inspecting payloads or exercising any privileged capability. */
export function assertIpcSender(event: IpcMainInvokeEvent, context: IpcSecurityContext): void {
  const expected = context.getWebContents()
  const frame = event.senderFrame
  if (
    !expected || expected.isDestroyed() || event.sender !== expected ||
    !frame || frame !== expected.mainFrame || frame.isDestroyed() ||
    !isRendererUrl(frame.url, context.rendererUrl)
  ) {
    throw new Error('Unauthorized IPC sender.')
  }
}
