import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type WheelEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { scrollBehavior } from '@/lib/chat-timeline'
import { cn } from '@/lib/utils'

/** Width of the fade where content runs off an end of the strip. */
const EDGE_FADE_PX = 20

interface Overflow {
  start: boolean
  end: boolean
}

function overflowMask({ start, end }: Overflow): string | undefined {
  if (!start && !end) return undefined
  const from = start ? `transparent, #000 ${EDGE_FADE_PX}px` : '#000, #000'
  const to = end ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent` : '#000, #000'
  return `linear-gradient(to right, ${from}, ${to})`
}

interface ScrollStripProps extends HTMLAttributes<HTMLDivElement> {
  /** Classes for the whole strip (the list and its arrows). */
  wrapperClassName?: string
  /**
   * Changes when the shown item changes: the element inside the list marked `aria-selected="true"` is then
   * scrolled into view, clear of the fade.
   */
  revealKey?: string
}

/**
 * A single row of items that scrolls sideways instead of wrapping or overflowing: the mouse wheel turns it,
 * a fade marks an end with more beyond it, and once it overflows, arrow buttons on both sides scroll it by
 * most of its width. Pass `role`, `aria-label` and key handlers for the list as ordinary props; the ref is the list.
 */
export const ScrollStrip = forwardRef<HTMLDivElement, ScrollStripProps>(function ScrollStrip(
  { wrapperClassName, revealKey, className, children, ...rest },
  ref
) {
  const list = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => list.current!, [])
  const [overflow, setOverflow] = useState<Overflow>({ start: false, end: false })
  const [scrollable, setScrollable] = useState(false)

  // Content can change without the strip changing size, so this is read after every render as well as on
  // scrolling and resizing.
  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const measure = (): void => {
      const start = element.scrollLeft > 1
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setOverflow((previous) => (previous.start === start && previous.end === end ? previous : { start, end }))
      // Once the arrows have appeared they stay while anything is scrolled away or still beyond the end.
      setScrollable(start || end)
    }
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  })

  useLayoutEffect(() => {
    const element = list.current
    const item = element?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!element || !item) return
    const left = item.offsetLeft - EDGE_FADE_PX
    const right = item.offsetLeft + item.offsetWidth + EDGE_FADE_PX
    const target = left < element.scrollLeft
      ? Math.max(0, left)
      : right > element.scrollLeft + element.clientWidth
        ? right - element.clientWidth
        : element.scrollLeft
    if (Math.abs(target - element.scrollLeft) >= 1) element.scrollTo({ left: target, behavior: scrollBehavior() })
  // The arrows take room when they appear, which can push the shown item out of sight.
  }, [revealKey, scrollable])

  const scrollByPage = useCallback((direction: -1 | 1): void => {
    const element = list.current
    if (element) element.scrollBy({ left: direction * Math.max(48, element.clientWidth * 0.8), behavior: scrollBehavior() })
  }, [])

  // A mouse wheel turns the strip sideways; a trackpad's own sideways swipe is left to the browser.
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const element = list.current
    if (!element || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    element.scrollLeft += event.deltaY
  }

  const mask = overflowMask(overflow)
  const arrow = (direction: -1 | 1): JSX.Element => {
    const Icon = direction < 0 ? ChevronLeft : ChevronRight
    const disabled = direction < 0 ? !overflow.start : !overflow.end
    return (
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        data-testid={direction < 0 ? 'scroll-strip-start' : 'scroll-strip-end'}
        aria-label={direction < 0 ? 'Scroll left' : 'Scroll right'}
        onClick={() => scrollByPage(direction)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-0.5', wrapperClassName)}>
      {scrollable && arrow(-1)}
      <div
        {...rest}
        ref={list}
        onWheel={onWheel}
        data-overflow={overflow.start && overflow.end ? 'both' : overflow.start ? 'start' : overflow.end ? 'end' : 'none'}
        className={cn('flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
      {scrollable && arrow(1)}
    </div>
  )
})
