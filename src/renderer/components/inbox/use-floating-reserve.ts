import { createContext, useContext, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { floatingReserve } from '@/lib/floating-reserve'
import { useInboxChanges } from '@/store/inbox-changes'
import { useInboxView } from '@/store/inbox-view'

/**
 * Tells the conversation how wide the floating card is while it is on screen. Hidden for the Git graph, the card
 * keeps its place, so that the conversation under the graph does not move and move back.
 */
export function usePublishFloatingCardWidth(element: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const set = useInboxView.getState().setFloatingCardWidth
    const measure = (): void => set(Math.round(node.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (useInboxChanges.getState().graphThreadId === null) set(0)
    }
  }, [element])
}

/**
 * Whether a file stands beside the conversation. The floating card then lies over the file, at the right, so the
 * conversation has nothing to make way for.
 */
export const FileBesideContext = createContext(false)

/**
 * The padding that keeps the area `element` (the conversation below the thread's header, or the new-thread page)
 * clear of the floating card where there is room: see `floatingReserve`.
 */
export function useFloatingReserve(element: RefObject<HTMLElement>): CSSProperties | undefined {
  const beside = useContext(FileBesideContext)
  const card = useInboxView((s) => (s.sidebarFloating && !beside ? s.floatingCardWidth : 0))
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = element.current
    if (!node || card === 0) return
    // The border box: the padding this sets does not change it, so measuring cannot feed back into itself.
    const measure = (): void => setWidth(Math.round(node.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [element, card])
  const padding = floatingReserve(width, card)
  return padding > 0 ? { paddingRight: padding } : undefined
}
