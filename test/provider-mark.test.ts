import { describe, expect, it } from 'vitest'
import { providerHue, providerInitials } from '../src/renderer/lib/provider-mark'

describe('provider badge', () => {
  it('takes two letters from a camel-cased name and one from any other', () => {
    expect(providerInitials('OpenRouter')).toBe('OR')
    expect(providerInitials('OpenCode')).toBe('OC')
    expect(providerInitials('DeepSeek')).toBe('DS')
    expect(providerInitials('GitHub Copilot')).toBe('GH')
    expect(providerInitials('OpenAI')).toBe('OA')
    expect(providerInitials('Anthropic')).toBe('A')
    expect(providerInitials('Google Vertex AI')).toBe('G')
    expect(providerInitials('LM Studio')).toBe('L')
    expect(providerInitials('OPENAI')).toBe('O')
    expect(providerInitials('ollama')).toBe('O')
  })

  it('works for any name someone gives their own provider', () => {
    expect(providerInitials('corp-llm')).toBe('C')
    expect(providerInitials('  my local server ')).toBe('M')
    expect(providerInitials('302.AI')).toBe('3')
    expect(providerInitials('(Staging) Gateway')).toBe('S')
    expect(providerInitials('Ünternehmen KI')).toBe('Ü')
    expect(providerInitials('')).toBe('?')
    expect(providerInitials('---')).toBe('?')
  })

  it('gives the same name the same hue, whatever its case or spacing', () => {
    expect(providerHue('OpenRouter')).toBe(providerHue(' openrouter '))
    expect(typeof providerHue('')).toBe('number')
    const hues = new Set(['Anthropic', 'OpenAI', 'Google', 'OpenRouter', 'OpenCode', 'DeepSeek', 'Mistral', 'xAI'].map(providerHue))
    expect(hues.size).toBeGreaterThan(3)
  })
})
