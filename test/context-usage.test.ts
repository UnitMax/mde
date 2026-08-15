import { describe, expect, it } from 'vitest'
import {
  contextUsageTone,
  formatContextUsage,
  formatTokenCount
} from '../src/renderer/components/context-usage'

describe('context usage display helpers', () => {
  it('formats compact token counts', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1_000)).toBe('1k')
    expect(formatTokenCount(12_400)).toBe('12.4k')
    expect(formatTokenCount(125_000)).toBe('125k')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })

  it('formats the context chip and assigns warning levels', () => {
    expect(formatContextUsage(null)).toBe('Context —')
    expect(
      formatContextUsage({
        usedTokens: 12_400,
        contextWindow: 200_000,
        percentage: 6.2,
        model: { providerID: 'cloud', modelID: 'model-a' }
      })
    ).toBe('12.4k / 200k · 6.2%')
    expect(contextUsageTone(69.9)).toBe('normal')
    expect(contextUsageTone(70)).toBe('warning')
    expect(contextUsageTone(90)).toBe('danger')
  })
})
