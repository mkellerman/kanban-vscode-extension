import * as path from 'path'

export type WorkspaceContext =
  | { type: 'none' }
  | { type: 'branch'; label: string }
  | { type: 'worktree'; path: string; label: string }

export function parseWorkspaceValue(workspace: string | null): WorkspaceContext {
  if (workspace === null) return { type: 'none' }
  if (path.posix.isAbsolute(workspace) || path.win32.isAbsolute(workspace)) {
    const label = path.win32.basename(path.posix.basename(workspace))
    return { type: 'worktree', path: workspace, label }
  }
  return { type: 'branch', label: workspace }
}
