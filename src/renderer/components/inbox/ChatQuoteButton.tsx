import { useEffect, useRef, useState, type RefObject } from 'react'
import { Quote } from 'lucide-react'
import { selectedTextIn } from '@/lib/chat-menu'
import { quoteBlock } from '@/lib/chat-quote'
import { QUOTE_BUTTON_HEIGHT, QUOTE_BUTTON_WIDTH, quoteButtonPlace } from '@/lib/quote-button-place'

interface Offer {
  /** The selected text, which is what a click quotes. */
  text: string
  /** Where the button goes, from the top left of the layer it is drawn in. */
  left: number
  top: number
}

/** Whether the selection was made from its end back to its start, which is where the pointer was left. */
function isBackward(selection: Selection): boolean {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (!anchorNode || !focusNode) return false
  try {
    const anchor = document.createRange()
    anchor.setStart(anchorNode, anchorOffset)
    const focus = document.createRange()
    focus.setStart(focusNode, focusOffset)
    return anchor.compareBoundaryPoints(Range.START_TO_START, focus) > 0
  } catch {
    return false
  }
}

/**
 * Where the button goes for the current selection, or null when there is nothing to quote in it or it is
 * out of sight. It sits by the end of the selection where the pointer was let go: below it, or above it
 * when the selection was made upward or there is no room below.
 */
function place(selection: Selection | null, transcript: HTMLElement, layer: HTMLElement): Offer | null {
  const text = selectedTextIn(selection, transcript)
  if (!selection || quoteBlock(text) === null) return null
  const range = selection.getRangeAt(0)
  const rects = Array.from(range.getClientRects?.() ?? []).filter((rect) => rect.width > 0 || rect.height > 0)
  const backward = isBackward(selection)
  const end = (backward ? rects[0] : rects[rects.length - 1]) ?? range.getBoundingClientRect?.()
  if (!end) return null
  const spot = quoteButtonPlace(end, transcript.getBoundingClientRect(), backward)
  if (!spot) return null
  const frame = layer.getBoundingClientRect()
  return { text, left: spot.left - frame.left, top: spot.top - frame.top }
}

const same = (a: Offer | null, b: Offer | null): boolean =>
  a === b || (a !== null && b !== null && a.text === b.text && a.left === b.left && a.top === b.top)

/**
 * A small Quote button that shows beside text selected in the conversation. Clicking it adds the text to
 * the message box as a quote. It waits until the pointer is let go, so that it is not chasing a selection
 * that is still being made, and it follows the selection when the conversation scrolls. Drawn over the
 * conversation, which it must be placed in.
 */
export function ChatQuoteButton({
  transcriptRef,
  onQuote,
}: {
  transcriptRef: RefObject<HTMLElement | null>
  onQuote: (text: string) => void
}): JSX.Element {
  const layer = useRef<HTMLDivElement>(null)
  const [offer, setOffer] = useState<Offer | null>(null)

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return
    let frame = 0
    // A press that may become a selection is under way; a right-click menu is open for the selection.
    let pressed = false
    let menu = false

    const measure = (): void => {
      frame = 0
      const next = pressed || menu || !layer.current ? null : place(window.getSelection(), transcript, layer.current)
      setOffer((current) => (same(current, next) ? current : next))
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      pressed = true
      menu = false
      setOffer(null)
    }
    const onUp = (): void => {
      if (!pressed) return
      pressed = false
      schedule()
    }
    const onMenu = (): void => {
      menu = true
      setOffer(null)
    }

    transcript.addEventListener('pointerdown', onDown, true)
    transcript.addEventListener('contextmenu', onMenu, true)
    transcript.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('resize', schedule)
    document.addEventListener('selectionchange', schedule)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      transcript.removeEventListener('pointerdown', onDown, true)
      transcript.removeEventListener('contextmenu', onMenu, true)
      transcript.removeEventListener('scroll', schedule)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('selectionchange', schedule)
    }
  }, [transcriptRef])

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {offer && (
        <button
          type="button"
          data-testid="chat-quote-button"
          aria-label="Quote the selected text"
          title="Quote in your message"
          // The selection must still be there when the click arrives, and the box must be left to take the focus.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQuote(offer.text)
            window.getSelection()?.removeAllRanges()
            setOffer(null)
          }}
          style={{ left: offer.left, top: offer.top, width: QUOTE_BUTTON_WIDTH, height: QUOTE_BUTTON_HEIGHT }}
          className="pointer-events-auto absolute flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-elevated text-[12px] font-medium text-fg shadow-lg shadow-shade/40 transition-colors [animation:mde-menu-in_90ms_ease-out] hover:bg-hover"
        >
          <Quote aria-hidden className="h-3.5 w-3.5 text-accent" />
          Quote
        </button>
      )}
    </div>
  )
}
