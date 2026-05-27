import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

// ---------------------------------------------------------------------------
// vscode stub
// ---------------------------------------------------------------------------

const { mockStat, mockReadDirectory, mockReadFile, mockWriteFile, mockCreateDirectory } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockReadDirectory: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockCreateDirectory: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) },
  FileType: { File: 1, Directory: 2 },
  workspace: {
    fs: {
      stat: mockStat,
      readDirectory: mockReadDirectory,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      createDirectory: mockCreateDirectory,
    }
  }
}))

import { SuperpowersAdapter } from '../../../src/extension/frameworks/SuperpowersAdapter'

const WORKSPACE = '/workspace'
const PLANS_DIR = path.join(WORKSPACE, 'docs/superpowers/plans')

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
  mockCreateDirectory.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Static properties
// ---------------------------------------------------------------------------

describe('SuperpowersAdapter — static properties', () => {
  it('has id "superpowers"', () => {
    expect(new SuperpowersAdapter().id).toBe('superpowers')
  })

  it('usesDoneSubfolder is false', () => {
    expect(new SuperpowersAdapter().usesDoneSubfolder).toBe(false)
  })

  it('getWatchPatterns returns the plans glob', () => {
    const patterns = new SuperpowersAdapter().getWatchPatterns(WORKSPACE)
    expect(patterns).toEqual(['docs/superpowers/plans/**/*.md'])
  })
})

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

describe('SuperpowersAdapter.detect', () => {
  it('returns true when docs/superpowers/plans/ exists', async () => {
    mockStat.mockResolvedValue({})
    expect(await new SuperpowersAdapter().detect(WORKSPACE)).toBe(true)
    expect(mockStat).toHaveBeenCalledWith({ fsPath: PLANS_DIR })
  })

  it('returns false when docs/superpowers/plans/ is absent', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    expect(await new SuperpowersAdapter().detect(WORKSPACE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseFile
// ---------------------------------------------------------------------------

describe('SuperpowersAdapter.parseFile', () => {
  it('returns a Feature for any .md file (never returns null)', () => {
    const adapter = new SuperpowersAdapter()
    const result = adapter.parseFile('# Hello\n\nBody text.', `${PLANS_DIR}/2026-05-27-hello.md`)
    expect(result).not.toBeNull()
    expect(result!.content).toBe('# Hello\n\nBody text.')
  })
})

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------

describe('SuperpowersAdapter.moveFile', () => {
  it('returns the current path unchanged', async () => {
    const adapter = new SuperpowersAdapter()
    const currentPath = `${PLANS_DIR}/2026-05-27-my-plan.md`
    const feature = adapter.parseFile('# My Plan', currentPath)!
    const result = await adapter.moveFile(currentPath, feature, WORKSPACE)
    expect(result).toBe(currentPath)
  })
})

// ---------------------------------------------------------------------------
// createFeature — filename format
// ---------------------------------------------------------------------------

describe('SuperpowersAdapter.createFeature — filename', () => {
  it('generates a YYYY-MM-DD-{slug}.md filename from the content title', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T10:00:00.000Z'))

    // No existing files
    mockReadDirectory.mockResolvedValue([])
    // Target file doesn't exist yet
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const adapter = new SuperpowersAdapter()
    const feature = await adapter.createFeature(WORKSPACE, {
      status: 'backlog',
      priority: 'medium',
      content: '# My Feature\n\nSome content.',
      assignee: null,
      epic: null,
      dueDate: null,
      labels: []
    })

    expect(path.basename(feature.filePath)).toBe('2026-05-27-my-feature.md')
    expect(feature.filePath).toBe(path.join(PLANS_DIR, '2026-05-27-my-feature.md'))
  })

  it('appends a counter when the file already exists', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T10:00:00.000Z'))

    mockReadDirectory.mockResolvedValue([])
    // First stat resolves (file exists), second rejects (new path is free)
    mockStat
      .mockResolvedValueOnce({})   // existence check for 2026-05-27-hello.md → exists
      .mockRejectedValueOnce(new Error('ENOENT')) // 2026-05-27-hello-1.md → free

    const adapter = new SuperpowersAdapter()
    const feature = await adapter.createFeature(WORKSPACE, {
      status: 'backlog',
      priority: 'medium',
      content: '# Hello',
      assignee: null,
      epic: null,
      dueDate: null,
      labels: []
    })

    expect(path.basename(feature.filePath)).toBe('2026-05-27-hello-1.md')
  })

  it('writes the file via vscode.workspace.fs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'))

    mockReadDirectory.mockResolvedValue([])
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const adapter = new SuperpowersAdapter()
    await adapter.createFeature(WORKSPACE, {
      status: 'todo',
      priority: 'high',
      content: '# Write Test',
      assignee: null,
      epic: null,
      dueDate: null,
      labels: []
    })

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [uri] = mockWriteFile.mock.calls[0]
    expect(uri.fsPath).toBe(path.join(PLANS_DIR, '2026-05-27-write-test.md'))
  })
})
