import type { ChatPermission } from '@shared/types'
import type { ChatPermissionReview } from '@shared/tool-reviewer'
import { reviewRequest, type ReviewEndpoint, type ReviewVerdict } from './tool-reviewer'

/** A permission request as the gate reads it: what the card shows, OpenCode's details and the tool call it is for. */
export interface GateRequest {
  permission: ChatPermission
  metadata?: unknown
  callId?: string
}

/** One request the reviewer let through, for the conversation to mark its tool call by. */
export interface ReviewedCall {
  callId: string
  reason: string
  by: 'rules' | 'model'
  at: number
}

export interface ReviewGateDependencies {
  /** The open request by its ID, or null when it is no longer open. Throws when it cannot be read. */
  readRequest(threadId: string, sessionId: string, requestId: string): Promise<GateRequest | null>
  /** The folder the thread works in and the person's latest messages in it. */
  context(threadId: string): Promise<{ directory: string; userMessages: string[] }>
  endpoint(): Promise<ReviewEndpoint | null>
  /** Answers the request "once", refused when it changed since it was read (its revision). */
  approve(threadId: string, sessionId: string, requestId: string, revision: string): Promise<void>
  /** Lets the held `permission.asked` through, as if it had just come: the thread needs input. */
  release(threadId: string): void
  /** The thread's requests changed: an open conversation reads them again. */
  changed(threadId: string): void
  now(): number
  fetch?: typeof fetch
}

interface Entry {
  threadId: string
  review: ChatPermissionReview
  /** Answered or gone while it was being reviewed: the review's result is dropped. */
  settled: boolean
}

/** How many let-through calls a thread keeps for its marks, newest kept. */
const REVIEWED_PER_THREAD = 500

/**
 * Holds back the permission requests of threads in the "Auto (reviewed)" mode until the tool reviewer has looked at
 * them. A request the reviewer finds safe is answered "once" and never shown; any other, and any whose review fails,
 * is let through as a normal request with the reviewer's reason on its card. While the review runs the card shows it
 * as being reviewed, and the person can answer it themselves; the review then gives way.
 */
export class ReviewGate {
  private readonly entries = new Map<string, Entry>()
  private readonly reviewed = new Map<string, ReviewedCall[]>()

  constructor(private readonly dependencies: ReviewGateDependencies) {}

  /** Starts the review of a request just asked. The caller holds the request's event back until `release`. */
  begin(threadId: string, sessionId: string, requestId: string): void {
    if (this.entries.has(requestId)) return
    const entry: Entry = { threadId, review: { state: 'reviewing' }, settled: false }
    this.entries.set(requestId, entry)
    this.dependencies.changed(threadId)
    void this.run(entry, sessionId, requestId)
  }

  /** The request was answered, by the person or anyone else: a review still running gives way. */
  settle(requestId: string): void {
    const entry = this.entries.get(requestId)
    if (!entry) return
    entry.settled = true
    this.entries.delete(requestId)
  }

  /** What the reviewer made of a request still open, for its card. */
  review(requestId: string): ChatPermissionReview | undefined {
    return this.entries.get(requestId)?.review
  }

  /** The tool calls of a thread the reviewer let through, oldest first. */
  reviewedCalls(threadId: string): ReviewedCall[] {
    return [...(this.reviewed.get(threadId) ?? [])]
  }

  /** Whether a request is being held for its review, so its event is not passed on yet. */
  holding(requestId: string): boolean {
    return this.entries.get(requestId)?.review.state === 'reviewing'
  }

  forget(threadId: string): void {
    this.reviewed.delete(threadId)
    for (const [id, entry] of this.entries) if (entry.threadId === threadId) this.settle(id)
  }

  private async run(entry: Entry, sessionId: string, requestId: string): Promise<void> {
    const { threadId } = entry
    let verdict: ReviewVerdict | { verdict: 'unavailable'; reason: string }
    let request: GateRequest | null = null
    try {
      request = await this.dependencies.readRequest(threadId, sessionId, requestId)
      if (!request) {
        // Answered or withdrawn before it could be read: there is nothing to review or to show.
        this.settle(requestId)
        return
      }
      if (request.permission.incomplete) {
        verdict = { verdict: 'unavailable', reason: 'MDE cannot read this request in full, so the reviewer did not judge it.' }
      } else {
        const [context, endpoint] = await Promise.all([this.dependencies.context(threadId), this.dependencies.endpoint()])
        verdict = await reviewRequest(
          {
            action: request.permission.action,
            resources: request.permission.resources,
            ...(request.permission.save ? { save: request.permission.save } : {}),
            ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
          },
          context,
          endpoint,
          this.dependencies.fetch,
        )
      }
    } catch {
      verdict = { verdict: 'unavailable', reason: 'MDE could not read the request for the reviewer.' }
    }
    if (entry.settled) return
    if (verdict.verdict === 'allow' && request) {
      try {
        await this.dependencies.approve(threadId, sessionId, requestId, request.permission.revision)
        this.entries.delete(requestId)
        if (request.callId) this.remember(threadId, { callId: request.callId, reason: verdict.reason, by: verdict.by, at: this.dependencies.now() })
        this.dependencies.changed(threadId)
        return
      } catch {
        if (entry.settled) return
        verdict = { verdict: 'unavailable', reason: 'The reviewer approved this, but MDE could not answer it. Check it yourself.' }
      }
    }
    entry.review = verdict.verdict === 'ask'
      ? { state: 'asked', risk: verdict.risk, reason: verdict.reason, by: verdict.by }
      : { state: 'unavailable', reason: verdict.verdict === 'unavailable' ? verdict.reason : 'The reviewer could not decide.' }
    this.dependencies.release(threadId)
    this.dependencies.changed(threadId)
  }

  private remember(threadId: string, call: ReviewedCall): void {
    const calls = this.reviewed.get(threadId) ?? []
    calls.push(call)
    if (calls.length > REVIEWED_PER_THREAD) calls.splice(0, calls.length - REVIEWED_PER_THREAD)
    this.reviewed.set(threadId, calls)
  }
}
