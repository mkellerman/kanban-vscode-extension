export type WorkspaceContext =
  | { type: 'none' }
  | { type: 'branch'; label: string }
  | { type: 'worktree'; path: string; label: string }

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p) || p.startsWith('\\\\')
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p
}

export function parseWorkspaceValue(workspace: string | null): WorkspaceContext {
  if (workspace === null) return { type: 'none' }
  if (isAbsolutePath(workspace)) {
    return { type: 'worktree', path: workspace, label: basename(workspace) }
  }
  return { type: 'branch', label: workspace }
}
