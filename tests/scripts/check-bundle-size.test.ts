import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { statSync, readdirSync } from 'fs'

vi.mock('fs', () => ({
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}))

describe('checkBundleSize', () => {
  let checkBundleSize: (entryChunkPath: string, budgetKb: number) => void
  let mockExit: ReturnType<typeof vi.spyOn>
  let mockLog: ReturnType<typeof vi.spyOn>
  let mockError: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.mocked(statSync).mockReturnValue({ size: 100 * 1024 } as ReturnType<typeof statSync>)
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.resetModules()
    ;({ checkBundleSize } = await import('../../scripts/check-bundle-size'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs success and does not exit when bundle is under budget', () => {
    vi.mocked(statSync).mockReturnValue({ size: 150 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith('Bundle size OK: index.js is 150.0 KB (budget: 200 KB)')
  })

  it('logs error and exits 1 when bundle exceeds budget', () => {
    vi.mocked(statSync).mockReturnValue({ size: 250 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockError).toHaveBeenCalledWith(
      'Bundle budget exceeded: index.js is 250.0 KB (budget: 200 KB)'
    )
  })

  it('exits 1 exactly at the budget boundary (200 KB is still over)', () => {
    vi.mocked(statSync).mockReturnValue({ size: 200 * 1024 + 1 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('succeeds exactly at 200.0 KB', () => {
    vi.mocked(statSync).mockReturnValue({ size: 200 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).not.toHaveBeenCalled()
  })
})

describe('checkAllChunks', () => {
  let checkAllChunks: (distDir: string, budgetKb: number) => void
  let mockExit: ReturnType<typeof vi.spyOn>
  let mockLog: ReturnType<typeof vi.spyOn>
  let mockError: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.mocked(readdirSync).mockReturnValue(['index.js', 'FeatureEditor-abc.js', 'react-vendor-xyz.js', 'EpicInput-def.js', 'index.js.map'] as unknown as ReturnType<typeof readdirSync>)
    vi.mocked(statSync).mockReturnValue({ size: 100 * 1024 } as ReturnType<typeof statSync>)
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.resetModules()
    ;({ checkAllChunks } = await import('../../scripts/check-bundle-size'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('checks non-vendor .js chunks and logs success when all are under budget', () => {
    vi.mocked(statSync).mockReturnValue({ size: 100 * 1024 } as ReturnType<typeof statSync>)
    checkAllChunks('/fake/dist/webview', 200)
    expect(mockExit).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith('Bundle size OK: index.js is 100.0 KB (budget: 200 KB)')
    expect(mockLog).toHaveBeenCalledWith('Bundle size OK: FeatureEditor-abc.js is 100.0 KB (budget: 200 KB)')
    expect(mockLog).not.toHaveBeenCalledWith(expect.stringContaining('react-vendor'))
    expect(mockLog).not.toHaveBeenCalledWith(expect.stringContaining('EpicInput'))
  })

  it('skips .js.map files', () => {
    checkAllChunks('/fake/dist/webview', 200)
    const allLogs = vi.mocked(mockLog).mock.calls.map(c => c[0])
    expect(allLogs.every(l => !l.includes('.map'))).toBe(true)
  })

  it('exits 1 and reports error when any non-vendor chunk exceeds budget', () => {
    vi.mocked(statSync).mockImplementation((p: unknown) => {
      const name = String(p)
      return { size: (name.includes('FeatureEditor') ? 250 : 100) * 1024 } as ReturnType<typeof statSync>
    })
    checkAllChunks('/fake/dist/webview', 200)
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockError).toHaveBeenCalledWith('Bundle budget exceeded: FeatureEditor-abc.js is 250.0 KB (budget: 200 KB)')
  })

  it('reports all failing chunks before exiting — does not short-circuit on first failure', () => {
    vi.mocked(statSync).mockReturnValue({ size: 250 * 1024 } as ReturnType<typeof statSync>)
    checkAllChunks('/fake/dist/webview', 200)
    expect(mockExit).toHaveBeenCalledTimes(1)
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('index.js'))
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('FeatureEditor-abc.js'))
  })
})
