import { createContext, useContext, useLayoutEffect, useState, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { composerSizeFor, type ComposerSize } from '@/lib/composer-size'
import { cn } from '@/lib/utils'

/** What the toolbar's controls draw themselves by: its size, and the width that size was taken from. */
export interface ComposerBox {
  size: ComposerSize
  width: number
}

/** Where nothing measures the toolbar: wide, with room for anything. */
const UNMEASURED: ComposerBox = { size: 'wide', width: Number.POSITIVE_INFINITY }

export const ComposerSizeContext = createContext<ComposerBox>(UNMEASURED)

export function useComposerSize(): ComposerSize {
  return useContext(ComposerSizeContext).size
}

export function useComposerWidth(): number {
  return useContext(ComposerSizeContext).width
}

/** The size and width of the element, kept up to date as the window or the sidebar is resized. */
export function useMeasuredComposerSize(ref: RefObject<HTMLElement | null>): ComposerBox {
  const [box, setBox] = useState<ComposerBox>(UNMEASURED)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = (): void => {
      const measured = element.getBoundingClientRect().width
      // The size is exact. The width is only used for an estimate, so it moves in steps of eight pixels: a drag
      // should not redraw the row at every pixel.
      const size = composerSizeFor(measured)
      const width = measured > 0 ? Math.floor(measured / 8) * 8 : Number.POSITIVE_INFINITY
      setBox((current) => (current.size === size && current.width === width ? current : { size, width }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return box
}

/**
 * A control of the toolbar: quiet until it is hovered, one height, one type size. Every control uses it,
 * which is what keeps the row calm; add `group/chip` so a `HoverChevron` inside can follow the hover.
 */
export const toolbarChip =
  'group/chip flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-muted transition-colors ' +
  'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover data-[state=open]:text-fg'

/** The sign that a chip opens a menu. It only shows while the chip is hovered, focused or open. */
export function HoverChevron({ className }: { className?: string }): JSX.Element {
  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        '-ml-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-70 group-focus-visible/chip:opacity-70 group-data-[state=open]/chip:opacity-70',
        className,
      )}
    />
  )
}
