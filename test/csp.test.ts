import { describe, expect, it } from 'vitest'
import { rendererCsp } from '../src/shared/csp'

describe('renderer CSP', () => {
  it('keeps the production policy local and free of executable relaxations', () => {
    const csp = rendererCsp('production')

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toMatch(/connect-src [^;]*(localhost|127\.0\.0\.1|ws:|http:)/)
  })

  it('allows only loopback development endpoints for Vite', () => {
    const csp = rendererCsp('development')

    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain('http://localhost:*')
    expect(csp).toContain('http://127.0.0.1:*')
    expect(csp).toContain('ws://localhost:*')
    expect(csp).toContain('ws://127.0.0.1:*')
    expect(csp).not.toContain('connect-src \'self\' ws:')
  })
})
