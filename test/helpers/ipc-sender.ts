import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { IpcSecurityContext } from '../../src/main/ipc-security'

/** Realistic identity relationships; no security bypass in handler tests. */
export function trustedIpcSender(rendererUrl = 'app://mde/index.html'): {
  security: IpcSecurityContext
  event: IpcMainInvokeEvent
} {
  const frame = { url: rendererUrl, isDestroyed: () => false }
  const sender = { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents
  return {
    security: { getWebContents: () => sender, rendererUrl },
    event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent,
  }
}
