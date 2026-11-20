import { describe, expect, it } from 'vitest'
import { atLeast, COMPOSER_SIZE_FLOORS, composerSizeFor } from '../src/renderer/lib/composer-size'

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
