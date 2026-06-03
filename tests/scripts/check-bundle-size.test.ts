import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { statSync } from 'fs'

vi.mock('fs', () => ({
  statSync: vi.fn(),
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
