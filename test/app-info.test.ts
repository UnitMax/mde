import { describe, expect, it } from 'vitest'
import { createAppInfo, MDE_APP_NAME, MDE_FULL_NAME } from '../src/shared/app-info'

describe('application info', () => {
  it('uses the MDE name and displays the supplied package version', () => {
    expect(createAppInfo('0.0.1')).toEqual({
      name: MDE_APP_NAME,
      fullName: MDE_FULL_NAME,
      version: '0.0.1'
    })
  })
})
