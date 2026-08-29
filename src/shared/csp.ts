export type RendererCspMode = 'development' | 'production'

const baseDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
]

const productionCsp = [
  ...baseDirectives,
  "connect-src 'self'"
].join('; ')

const developmentCsp = [
  ...baseDirectives,
  "connect-src 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:* ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:*"
].join('; ')

export function rendererCsp(mode: RendererCspMode): string {
  return mode === 'development' ? developmentCsp : productionCsp
}
