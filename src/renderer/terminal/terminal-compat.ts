import type { PtySize } from '@shared/types'

export type TerminalSizeAction =
  | { type: 'wait' }
  | { type: 'ensure' | 'resize'; size: PtySize }

/** Determines whether a measured size should ensure, resize, or wait. */
export function terminalSizeAction(
  measuredSize: PtySize | null,
  ensured: boolean,
  previousSize: PtySize | null
): TerminalSizeAction {
  if (!measuredSize) return { type: 'wait' }
  if (!ensured) return { type: 'ensure', size: measuredSize }
  if (previousSize?.cols === measuredSize.cols && previousSize.rows === measuredSize.rows) {
    return { type: 'wait' }
  }
  return { type: 'resize', size: measuredSize }
}
