/**
 * The MDE browser: tabs in the Inbox sidebar for the web apps being developed. It opens local addresses
 * (localhost, 127.0.0.0/8, ::1) and the hosts the person allowed one by one, and nothing else: the main process
 * refuses every other request the page makes, before any connection.
 */

/** How many tabs the browser keeps open at once. */
export const BROWSER_TAB_LIMIT = 12
/** How many hosts can be allowed besides the local ones. */
export const BROWSER_ALLOWED_HOST_LIMIT = 100
/** How many refused hosts a tab remembers to show. */
export const BROWSER_BLOCKED_HOST_LIMIT = 20
/** The longest address the browser takes. */
export const BROWSER_URL_LIMIT = 8192

/** A page load the browser refused because its host is not allowed; nothing was sent to that host. */
export interface BrowserBlockedPage {
  url: string
  host: string
}

export interface BrowserTab {
  id: string
  /** The address shown; empty for a new tab that has not been sent anywhere. */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Set while the tab shows the "not allowed" page in place of what it was asked to open. */
  blocked: BrowserBlockedPage | null
  /** Hosts the page tried to reach (scripts, fonts, frames, fetches) and was refused, newest last. */
  blockedHosts: string[]
  /** Why the page could not be shown (it crashed, or did not load), or null. */
  error: string | null
}

export interface BrowserState {
  tabs: BrowserTab[]
  activeId: string | null
  /** The hosts allowed besides the local ones, as the person added them. */
  allowedHosts: string[]
}

/** Where the active tab is drawn, in CSS pixels of the window's page; null hides it. */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserAction = 'back' | 'forward' | 'reload' | 'stop' | 'devtools'

/** What a left click on a web link in MDE does. */
export type BrowserLinkClick = 'system' | 'mde'
export const BROWSER_LINK_CLICKS: readonly BrowserLinkClick[] = ['system', 'mde']
export const isBrowserLinkClick = (value: unknown): value is BrowserLinkClick =>
  BROWSER_LINK_CLICKS.some((entry) => entry === value)

const WEB_PROTOCOLS = new Set(['http:', 'https:'])
const SOCKET_PROTOCOLS = new Set(['ws:', 'wss:'])
/** Schemes that carry their content with them and reach no host. */
const INLINE_PROTOCOLS = new Set(['data:', 'blob:', 'about:'])
const IPV4_LOOPBACK = /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/

function parse(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Whether a host name always counts as this machine: `localhost` and its subdomains (which Chromium resolves to
 * loopback itself), 127.0.0.0/8, ::1 and 0.0.0.0, which dev servers print as their address.
 */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'localhost' || name.endsWith('.localhost') || IPV4_LOOPBACK.test(name) ||
    name === '[::1]' || name === '0.0.0.0' || name === '[::ffff:7f00:1]'
}

/**
 * The host an allowed-hosts entry stands for, from what the person typed: a host name, an IP address, a
 * host with a port or a whole address. The port and path are dropped (a host is allowed on every port).
 * Null for anything else: a wildcard, a user name, a scheme other than http(s), or no host at all.
 */
export function normalizeAllowedHost(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > 2048 || /[\s*\u0000-\u001f\u007f]/.test(text)) return null
  const url = parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`)
  if (!url || !WEB_PROTOCOLS.has(url.protocol) || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  if (!host || host.length > 253 || host.endsWith('.')) return null
  return host
}

/** Whether a host may be reached: a local one, or one on the list. */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase()
  return isLoopbackHost(name) || allowed.includes(name)
}

/** The host of a web address (http, https, ws, wss), lowercased; null for any other address. */
export function browserHost(value: string): string | null {
  const url = parse(value)
  if (!url || !(WEB_PROTOCOLS.has(url.protocol) || SOCKET_PROTOCOLS.has(url.protocol)) || !url.hostname) return null
  return url.hostname.toLowerCase()
}

/**
 * The address to open for what was typed into the address field: `localhost:3000` and `example.test/path`
 * get `http://` in front. Only http and https addresses come back, without a user name or password; null for
 * anything else.
 */
export function browserUrl(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > BROWSER_URL_LIMIT || /[\s\u0000-\u001f\u007f]/.test(text)) return null
  const url = parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`)
  if (!url || !WEB_PROTOCOLS.has(url.protocol) || !url.hostname || url.username || url.password) return null
  return url.toString()
}

/** Whether a web address goes to a host the browser may open. */
export function isBrowserUrlAllowed(value: string, allowed: readonly string[]): boolean {
  const url = browserUrl(value)
  const host = url ? browserHost(url) : null
  return host !== null && isHostAllowed(host, allowed)
}

export type BrowserRequestVerdict =
  | { allow: true }
  /** `host` is set when the request went to a web host that may be allowed; null for a scheme the browser never loads. */
  | { allow: false; host: string | null }

/**
 * Decides one request of a page in the browser, before it is sent: web and socket requests go only to allowed
 * hosts, inline content (data:, blob:, about:) needs no host, and every other scheme (file:, ftp:, custom
 * protocols) is refused.
 */
export function classifyBrowserRequest(value: string, allowed: readonly string[]): BrowserRequestVerdict {
  const url = parse(value)
  if (!url) return { allow: false, host: null }
  if (INLINE_PROTOCOLS.has(url.protocol)) return { allow: true }
  if (!WEB_PROTOCOLS.has(url.protocol) && !SOCKET_PROTOCOLS.has(url.protocol)) return { allow: false, host: null }
  if (url.username || url.password || !url.hostname) return { allow: false, host: null }
  const host = url.hostname.toLowerCase()
  return isHostAllowed(host, allowed) ? { allow: true } : { allow: false, host }
}
