import { describe, it, expect } from 'vitest'
import { makeFeatureId, parseFeatureId } from '../../../src/shared/frameworks/types'

describe('makeFeatureId', () => {
  it('produces a colon-separated composite id', () => {
    expect(makeFeatureId('native', 'my-feature-2026-05-27')).toBe('native:my-feature-2026-05-27')
  })

  it('works for all FrameworkId values', () => {
    expect(makeFeatureId('superpowers', 'abc')).toBe('superpowers:abc')
    expect(makeFeatureId('spec-kit', 'abc')).toBe('spec-kit:abc')
    expect(makeFeatureId('bmad', 'abc')).toBe('bmad:abc')
  })
})

describe('parseFeatureId', () => {
  it('round-trips with makeFeatureId for each framework', () => {
    for (const fw of ['native', 'superpowers', 'spec-kit', 'bmad'] as const) {
      const id = makeFeatureId(fw, 'some-local-id')
      expect(parseFeatureId(id)).toEqual({ frameworkId: fw, localId: 'some-local-id' })
    }
  })

  it('preserves colons in localId', () => {
    const id = makeFeatureId('native', 'a:b:c')
    expect(parseFeatureId(id)).toEqual({ frameworkId: 'native', localId: 'a:b:c' })
  })

  it('returns null when colon is missing', () => {
    expect(parseFeatureId('nativemy-feature')).toBeNull()
  })

  it('returns null for unknown frameworkId', () => {
    expect(parseFeatureId('unknown:my-feature')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseFeatureId('')).toBeNull()
  })

  it('returns null when frameworkId segment is empty', () => {
    expect(parseFeatureId(':local-id')).toBeNull()
  })

  it('returns null when localId segment is empty', () => {
    expect(parseFeatureId('native:')).toBeNull()
  })
})
