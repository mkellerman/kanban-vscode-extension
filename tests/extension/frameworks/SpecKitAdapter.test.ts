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

import { SpecKitAdapter } from '../../../src/extension/frameworks/SpecKitAdapter'

const WORKSPACE = '/workspace'
const SPECS_DIR = path.join(WORKSPACE, '.specify/specs')

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
  mockCreateDirectory.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Static properties
// ---------------------------------------------------------------------------

describe('SpecKitAdapter — static properties', () => {
  it('has id "spec-kit"', () => {
    expect(new SpecKitAdapter().id).toBe('spec-kit')
  })

  it('usesDoneSubfolder is false', () => {
    expect(new SpecKitAdapter().usesDoneSubfolder).toBe(false)
  })

  it('getWatchPatterns returns one-level-deep spec.md glob', () => {
    expect(new SpecKitAdapter().getWatchPatterns(WORKSPACE)).toEqual(['.specify/specs/*/spec.md'])
  })
})

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

describe('SpecKitAdapter.detect', () => {
  it('returns true when .specify/specs/ exists', async () => {
    mockStat.mockResolvedValue({})
    expect(await new SpecKitAdapter().detect(WORKSPACE)).toBe(true)
    expect(mockStat).toHaveBeenCalledWith({ fsPath: SPECS_DIR })
  })

  it('returns false when .specify/specs/ is absent', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    expect(await new SpecKitAdapter().detect(WORKSPACE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseFile — key spec requirement
// ---------------------------------------------------------------------------

describe('SpecKitAdapter.parseFile', () => {
  it('returns null for a non-spec.md file path', () => {
    const adapter = new SpecKitAdapter()
    expect(adapter.parseFile('# content', `${SPECS_DIR}/my-spec/README.md`)).toBeNull()
    expect(adapter.parseFile('# content', `${SPECS_DIR}/my-spec/other.md`)).toBeNull()
    expect(adapter.parseFile('# content', `${SPECS_DIR}/my-spec/spec.md.bak`)).toBeNull()
  })

  it('returns a Feature for a spec.md file', () => {
    const adapter = new SpecKitAdapter()
    const result = adapter.parseFile('# My Spec\n\nBody.', `${SPECS_DIR}/my-spec/spec.md`)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('my-spec')
    expect(result!.content).toBe('# My Spec\n\nBody.')
  })

  it('derives id from the parent directory name', () => {
    const adapter = new SpecKitAdapter()
    const result = adapter.parseFile('# Title', `${SPECS_DIR}/auth-flow/spec.md`)
    expect(result!.id).toBe('auth-flow')
  })

  it('always returns null for epic (SpecKit has no epic concept)', () => {
    const adapter = new SpecKitAdapter()
    const result = adapter.parseFile('---\nepic: "MCP"\n---\n# T', `${SPECS_DIR}/x/spec.md`)
    expect(result!.epic).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getFiles — one level deep only
// ---------------------------------------------------------------------------

describe('SpecKitAdapter.getFiles', () => {
  it('includes spec.md files one level deep', async () => {
    mockReadDirectory.mockResolvedValueOnce([
      ['auth-flow', 2],  // FileType.Directory
      ['user-profile', 2],
    ])
    // auth-flow/spec.md exists, user-profile/spec.md does not
    mockStat
      .mockResolvedValueOnce({})           // auth-flow/spec.md
      .mockRejectedValueOnce(new Error('ENOENT')) // user-profile/spec.md

    const files = await new SpecKitAdapter().getFiles(WORKSPACE)
    expect(files).toEqual([path.join(SPECS_DIR, 'auth-flow', 'spec.md')])
  })

  it('skips plain files at the specs directory root', async () => {
    mockReadDirectory.mockResolvedValueOnce([
      ['stray.md', 1],  // FileType.File — should be ignored
    ])
    const files = await new SpecKitAdapter().getFiles(WORKSPACE)
    expect(files).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------

describe('SpecKitAdapter.moveFile', () => {
  it('returns the current path unchanged', async () => {
    const currentPath = `${SPECS_DIR}/my-spec/spec.md`
    const adapter = new SpecKitAdapter()
    const feature = adapter.parseFile('# My Spec', currentPath)!
    expect(await adapter.moveFile(currentPath, feature, WORKSPACE)).toBe(currentPath)
  })
})
