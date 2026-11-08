import { describe, expect, it } from 'vitest'
import type { ChatModel } from '../src/shared/types'
import { quickSwitchModels, switchedModel } from '../src/renderer/lib/model-quick-switch'

const model = (id: string, providerId = 'p', variants?: string[]): ChatModel =>
  ({ id, providerId, providerName: providerId.toUpperCase(), name: id.toUpperCase(), ...(variants ? { variants } : {}) })
const star = (...ids: string[]) => ids.map((id) => ({ id, providerId: 'p' }))
const ids = (models: ChatModel[]): string[] => models.map((item) => item.id)

describe('the models the quick switch offers', () => {
  const models = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => model(id))

  it('are the favorites in the order they were starred, at most five', () => {
    expect(ids(quickSwitchModels(models, star('c', 'a', 'e', 'b'), null))).toEqual(['c', 'a', 'e', 'b'])
    expect(ids(quickSwitchModels(models, star('g', 'f', 'e', 'd', 'c', 'b', 'a'), null))).toEqual(['g', 'f', 'e', 'd', 'c'])
    expect(ids(quickSwitchModels(models, star('b'), null))).toEqual(['b'])
    expect(quickSwitchModels(models, [], null)).toEqual([])
  })

  it('skip a favorite this place does not offer, and fill its place with the next one', () => {
    expect(ids(quickSwitchModels(models, [{ id: 'gone', providerId: 'p' }, ...star('a', 'b', 'c', 'd', 'e', 'f')], null))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids(quickSwitchModels(models, [{ id: 'a', providerId: 'other' }], null))).toEqual([])
  })

  it('keep the model in use among them when it is a favorite beyond the first five', () => {
    const six = star('a', 'b', 'c', 'd', 'e', 'f')
    expect(ids(quickSwitchModels(models, six, { id: 'f', providerId: 'p' }))).toEqual(['a', 'b', 'c', 'd', 'f'])
    // One that is already shown stays where it is; one that is not a favorite changes nothing.
    expect(ids(quickSwitchModels(models, six, { id: 'b', providerId: 'p' }))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids(quickSwitchModels(models, six, { id: 'g', providerId: 'p' }))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('tell models of the same name apart by their provider', () => {
    const twins = [model('x', 'one'), model('x', 'two')]
    expect(quickSwitchModels(twins, [{ id: 'x', providerId: 'two' }], null)).toEqual([twins[1]])
  })
})

describe('switching to a model', () => {
  it('keeps the effort in use when the model has it too, and drops it when it does not', () => {
    expect(switchedModel(model('a', 'p', ['low', 'high']), { id: 'z', providerId: 'p', variant: 'high' })).toEqual({ id: 'a', providerId: 'p', variant: 'high' })
    expect(switchedModel(model('a', 'p', ['low', 'medium']), { id: 'z', providerId: 'p', variant: 'high' })).toEqual({ id: 'a', providerId: 'p' })
    expect(switchedModel(model('a'), { id: 'z', providerId: 'p', variant: 'high' })).toEqual({ id: 'a', providerId: 'p' })
  })

  it('starts on the default effort when none was in use', () => {
    expect(switchedModel(model('a', 'p', ['low']), { id: 'z', providerId: 'p' })).toEqual({ id: 'a', providerId: 'p' })
    expect(switchedModel(model('a', 'p', ['low']), null)).toEqual({ id: 'a', providerId: 'p' })
  })
})
