/**
 * Dragging an Inbox terminal pane into a message (see `@shared/terminal-references`). The pane is picked up as it
 * is for swapping panes, with Ctrl+Shift held; out of the terminal it carries a small chip with its title, and a
 * message box under the pointer lights up. A message box takes part by carrying `data-terminal-drop` and listening
 * for `TERMINAL_DROP_EVENT`; the terminal does not need to know which boxes there are.
 */

export const TERMINAL_DROP_ATTRIBUTE = 'data-terminal-drop'
/** Set on the drop target while a pane is held over it. */
export const TERMINAL_DROP_OVER_ATTRIBUTE = 'data-terminal-drop-over'
export const TERMINAL_DROP_EVENT = 'mde:terminal-drop'

export interface TerminalDropDetail {
  terminalId: string
  title: string
  clientX: number
  clientY: number
}

const SVG = 'http://www.w3.org/2000/svg'

/**
 * The terminal icon the chips carry (Lucide's square-terminal, which the conversation's chip draws through
 * lucide-react), made without React for the message box's editor and the chip by the pointer.
 */
export function terminalIconElement(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: className })) {
    svg.setAttribute(name, value)
  }
  const rect = document.createElementNS(SVG, 'rect')
  for (const [name, value] of Object.entries({ width: '18', height: '18', x: '3', y: '3', rx: '2' })) rect.setAttribute(name, value)
  const prompt = document.createElementNS(SVG, 'path')
  prompt.setAttribute('d', 'm7 11 2-2-2-2')
  const cursor = document.createElementNS(SVG, 'path')
  cursor.setAttribute('d', 'M11 13h4')
  svg.append(rect, prompt, cursor)
  return svg
}

let marked: HTMLElement | null = null
let ghost: HTMLElement | null = null

/** The message box under a point, if one takes terminals. */
export function terminalDropTargetAt(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY)
  return element?.closest<HTMLElement>(`[${TERMINAL_DROP_ATTRIBUTE}]`) ?? null
}

function mark(target: HTMLElement | null): void {
  if (target === marked) return
  marked?.removeAttribute(TERMINAL_DROP_OVER_ATTRIBUTE)
  marked = target
  marked?.setAttribute(TERMINAL_DROP_OVER_ATTRIBUTE, '')
}

function showGhost(title: string, clientX: number, clientY: number): void {
  if (!ghost) {
    ghost = document.createElement('div')
    ghost.dataset.testid = 'terminal-drag-chip'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.className = 'pointer-events-none fixed left-0 top-0 z-[1000] flex max-w-60 items-center gap-1.5 rounded-md border border-accent/50 bg-elevated px-2 py-1 text-xs text-fg shadow-lg shadow-shade/30'
    const icon = terminalIconElement('h-3 w-3 shrink-0 text-accent')
    const label = document.createElement('span')
    label.className = 'truncate'
    ghost.append(icon, label)
    document.body.append(ghost)
  }
  ghost.lastElementChild!.textContent = title
  ghost.style.transform = `translate3d(${Math.round(clientX + 14)}px, ${Math.round(clientY + 12)}px, 0)`
}

function hideGhost(): void {
  ghost?.remove()
  ghost = null
}

/**
 * The held pane moved. Inside the terminal it is a swap and nothing here shows; outside it the chip follows the
 * pointer and the message box under it lights up.
 */
export function moveTerminalReference(title: string, clientX: number, clientY: number, insideTerminal: boolean): void {
  if (insideTerminal) {
    endTerminalReferenceDrag()
    return
  }
  showGhost(title, clientX, clientY)
  mark(terminalDropTargetAt(clientX, clientY))
}

/** The pane was let go outside the terminal: hands it to the message box under the pointer. True if one took it. */
export function dropTerminalReference(detail: TerminalDropDetail): boolean {
  endTerminalReferenceDrag()
  const target = terminalDropTargetAt(detail.clientX, detail.clientY)
  if (!target) return false
  target.dispatchEvent(new CustomEvent<TerminalDropDetail>(TERMINAL_DROP_EVENT, { detail }))
  return true
}

/** The drag ended or moved back into the terminal: the chip and the lit box go. */
export function endTerminalReferenceDrag(): void {
  mark(null)
  hideGhost()
}
