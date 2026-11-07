import { describe, expect, it } from 'vitest'
import { atLeast, COMPOSER_SIZE_FLOORS, composerSizeFor, providerFits } from '../src/renderer/lib/composer-size'

describe('composerSizeFor', () => {
  it('steps down as the toolbar narrows, from the floor of each size', () => {
    const { wide, medium, narrow } = COMPOSER_SIZE_FLOORS
    expect(composerSizeFor(1200)).toBe('wide')
    expect(composerSizeFor(wide)).toBe('wide')
    expect(composerSizeFor(wide - 1)).toBe('medium')
    expect(composerSizeFor(medium)).toBe('medium')
    expect(composerSizeFor(medium - 1)).toBe('narrow')
    expect(composerSizeFor(narrow)).toBe('narrow')
    expect(composerSizeFor(narrow - 1)).toBe('tight')
    expect(composerSizeFor(120)).toBe('tight')
  })

  it('shows everything until the width is known', () => {
    expect(composerSizeFor(0)).toBe('wide')
    expect(composerSizeFor(Number.NaN)).toBe('wide')
    expect(composerSizeFor(-5)).toBe('wide')
  })
})

describe('atLeast', () => {
  it('orders the sizes from tight to wide', () => {
    expect(atLeast('wide', 'wide')).toBe(true)
    expect(atLeast('wide', 'tight')).toBe(true)
    expect(atLeast('medium', 'medium')).toBe(true)
    expect(atLeast('narrow', 'medium')).toBe(false)
    expect(atLeast('tight', 'narrow')).toBe(false)
    expect(atLeast('tight', 'tight')).toBe(true)
  })
})

describe('providerFits', () => {
  it('shows the provider in front of a short name and effort once the toolbar has the room', () => {
    expect(providerFits('Beam Free', 'Medium', 'OpenCode', COMPOSER_SIZE_FLOORS.wide)).toBe(true)
    expect(providerFits('Beam Free', null, 'OpenCode', COMPOSER_SIZE_FLOORS.wide)).toBe(true)
    expect(providerFits('GPT-5.1 Codex Max', 'Extra high', 'OpenAI', COMPOSER_SIZE_FLOORS.wide)).toBe(false)
  })

  it('leaves it out for a long name, until the toolbar is wide enough for the whole', () => {
    const long = 'Claude Sonnet 4.5 (extended thinking)'
    expect(providerFits(long, 'Medium', 'OpenCode', 760)).toBe(false)
    expect(providerFits(long, 'Medium', 'OpenCode', 1200)).toBe(true)
  })

  it('does not hold back where the width is not known', () => {
    expect(providerFits('Claude Sonnet 4.5 (extended thinking)', 'Extra high', 'Anthropic', Number.POSITIVE_INFINITY)).toBe(true)
  })
})
