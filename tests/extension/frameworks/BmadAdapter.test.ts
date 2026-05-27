import { describe, expect, it, vi, beforeEach } from 'vitest'
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

import { BmadAdapter } from '../../../src/extension/frameworks/BmadAdapter'

const WORKSPACE = '/workspace'
const STORIES_DIR = path.join(WORKSPACE, 'docs/stories')
const BMAD_OUTPUT_DIR = path.join(WORKSPACE, '_bmad-output/planning-artifacts')

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
  mockCreateDirectory.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Static properties
// ---------------------------------------------------------------------------

describe('BmadAdapter — static properties', () => {
  it('has id "bmad"', () => {
    expect(new BmadAdapter().id).toBe('bmad')
  })

  it('usesDoneSubfolder is false', () => {
    expect(new BmadAdapter().usesDoneSubfolder).toBe(false)
  })

  it('getWatchPatterns covers both directories', () => {
    const patterns = new BmadAdapter().getWatchPatterns(WORKSPACE)
    expect(patterns).toContain('docs/stories/**/*.md')
    expect(patterns).toContain('_bmad-output/planning-artifacts/**/*.md')
  })
})

// ---------------------------------------------------------------------------
// detect — key spec requirement: true when either directory present
// ---------------------------------------------------------------------------

describe('BmadAdapter.detect', () => {
  it('returns true when docs/stories/ is present', async () => {
    mockStat.mockImplementation(({ fsPath }: { fsPath: string }) => {
      if (fsPath === STORIES_DIR) return Promise.resolve({})
      return Promise.reject(new Error('ENOENT'))
    })
    expect(await new BmadAdapter().detect(WORKSPACE)).toBe(true)
  })

  it('returns true when _bmad-output/planning-artifacts/ is present', async () => {
    mockStat.mockImplementation(({ fsPath }: { fsPath: string }) => {
      if (fsPath === BMAD_OUTPUT_DIR) return Promise.resolve({})
      return Promise.reject(new Error('ENOENT'))
    })
    expect(await new BmadAdapter().detect(WORKSPACE)).toBe(true)
  })

  it('returns true when both directories are present', async () => {
    mockStat.mockResolvedValue({})
    expect(await new BmadAdapter().detect(WORKSPACE)).toBe(true)
  })

  it('returns false when neither directory is present', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    expect(await new BmadAdapter().detect(WORKSPACE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseFile
// ---------------------------------------------------------------------------

describe('BmadAdapter.parseFile', () => {
  it('returns a Feature for any .md file (never returns null)', () => {
    const result = new BmadAdapter().parseFile('# Story\n\nBody.', `${STORIES_DIR}/my-story.md`)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('my-story')
  })

  it('extracts epic from path when under /epics/{name}/', () => {
    const filePath = `${WORKSPACE}/docs/stories/epics/auth/story.md`
    const result = new BmadAdapter().parseFile('# Story', filePath)
    expect(result!.epic).toBe('auth')
  })
})

// ---------------------------------------------------------------------------
// getFiles — globs both directories
// ---------------------------------------------------------------------------

describe('BmadAdapter.getFiles', () => {
  it('returns files from both directories', async () => {
    mockReadDirectory.mockImplementation(({ fsPath }: { fsPath: string }) => {
      if (fsPath === STORIES_DIR) return Promise.resolve([['story-a.md', 1]])
      if (fsPath === BMAD_OUTPUT_DIR) return Promise.resolve([['artifact-b.md', 1]])
      return Promise.reject(new Error('ENOENT'))
    })
    const files = await new BmadAdapter().getFiles(WORKSPACE)
    expect(files).toContain(path.join(STORIES_DIR, 'story-a.md'))
    expect(files).toContain(path.join(BMAD_OUTPUT_DIR, 'artifact-b.md'))
  })

  it('returns empty array when neither directory exists', async () => {
    mockReadDirectory.mockRejectedValue(new Error('ENOENT'))
    expect(await new BmadAdapter().getFiles(WORKSPACE)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------

describe('BmadAdapter.moveFile', () => {
  it('returns the current path unchanged', async () => {
    const currentPath = `${STORIES_DIR}/my-story.md`
    const feature = new BmadAdapter().parseFile('# Story', currentPath)!
    expect(await new BmadAdapter().moveFile(currentPath, feature, WORKSPACE)).toBe(currentPath)
  })
})
