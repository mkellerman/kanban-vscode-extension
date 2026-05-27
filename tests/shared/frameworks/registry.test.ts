import { describe, it, expect } from 'vitest'
import { FRAMEWORK_INDICATOR_PATHS } from '../../../src/shared/frameworks/registry'

describe('FRAMEWORK_INDICATOR_PATHS', () => {
  it('has an entry for every FrameworkId', () => {
    expect(FRAMEWORK_INDICATOR_PATHS).toHaveProperty('native')
    expect(FRAMEWORK_INDICATOR_PATHS).toHaveProperty('superpowers')
    expect(FRAMEWORK_INDICATOR_PATHS).toHaveProperty('spec-kit')
    expect(FRAMEWORK_INDICATOR_PATHS).toHaveProperty('bmad')
  })

  it('all entries are non-empty arrays of strings', () => {
    for (const [, paths] of Object.entries(FRAMEWORK_INDICATOR_PATHS)) {
      expect(Array.isArray(paths)).toBe(true)
      expect(paths.length).toBeGreaterThan(0)
      for (const p of paths) {
        expect(typeof p).toBe('string')
        expect(p.length).toBeGreaterThan(0)
      }
    }
  })

  it('native indicator path is .devtool/features', () => {
    expect(FRAMEWORK_INDICATOR_PATHS.native).toContain('.devtool/features')
  })

  it('superpowers indicator path is .superpowers', () => {
    expect(FRAMEWORK_INDICATOR_PATHS.superpowers).toContain('.superpowers')
  })

  it('spec-kit indicator path is .spec-kit', () => {
    expect(FRAMEWORK_INDICATOR_PATHS['spec-kit']).toContain('.spec-kit')
  })

  it('bmad indicator paths include .bmad-core', () => {
    expect(FRAMEWORK_INDICATOR_PATHS.bmad).toContain('.bmad-core')
  })

  it('bmad indicator paths include bmad-agent.md', () => {
    expect(FRAMEWORK_INDICATOR_PATHS.bmad).toContain('bmad-agent.md')
  })

  it('has exactly 4 framework entries', () => {
    expect(Object.keys(FRAMEWORK_INDICATOR_PATHS)).toHaveLength(4)
  })
})
