import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vscode stub
// ---------------------------------------------------------------------------

const { mockStat, mockGetConfiguration } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockGetConfiguration: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) },
  FileType: { File: 1, Directory: 2 },
  workspace: {
    fs: { stat: mockStat },
    getConfiguration: mockGetConfiguration,
  },
}))

import { getActiveAdapters, adapterForFeature, ALL_ADAPTERS } from '../../src/extension/frameworkRegistry'

const WORKSPACE = '/workspace'

function makeConfigMock(featuresDir = '.devtool/features') {
  mockGetConfiguration.mockReturnValue({ get: (key: string, def?: unknown) => key === 'featuresDirectory' ? featuresDir : def })
}

beforeEach(() => {
  vi.clearAllMocks()
  makeConfigMock()
})

// ---------------------------------------------------------------------------
// ALL_ADAPTERS
// ---------------------------------------------------------------------------

describe('ALL_ADAPTERS', () => {
  it('contains native, superpowers, bmad, and spec-kit', () => {
    const ids = ALL_ADAPTERS.map(a => a.id)
    expect(ids).toContain('native')
    expect(ids).toContain('superpowers')
    expect(ids).toContain('bmad')
    expect(ids).toContain('spec-kit')
  })
})

// ---------------------------------------------------------------------------
// getActiveAdapters — named setting
// ---------------------------------------------------------------------------

describe('getActiveAdapters — named setting', () => {
  it('returns the specified adapter without calling detect()', async () => {
    const adapters = await getActiveAdapters(WORKSPACE, 'superpowers')
    expect(adapters).toHaveLength(1)
    expect(adapters[0].id).toBe('superpowers')
    expect(mockStat).not.toHaveBeenCalled()
  })

  it('returns native adapter when setting is "native"', async () => {
    const adapters = await getActiveAdapters(WORKSPACE, 'native')
    expect(adapters).toHaveLength(1)
    expect(adapters[0].id).toBe('native')
  })

  it('returns bmad adapter when setting is "bmad"', async () => {
    const adapters = await getActiveAdapters(WORKSPACE, 'bmad')
    expect(adapters).toHaveLength(1)
    expect(adapters[0].id).toBe('bmad')
  })

  it('returns empty array for unknown framework id', async () => {
    const adapters = await getActiveAdapters(WORKSPACE, 'unknown' as never)
    expect(adapters).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getActiveAdapters — auto detection
// ---------------------------------------------------------------------------

describe('getActiveAdapters — auto detection', () => {
  it('returns detected adapters when some are found', async () => {
    // Only superpowers and bmad are "present"
    mockStat.mockImplementation(({ fsPath }: { fsPath: string }) => {
      if (fsPath.includes('docs/superpowers/plans') || fsPath.includes('docs/stories')) {
        return Promise.resolve({})
      }
      return Promise.reject(new Error('not found'))
    })

    const adapters = await getActiveAdapters(WORKSPACE, 'auto')
    const ids = adapters.map(a => a.id)
    expect(ids).toContain('superpowers')
    expect(ids).toContain('bmad')
    expect(ids).not.toContain('native')
    expect(ids).not.toContain('spec-kit')
  })

  it('falls back to NativeAdapter when nothing is detected', async () => {
    mockStat.mockRejectedValue(new Error('not found'))

    const adapters = await getActiveAdapters(WORKSPACE, 'auto')
    expect(adapters).toHaveLength(1)
    expect(adapters[0].id).toBe('native')
  })

  it('returns all detected adapters when multiple match', async () => {
    // All adapters detected
    mockStat.mockResolvedValue({})

    const adapters = await getActiveAdapters(WORKSPACE, 'auto')
    expect(adapters.length).toBe(ALL_ADAPTERS.length)
  })
})

// ---------------------------------------------------------------------------
// adapterForFeature
// ---------------------------------------------------------------------------

describe('adapterForFeature', () => {
  it('returns the matching adapter for a valid namespaced id', () => {
    const adapter = adapterForFeature('superpowers:my-story', ALL_ADAPTERS)
    expect(adapter?.id).toBe('superpowers')
  })

  it('returns native adapter for native namespaced id', () => {
    const adapter = adapterForFeature('native:2026-01-feature', ALL_ADAPTERS)
    expect(adapter?.id).toBe('native')
  })

  it('returns null for a malformed id (no colon)', () => {
    expect(adapterForFeature('nocolon', ALL_ADAPTERS)).toBeNull()
  })

  it('returns null for an id with invalid framework prefix', () => {
    expect(adapterForFeature('unknown:some-feature', ALL_ADAPTERS)).toBeNull()
  })

  it('returns null for an id with empty local part', () => {
    expect(adapterForFeature('native:', ALL_ADAPTERS)).toBeNull()
  })

  it('returns null when adapter is not in the provided list', () => {
    const nativeOnly = ALL_ADAPTERS.filter(a => a.id === 'native')
    expect(adapterForFeature('superpowers:my-story', nativeOnly)).toBeNull()
  })
})
