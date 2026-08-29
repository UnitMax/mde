import { describe, expect, it } from 'vitest'
import {
  handleWindowOpen,
  safeExternalWebUrl,
  safeVsCodeRemoteUrl
} from '../src/main/external-links'

describe('external link validation', () => {
  it('allows only HTTP(S) web URLs', () => {
    expect(safeExternalWebUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(safeExternalWebUrl('HTTP://Example.COM/docs')).toBe('http://example.com/docs')
  })

  it('rejects executable, local, custom, and malformed URLs', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/id',
      'vscode://vscode-remote/wsl+Ubuntu/home/me',
      '//example.com/docs',
      'not a URL'
    ]) {
      expect(safeExternalWebUrl(value)).toBeNull()
    }
  })

  it('always denies the in-app window and opens only a validated web URL', () => {
    const opened: string[] = []

    expect(handleWindowOpen('https://example.com', (url) => opened.push(url))).toEqual({
      action: 'deny'
    })
    expect(handleWindowOpen('javascript:alert(1)', (url) => opened.push(url))).toEqual({
      action: 'deny'
    })
    expect(opened).toEqual(['https://example.com/'])
  })

  it('accepts only the registered VS Code Remote authority', () => {
    expect(safeVsCodeRemoteUrl('vscode://vscode-remote/wsl+Ubuntu/home/me/src/')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/me/src/'
    )
    expect(safeVsCodeRemoteUrl('vscode://evil/wsl+Ubuntu/home/me/src/')).toBeNull()
    expect(safeVsCodeRemoteUrl('https://vscode-remote.example/')).toBeNull()
  })
})
