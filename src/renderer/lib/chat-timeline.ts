import type { ChatMessage } from '@shared/types'

type UserMessage = Extract<ChatMessage, { kind: 'user' }>

/** One of the user's prompts as the timeline lists it. */
export interface TimelineEntry {
  id: string
  /** What the prompt says, in one line. */
  label: string
}

/** A single prompt gives nothing to jump between, so the timeline starts at two. */
export const TIMELINE_MIN_PROMPTS = 2

/** The most marks the collapsed rail draws; a longer conversation shows the ones around where you are. */
export const TIMELINE_MAX_MARKS = 18

const LABEL_LIMIT = 160

/** The prompt in one line: its first line of text, or what it carries when it has no text. */
export function promptLabel(message: UserMessage): string {
  const line = message.text
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find(Boolean)
  if (line) return line.length > LABEL_LIMIT ? `${line.slice(0, LABEL_LIMIT - 1)}…` : line
  const files = message.attachments ?? []
  if (files.length === 1) return files[0]!.name
  if (files.length > 1) return `${files.length} attachments`
  const skills = message.skills ?? []
  if (skills.length > 0) return skills.map((skill) => skill.name).join(', ')
  return 'Empty message'
}

export function timelineEntries(messages: readonly ChatMessage[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const message of messages) {
    if (message.kind === 'user') entries.push({ id: message.id, label: promptLabel(message) })
  }
  return entries
}

/** Where one prompt's bubble is, measured from the top of the visible part of the conversation. */
export interface PromptSpan {
  id: string
  top: number
  bottom: number
}

export interface TimelinePlace {
  /** The prompts whose bubbles are on screen. */
  visible: ReadonlySet<string>
  /** The prompt of the turn being read, or null while there are no prompts. */
  current: string | null
}

/** The turn being read starts at the last prompt that has reached this share of the way down the view. */
const READING_LINE = 0.35

/**
 * Which prompts are on screen and which one the reader is in. At the very end the reader is in the
 * last turn, however short it is; otherwise it is the last prompt that has reached the reading line.
 * `spans` are in conversation order.
 */
export function timelinePlace(spans: readonly PromptSpan[], viewHeight: number, atBottom: boolean): TimelinePlace {
  const first = spans[0]
  if (!first) return { visible: new Set(), current: null }
  const visible = new Set(spans.filter((span) => span.bottom > 0 && span.top < viewHeight).map((span) => span.id))
  if (atBottom) return { visible, current: spans[spans.length - 1]!.id }
  let current = first.id
  for (const span of spans) {
    if (span.top <= viewHeight * READING_LINE) current = span.id
    else break
  }
  return { visible, current }
}

export function samePlace(a: TimelinePlace, b: TimelinePlace): boolean {
  if (a.current !== b.current || a.visible.size !== b.visible.size) return false
  for (const id of a.visible) if (!b.visible.has(id)) return false
  return true
}

/** The marks to draw: all of them, or the `capacity` around `active` when there are more. */
export function markWindow(total: number, capacity: number, active: number): { start: number; end: number } {
  if (total <= capacity) return { start: 0, end: total }
  const start = Math.min(Math.max(active - Math.floor(capacity / 2), 0), total - capacity)
  return { start, end: start + capacity }
}

/** Smooth scrolling unless the system asks for less motion. */
export function scrollBehavior(): ScrollBehavior {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return reduced ? 'auto' : 'smooth'
}
