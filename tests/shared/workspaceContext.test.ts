import { describe, it, expect } from 'vitest'
import { parseWorkspaceValue } from '../../src/shared/workspaceContext'

describe('parseWorkspaceValue', () => {
  it('returns { type: "none" } for null', () => {
    expect(parseWorkspaceValue(null)).toEqual({ type: 'none' })
  })

  it('returns branch context for a simple branch name', () => {
    expect(parseWorkspaceValue('main')).toEqual({ type: 'branch', label: 'main' })
  })

  it('returns branch context for a slash-prefixed branch name', () => {
    expect(parseWorkspaceValue('feat/my-story')).toEqual({ type: 'branch', label: 'feat/my-story' })
  })

  it('returns worktree context for a Unix absolute path', () => {
    expect(parseWorkspaceValue('/home/user/worktrees/my-story')).toEqual({
      type: 'worktree',
      path: '/home/user/worktrees/my-story',
      label: 'my-story'
    })
  })

  it('returns worktree context for a Windows absolute path', () => {
    expect(parseWorkspaceValue('C:\\worktrees\\my-story')).toEqual({
      type: 'worktree',
      path: 'C:\\worktrees\\my-story',
      label: 'my-story'
    })
  })
})
