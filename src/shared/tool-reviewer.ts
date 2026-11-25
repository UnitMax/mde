/**
 * The tool reviewer: a model behind an OpenAI-compatible endpoint that looks at each permission request of a thread
 * in the "Auto (reviewed)" mode. It may only approve a request or leave it to the person; it never rejects one.
 */

/** The reviewer's settings as the renderer sees them. The API key itself never leaves the main process. */
export interface ToolReviewerSettings {
  /** The endpoint's base URL, up to and including the version (`https://openrouter.ai/api/v1`). */
  baseUrl: string
  /** The model ID the endpoint knows (`nvidia/nemotron-3.5-super-vl:free`). */
  model: string
  /** Whether a key is saved. */
  hasKey: boolean
  /** Whether a request the reviewer rates medium risk is still asked about, as is the default. */
  askMediumRisk: boolean
}

/** A change to the settings. A `key` of null removes the saved one; left out, it stays as it is. */
export interface ToolReviewerSettingsUpdate {
  baseUrl: string
  model: string
  askMediumRisk: boolean
  key?: string | null
}

export type ToolReviewRisk = 'low' | 'medium' | 'high'

/**
 * What the reviewer made of a request still open, shown on its card. `reviewing` is a review in progress;
 * `asked` is one that found the request needs the person; `unavailable` is a review that could not be done, so the
 * person is asked as if the thread had no reviewer.
 */
export type ChatPermissionReview =
  | { state: 'reviewing' }
  | { state: 'asked'; risk: ToolReviewRisk; reason: string; by: 'rules' | 'model' }
  | { state: 'unavailable'; reason: string }

/** The answer to a settings test: the verdict the reviewer gave a harmless sample, or why it gave none. */
export type ToolReviewerTestResult = { ok: true; milliseconds: number } | { ok: false; reason: string }

export const TOOL_REVIEWER_LIMITS = { baseUrl: 2048, model: 200, key: 4096 }

/** Why a base URL cannot be used, or null. Plain HTTP is allowed only for this computer, as for a local model server. */
export function toolReviewerUrlError(value: string): string | null {
  const text = value.trim()
  if (!text) return 'Enter the endpoint URL.'
  if (text.length > TOOL_REVIEWER_LIMITS.baseUrl) return 'The URL is too long.'
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return 'Enter a full URL, such as https://openrouter.ai/api/v1.'
  }
  if (url.username || url.password) return 'Put the key in the key field, not in the URL.'
  if (url.search || url.hash) return 'The URL cannot have a query or a fragment.'
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return null
  return url.protocol === 'http:' ? 'Use https, or http only for localhost.' : 'Use an https URL.'
}

/** Why a model ID cannot be used, or null. */
export function toolReviewerModelError(value: string): string | null {
  const text = value.trim()
  if (!text) return 'Enter the model ID.'
  if (text.length > TOOL_REVIEWER_LIMITS.model || /[\s\u0000-\u001f\u007f]/.test(text)) return 'Enter a model ID without spaces.'
  return null
}
